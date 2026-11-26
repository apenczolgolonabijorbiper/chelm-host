"""Qualify one release in a disposable staged host; never changes production approvals."""
import argparse
import contextlib
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'tools' / filename)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def qualify(version, output, archive=None, sha256=None, reference_archive=None):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    catalog = json.loads((ROOT / 'harness-compatibility.json').read_text())
    known = version in catalog['approved_releases']
    report = {'schema_version':1, 'recorded_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'host_version':(ROOT / 'VERSION').read_text().strip(), 'host_revision':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip() if (ROOT/'.git').exists() else None,
              'platform':sys.platform, 'node':subprocess.check_output(['node','--version'],text=True).strip(),
              'python':sys.version.split()[0], 'version':version, 'approved_at_start':known,
              'checkpoint':catalog['checkpoint_policy'], 'required':catalog['requirements'], 'features':{}}
    path = output / (version + '.json')
    def save():
        path.write_text(json.dumps(report,indent=2)+'\n')
    report['status']='running'
    report['phase']='package verification'
    save()
    try:
        report['phase']='version-policy'
        module('qualification_plan','harness-qualification-plan.py').require_minimum(catalog,version)
        with tempfile.TemporaryDirectory(prefix='chelm-qualification-') as temp:
            temp = Path(temp)
            engine = temp / 'harness'
            downloader = module('prepare_harness','prepare-harness.py')
            with contextlib.redirect_stdout(io.StringIO()):
                identity = downloader.prepare(engine, version, archive, candidate=not known, sha256=sha256)
            report['package'] = identity
            report['phase']='contract discovery'
            save()
            detected = json.loads(subprocess.check_output(['node',str(ROOT/'tools/probe-harness.mjs'),str(engine),sys.executable],text=True))
            report['detected'] = detected
            for feature, req in catalog['requirements'].items():
                missing = [f'contract {k}={v}' for k,v in req['contracts'].items() if detected['contracts'].get(k)!=v]
                missing += [c for c in req['capabilities'] if c not in detected['capabilities']]
                missing += ['file '+p for p in req['files'] if not (engine/p).is_file()]
                report['features'][feature] = {'status':'unsupported' if missing else 'pending', 'missing':missing, 'checks':[]}
            stage = temp / 'host'
            stage.mkdir()
            builder = module('release_builder','build-release.py')
            payload = builder.entries()
            # Candidates can execute only in this isolated copy, including CLI subprocesses.
            entry = {k:v for k,v in identity.items() if k in ('version','release_url','archive','archive_sha256','manifest_sha256')}
            entry['features'] = [k for k,v in report['features'].items() if v['status']=='pending']
            catalog['approved_releases'][version] = entry
            payload['harness-compatibility.json'] = (json.dumps(catalog,indent=2)+'\n').encode()
            manifest = {'schema_version':1,'version':report['host_version'],
                        'runtime_dependencies':{'manager':'npm','lockfile':'package-lock.json'},
                        'files':{k:hashlib.sha256(v).hexdigest() for k,v in payload.items()}}
            payload['RELEASE.json'] = json.dumps(manifest,indent=2).encode()
            report['staged_host_manifest_sha256'] = hashlib.sha256(payload['RELEASE.json']).hexdigest()
            for name,data in payload.items():
                p = stage/name
                p.parent.mkdir(parents=True,exist_ok=True)
                p.write_bytes(data)
            # The actual release stage uses the same locked dependency installer.
            install = subprocess.run(['node',str(stage/'integration/install-dependencies.mjs')],capture_output=True,text=True,timeout=180)
            if install.returncode:
                raise ValueError('Staged dependency installation failed: '+install.stderr[-2000:])
            env = {**os.environ,'CHELM_HARNESS_ROOT':str(engine),'CHELM_PROVIDER_HARNESS_ROOT':str(engine),
                   'GOLEM_PYTHON':sys.executable}
            def check(feature, label, command, extra=None):
                report['phase']=label
                save()
                result = subprocess.run(command,cwd=stage,env={**env,**(extra or {})},capture_output=True,text=True,timeout=600)
                log = version+'-'+label+'.log'
                log_bytes=(result.stdout+result.stderr).encode()
                (output/log).write_bytes(log_bytes)
                counts = {}
                import re
                for key in ('tests','pass','fail','cancelled','skipped'):
                    match = re.search(r'^(?:# |ℹ )'+key+r' (\d+)', result.stdout, re.M)
                    counts[key] = int(match[1]) if match else 0
                passed = result.returncode==0 and counts['tests']>0 and counts['tests']==counts['pass']
                report['features'][feature]['checks'].append({'name':label,'command':command,'exit':result.returncode,'counts':counts,'log':log,'log_sha256':hashlib.sha256(log_bytes).hexdigest()})
                if not passed:
                    report['features'][feature]['status']='fail'
                save()
            suites = {
                'file_worker':['tests/harness-compatibility.test.mjs','tests/conformance/app-contract.test.mjs','tests/conformance/worker-contract.test.mjs','tests/conformance/release-pair.test.mjs'],
                'cognitive_tasks':['tests/conformance/cognitive.test.mjs'],
                'memory_provider':['tests/conformance/memory-provider.test.mjs']}
            routing_patterns = {
                'file_worker': 'Routing policy schema|Durable bounded grace|CAS preview|Config-2 local|Two independent authenticated|Complete checkpoints|Integration/review|Runtime schema|Routing schema|Independent work clocks',
                'cognitive_tasks': 'Require mode covers|Scope, capability|Cognitive result response loss',
                'memory_provider': 'Provider memory-worker|Unknown claim/publication|Provider publication'}
            for feature, files in suites.items():
                if report['features'][feature]['status']=='unsupported':
                    continue
                check(feature,feature,['node','--test','--test-reporter=tap','--test-timeout=600000',*files])
                check(feature,'routing-'+feature,['node','--test','--test-reporter=tap','--test-timeout=600000',
                      '--test-name-pattern='+routing_patterns[feature],'tests/routing.test.mjs'])
                if feature=='file_worker':
                    check(feature,'adapter',['node','--test','--test-reporter=tap',str(engine/'adapters/conformance/adapter.test.mjs')],
                          {'GOLEM_ADAPTER':json.dumps(['node',str(stage/'lib/backend.mjs')])})
                    # Reopen populated data and upgrade reference -> tested package in both configs.
                    reference = temp/'reference'
                    with contextlib.redirect_stdout(io.StringIO()):
                        downloader.prepare(reference, catalog['reference_version'], archive=reference_archive)
                    check(feature,'upgrade',['node','--test','--test-reporter=tap','tests/harness-upgrade.test.mjs'],
                          {'CHELM_HARNESS_ROOT':str(reference),'CHELM_UPGRADE_HARNESS_ROOT':str(engine)})
                if report['features'][feature]['status']=='pending':
                    report['features'][feature]['status']='pass'
            approved_features=json.loads((ROOT/'harness-compatibility.json').read_text())['approved_releases'].get(version,{}).get('features',[])
            regression=any(report['features'].get(k,{}).get('status')!='pass' for k in approved_features)
            report['status']='fail' if regression or any(r['status']=='fail' for r in report['features'].values()) else 'pass'
            newer=tuple(map(int,version.split('-')[0].split('.')))>tuple(map(int,catalog['reference_version'].split('.')))
            reference_features=catalog['approved_releases'][catalog['reference_version']]['features']
            report['reference_feature_regressions']=[k for k in reference_features if report['features'].get(k,{}).get('status')!='pass'] if newer else []
            if report['status']=='pass' and report['reference_feature_regressions']:report['status']='unsupported'
            report['promotion']='review required; candidate evidence never changes the production catalog'
            report['phase']='complete'
    except Exception as error:
        report['status']='fail'
        report['diagnostic']=str(error)
    save()
    print(json.dumps({'report':str(path),'status':report['status'],'features':{k:v['status'] for k,v in report['features'].items()}}))
    # A declared pairing must continue passing every approved feature.
    required = json.loads((ROOT/'harness-compatibility.json').read_text())['approved_releases'].get(version,{}).get('features',[])
    return report['status']=='pass' and report['features'].get('file_worker',{}).get('status')=='pass' and not report.get('reference_feature_regressions') and all(report['features'].get(k,{}).get('status')=='pass' for k in required)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--archive',type=Path)
    parser.add_argument('--sha256')
    parser.add_argument('--reference-archive',type=Path,help='Offline copy of the approved reference ZIP for upgrade tests')
    args=parser.parse_args()
    sys.exit(0 if qualify(args.version,args.output,args.archive,args.sha256,args.reference_archive) else 1)
