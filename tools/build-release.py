"""Test and build the deterministic Chelm-host release; requires a clean harness release."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def digest(data):
    return hashlib.sha256(data).hexdigest()


def entries():
    ignored = {'.git', '.github', 'dist', 'node_modules', '__pycache__'}
    return {p.relative_to(ROOT).as_posix(): p.read_bytes()
            for p in sorted(ROOT.rglob('*')) if p.is_file()
            and not any(part in ignored for part in p.relative_to(ROOT).parts)
            and p.name not in {'.gitignore', 'RELEASE.json'}}


def build(harness, output=None):
    harness = Path(harness).resolve()
    version = (ROOT / 'VERSION').read_text().strip()
    output = Path(output or ROOT / 'dist' / f'chelm-host-{version}.zip').resolve()
    payload = entries()
    manifest = {'schema_version': 1, 'version': version,
                'contracts': {'app': 1, 'worker': 1, 'read_model': 1,
                              'runtime_config': 1, 'delegation': 1},
                'harness_supported': '=0.7.0',
                'provenance': {'repository': 'https://github.com/apenczolgolonabijorbiper/chelm-host',
                               'design': 'docs/CHELM_HOST_DESIGN.md',
                               'harness_release_sha256': '2154ea76f5184afdb76e73f7c15f324bef2a51e2afccd645c231cb75dbdecb80'},
                'files': {name: digest(data) for name, data in payload.items()}}
    payload['RELEASE.json'] = (json.dumps(manifest, indent=2, ensure_ascii=False) + '\n').encode()
    env = {**os.environ, 'CHELM_HARNESS_ROOT': str(harness),
           'GOLEM_PYTHON': os.environ.get('GOLEM_PYTHON', os.sys.executable)}
    with tempfile.TemporaryDirectory(prefix='chelm-release-') as directory:
        stage = Path(directory) / 'chelm-host'
        for name, data in payload.items():
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        subprocess.run(['node', str(stage / 'bin/chelm.mjs'), 'verify', '--harness', str(harness),
                        '--python', env['GOLEM_PYTHON']], check=True, env=env)
        subprocess.run(['node', '--test', 'tests/'], cwd=stage, check=True, env=env)
        env['GOLEM_ADAPTER'] = json.dumps(['node', str(stage / 'lib/backend.mjs')])
        subprocess.run(['node', '--test', str(harness / 'adapters/conformance/adapter.test.mjs')],
                       cwd=stage, check=True, env=env)
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
