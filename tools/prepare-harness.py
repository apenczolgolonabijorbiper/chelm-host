"""Download and verify the exact published harness package used by this host."""
import argparse
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def digest(data):
    return hashlib.sha256(data).hexdigest()

def download(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'chelm-host-release-verifier'})
    with urllib.request.urlopen(request, timeout=120) as response:
        payload = response.read(32 * 1024 * 1024 + 1)
    if len(payload) > 32 * 1024 * 1024:
        raise ValueError('Published harness download exceeds 32 MiB')
    return payload

def prepare(destination, version='0.12.0', archive=None):
    pinned = json.loads((ROOT / 'compatibility.json').read_text())['published_harness']
    if version != pinned['version']:
        raise ValueError('Unsupported harness release')
    url = 'https://github.com/apenczolgolonabijorbiper/golem14-harness/releases/download/v' + version + '/' + pinned['archive']
    payload = Path(archive).read_bytes() if archive else download(url)
    if digest(payload) != pinned['archive_sha256']:
        raise ValueError('Published harness archive hash mismatch')
    if not archive:
        checksum = download(url + '.sha256').decode('utf-8').strip().split()
        if checksum != [pinned['archive_sha256'], pinned['archive']]:
            raise ValueError('Published checksum does not identify the pinned archive')
    destination = Path(destination).resolve()
    if destination.exists() and (not destination.is_dir() or any(destination.iterdir())):
        raise ValueError('Destination must be empty')
    with zipfile.ZipFile(io.BytesIO(payload)) as package:
        infos = package.infolist()
        if len(infos) > 1000 or sum(i.file_size for i in infos) > 64 * 1024 * 1024:
            raise ValueError('Published harness extraction budget exceeded')
        names = [i.filename for i in infos]
        if len(names) != len(set(names)):
            raise ValueError('Duplicate archive members')
        for entry in infos:
            parts = PurePosixPath(entry.filename).parts
            if not parts or parts[0] != 'golem-harness' or len(parts) < 2 or any(p in {'.', '..'} for p in parts) or '\\' in entry.filename or entry.is_dir() or (entry.external_attr >> 16) & 0o170000 not in {0, 0o100000}:
                raise ValueError('Unsafe harness archive member')
        manifest_bytes = package.read('golem-harness/RELEASE.json')
        if digest(manifest_bytes) != pinned['manifest_sha256']:
            raise ValueError('Published harness manifest hash mismatch')
        manifest = json.loads(manifest_bytes)
        if manifest['version'] != version or package.read('golem-harness/VERSION').decode().strip() != version:
            raise ValueError('Published harness version mismatch')
        expected = {'golem-harness/' + name for name in manifest['files']} | {'golem-harness/RELEASE.json'}
        if set(names) != expected:
            raise ValueError('Archive inventory differs from manifest')
        for name, expected_hash in manifest['files'].items():
            if digest(package.read('golem-harness/' + name)) != expected_hash:
                raise ValueError('Harness file integrity failed: ' + name)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='verified-harness-', dir=destination.parent) as temp:
            stage = Path(temp) / 'engine'
            stage.mkdir()
            for entry in infos:
                target = stage.joinpath(*PurePosixPath(entry.filename).parts[1:])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(package.read(entry))
            if destination.exists():
                destination.rmdir()
            shutil.move(str(stage), str(destination))
    print(json.dumps({'version': version, 'archive_sha256': pinned['archive_sha256'], 'manifest_sha256': pinned['manifest_sha256'], 'files': len(manifest['files']), 'source': 'published-release' if not archive else 'verified-local-release-archive'}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True, type=Path)
    parser.add_argument('--version', default='0.12.0')
    parser.add_argument('--archive', type=Path, help='Offline copy of the same pinned published ZIP')
    args = parser.parse_args()
    prepare(args.destination, args.version, args.archive)
