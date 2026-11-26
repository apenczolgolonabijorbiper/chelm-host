"""Promote retained qualification evidence after matching the official published asset."""
import argparse
import importlib.util
import json
import hashlib
import re
from pathlib import Path
import tempfile

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare_harness',ROOT/'tools/prepare-harness.py')
downloader=importlib.util.module_from_spec(spec)
spec.loader.exec_module(downloader)

def validate(report,catalog,identity):
    if report.get('status') not in ('pass','unsupported') or report.get('required')!=catalog['requirements']:
        raise ValueError('Qualification failed or requirements changed; rerun qualification')
    if any(report.get('package',{}).get(k)!=identity[k] for k in ('version','archive_sha256','manifest_sha256')):
        raise ValueError('Evidence does not match the official published package')
    approved=[]
    for feature,row in report['features'].items():
        if row['status']=='unsupported':continue
        labels={c['name'] for c in row['checks']}
        expected={feature}|({'adapter','upgrade'} if feature=='file_worker' else set())
        if row['status']!='pass' or not expected.issubset(labels) or any(c['exit']!=0 or c['counts']['tests']<1 or c['counts']['pass']!=c['counts']['tests'] for c in row['checks']):
            raise ValueError('Missing or failed conformance checks for '+feature)
        approved.append(feature)
    if 'file_worker' not in approved:raise ValueError('File worker conformance is required')
    return approved

def promote(evidence):
    evidence=Path(evidence).resolve()
    evidence.relative_to(ROOT)  # retained evidence must travel with the host source/package
    report=json.loads(evidence.read_text())
    catalog=json.loads((ROOT/'harness-compatibility.json').read_text())
    # Independently download, checksum, inventory and verify the official release again.
    with tempfile.TemporaryDirectory() as temp:
        identity=downloader.prepare(Path(temp)/'engine',report['version'],candidate=True)
    features=validate(report,catalog,identity)
    for row in report['features'].values():
        for check in row['checks']:
            log=(evidence.parent/check['log']).resolve()
            log.relative_to(evidence.parent)
            raw=log.read_bytes()
            if check.get('log_sha256') and hashlib.sha256(raw).hexdigest()!=check['log_sha256']:
                raise ValueError('Retained conformance log hash differs')
            for key,count in check['counts'].items():
                match=re.search(r'^(?:# |ℹ )'+key+r' (\d+)',raw.decode(),re.M)
                if not match or int(match[1])!=count:
                    raise ValueError('Retained log differs from reported counts')
    entry={k:identity[k] for k in ('version','release_url','archive','archive_sha256','manifest_sha256')}
    entry.update(features=features,evidence=evidence.relative_to(ROOT).as_posix())
    catalog['approved_releases'][report['version']]=entry
    (ROOT/'harness-compatibility.json').write_text(json.dumps(catalog,indent=2)+'\n')
    compatibility=json.loads((ROOT/'compatibility.json').read_text())
    compatibility['supported_harness_versions']=sorted(catalog['approved_releases'])
    compatibility['versions'][report['version']]={
        **{k:v for k,v in report['detected']['contracts'].items() if k in ('graph','hypotheses','cognitive_task')},
        'layout':'canonical','features':features,
        'runtimes':'Drain leases/assignments and use harness upgrade; checkpoints retain exact package identities.'}
    (ROOT/'compatibility.json').write_text(json.dumps(compatibility,indent=2)+'\n')
    print(json.dumps({'approved':report['version'],'features':features,'reference_unchanged':catalog['reference_version']}))

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',required=True,type=Path)
    promote(parser.parse_args().evidence)
