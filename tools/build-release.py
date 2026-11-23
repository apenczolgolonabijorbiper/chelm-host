"""Test and build the deterministic Chelm-host release; requires a clean harness release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile
import time

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def entries():
    ignored = {'.git', '.github', '.bin', '__pycache__', 'node_modules'}
    return {p.relative_to(ROOT).as_posix(): p.read_bytes()
            for p in sorted(ROOT.rglob('*')) if p.is_file()
            and p.relative_to(ROOT).parts[0] != 'dist'
            and not any(part in ignored for part in p.relative_to(ROOT).parts)
            and p.name not in {'.gitignore', 'RELEASE.json'}}


def build(harness, output=None):
    harness = Path(harness).resolve()
    version = (ROOT / 'VERSION').read_text().strip()
    output = Path(output or ROOT / 'dist' / f'chelm-host-{version}.zip').resolve()
    payload = entries()
    manifest = {'schema_version': 1, 'version': version,
                'contracts': {'app': 1, 'worker': 2, 'read_model': 1,
                              'runtime_config': 2, 'remote_worker': 2},
                'harness_supported': '=0.11.0', 'supported_harness_versions': ['0.11.0'],
                'provenance': {'repository': 'https://github.com/apenczolgolonabijorbiper/chelm-host',
                               'design': 'docs/CHELM_HOST_DESIGN.md',
                               'harness_archive_sha256': '2f945cf38166f1878bfd4ea89b9d9ffb187f525269710a61016d0129b02f3ca2',
                               'harness_release_sha256': 'd130c465688874bceae2f5eb0bb113ddef740c95764256871bda6d51928355e7'},
                'runtime_dependencies': {'manager': 'npm', 'lockfile': 'package-lock.json'},
                'files': {name: digest(data) for name, data in payload.items()}}
    payload['RELEASE.json'] = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    env = {**os.environ, 'CHELM_HARNESS_ROOT': str(harness),
           'GOLEM_PYTHON': os.environ.get('GOLEM_PYTHON', os.sys.executable)}
    output.parent.mkdir(parents=True, exist_ok=True)
    env['CHELM_ACCEPTANCE_REPORT_DIR'] = str(output.parent)
    started = time.monotonic()
    with tempfile.TemporaryDirectory(prefix='chelm-release-') as directory:
        stage = (Path(directory) / 'chelm-host').resolve()
        for name, data in payload.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        subprocess.run([os.sys.executable, '-B', str(stage / 'tools/test-prepare-harness.py')], check=True, env=env)
        subprocess.run(['node', str(stage / 'integration/install-dependencies.mjs')], check=True, env=env)
        subprocess.run(['node', str(stage / 'bin/chelm.mjs'), 'verify', '--harness', str(harness),
                        '--python', env['GOLEM_PYTHON']], check=True, env=env)
        tests = [str(p.relative_to(stage)) for p in sorted((stage / 'tests').rglob('*.test.mjs'))]
        subprocess.run(['node', '--test', '--test-concurrency=4', *tests], cwd=stage, check=True, env=env)
        env['GOLEM_ADAPTER'] = json.dumps(['node', str(stage / 'lib/backend.mjs')])
        subprocess.run(['node', '--test', str(harness / 'adapters/conformance/adapter.test.mjs')],
                       cwd=stage, check=True, env=env)
        suite_seconds = time.monotonic() - started
        output.parent.mkdir(parents=True, exist_ok=True)
        timing = {'platform': os.sys.platform, 'harness_version': '0.11.0', 'suite_seconds': suite_seconds, 'tst9_under_10_minutes': suite_seconds < 600}
        print('CHELM_TEST_TIMING ' + json.dumps(timing), flush=True)
        (output.parent / ('test-timing-' + os.sys.platform + '.json')).write_text(json.dumps(timing, indent=2) + '\n', encoding='utf-8')
        subprocess.run(['node', str(stage / 'tools/benchmark-host.mjs'), '--harness', str(harness),
                        '--output', str(output.parent / ('benchmark-' + os.sys.platform + '.json'))],
                       cwd=stage, env=env, check=True)
        subprocess.run(['node', str(stage / 'tools/benchmark-telemetry.mjs'), '--harness', str(harness),
                        '--output', str(output.parent / ('telemetry-' + os.sys.platform + '.json'))],
                       cwd=stage, env=env, check=True)
    # Output is written only after all checks passed.
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temporary, 'w') as archive:
        for name, data in sorted(payload.items()):
            info = zipfile.ZipInfo('chelm-host/' + name, (2020, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
    temporary.replace(output)
    output.with_suffix(output.suffix + '.sha256').write_text(
        f'{digest(output.read_bytes())}  {output.name}\n', encoding='utf-8')
    print(output)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    build(args.harness, args.output)
