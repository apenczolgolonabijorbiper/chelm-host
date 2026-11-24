"""Build the pinned, unpublished provider API for vendor development checks only."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def prepare(source, destination):
    pin = json.loads((ROOT / 'provider-compatibility.json').read_text())
    expected_manifest = pin.get('manifest_sha256_by_platform', {}).get(sys.platform, pin['manifest_sha256'])
    source, destination = Path(source).resolve(), Path(destination).resolve()
    commit = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    if commit != pin['source_commit']:
        raise ValueError('Provider source commit differs from development pin')
    if subprocess.check_output(['git', '-C', str(source), 'rev-parse', '--is-shallow-repository'], text=True).strip() != 'false':
        raise ValueError('Full provider history is required for deterministic explorer provenance; fetch-depth must be 0')
    if subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Provider source must be clean')
    if destination.exists():
        raise ValueError('Provider destination must not exist')
    with tempfile.TemporaryDirectory(prefix='chelm-provider-package-') as temporary:
        output = Path(temporary) / 'provider.zip'
        subprocess.run([sys.executable, str(source / 'tools/build-release.py'), '--output', str(output)], check=True)
        with zipfile.ZipFile(output) as package:
            if hashlib.sha256(package.read('golem-harness/RELEASE.json')).hexdigest() != expected_manifest:
                raise ValueError('Provider manifest differs from exact development pin: ' + hashlib.sha256(package.read('golem-harness/RELEASE.json')).hexdigest())
            package.extractall(destination)
        # Development ZIP compression may vary with the platform's zlib. The
        # exact manifest and every payload hash remain pinned. Published package
        # downloads continue to require their exact archive hash.
        print(json.dumps({'source_commit': commit, 'manifest_sha256': expected_manifest,
                          'observed_archive_sha256': hashlib.sha256(output.read_bytes()).hexdigest(),
                          'reference_archive_sha256': pin['reference_archive_sha256']}))
    print(destination / 'golem-harness')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.source, args.destination)
