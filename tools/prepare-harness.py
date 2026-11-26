"""Verify approved release bytes, or prepare an explicitly isolated candidate."""
import argparse
import hashlib
import io
import json
import re
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

def approved():
    catalog = ROOT / 'harness-compatibility.json'
    if catalog.exists():
        return json.loads(catalog.read_text())['approved_releases']
    pin = json.loads((ROOT / 'compatibility.json').read_text())['published_harness']
    return {pin['version']: pin}

def candidate_identity(version, archive=None, sha256=None):
    if not re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?', version):
        raise ValueError('Invalid candidate version')
    if archive:
        if not sha256 or not re.fullmatch('[0-9a-f]{64}', sha256):
            raise ValueError('Local candidates require an explicit archive SHA-256')
        payload = Path(archive).read_bytes()
        with zipfile.ZipFile(io.BytesIO(payload)) as package:
            manifest_hash = digest(package.read('golem-harness/RELEASE.json'))
        return {'version':version, 'archive':Path(archive).name, 'archive_sha256':sha256,
                'manifest_sha256':manifest_hash, 'release_url':'local-build-artifact'}
    base = 'https://api.github.com/repos/apenczolgolonabijorbiper/golem14-harness/releases/tags/v' + version
    release = json.loads(download(base))
    name = 'golem-cognitive-harness-' + version + '.zip'
    asset = next(a for a in release['assets'] if a['name'] == name)
    if not asset.get('digest', '').startswith('sha256:'):
        raise ValueError('Official candidate asset has no trusted transport digest')
    payload = download(asset['browser_download_url'])
    if digest(payload) != asset['digest'][7:]:
        raise ValueError('Candidate archive hash mismatch')
    with zipfile.ZipFile(io.BytesIO(payload)) as package:
        manifest_hash = digest(package.read('golem-harness/RELEASE.json'))
    return {'version':version, 'archive':name, 'archive_sha256':asset['digest'][7:],
            'manifest_sha256':manifest_hash, 'release_url':release['html_url']}

def prepare(destination, version=None, archive=None, candidate=False, sha256=None):
    version = version or json.loads((ROOT / 'compatibility.json').read_text())['published_harness']['version']
    pinned = candidate_identity(version, archive, sha256) if candidate else approved().get(version)
    if not pinned:
        raise ValueError('Unsupported harness release; use isolated --candidate qualification')
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
            if entry.filename.startswith('/') or ':' in entry.filename or not parts or parts[0] != 'golem-harness' or len(parts) < 2 or any(p in {'.', '..'} for p in parts) or '\\' in entry.filename or entry.is_dir() or (entry.external_attr >> 16) & 0o170000 not in {0, 0o100000}:
                raise ValueError('Unsafe harness archive member')
        manifest_bytes = package.read('golem-harness/RELEASE.json')
        if digest(manifest_bytes) != pinned['manifest_sha256']:
            raise ValueError('Published harness manifest hash mismatch')
        manifest = json.loads(manifest_bytes)
        if manifest.get('schema_version') != 1 or not isinstance(manifest.get('files'), dict):
            raise ValueError('Invalid manifest schema')
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
    report = {**pinned, 'files':len(manifest['files']),
              'source':'isolated-candidate' if candidate else 'approved-release',
              'production_approved':not candidate}
    print(json.dumps(report))
    return report

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', required=True, type=Path)
    parser.add_argument('--version')
    parser.add_argument('--candidate', action='store_true', help='Isolated evidence only; does not approve production use')
    parser.add_argument('--sha256', help='Required expected archive digest for a local candidate')
    parser.add_argument('--archive', type=Path, help='Offline copy of the same pinned published ZIP')
    args = parser.parse_args()
    prepare(args.destination, args.version, args.archive, args.candidate, args.sha256)
