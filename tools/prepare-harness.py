"""Reconstruct the byte-exact harness 0.9.1 test distribution from its pinned source."""
import argparse
import ast
import hashlib
import json
import subprocess
from pathlib import Path

EXPECTED = '3471d0bf0f83b4d3756a8aefcbc45a314c372e52bc28d39265d16a1ad2cd7150'


def prepare(source, destination):
    source, destination = Path(source), Path(destination)
    assert (source / 'VERSION').read_text().strip() == '0.9.1', 'Wrong harness version'
    module = ast.parse(subprocess.check_output(['git', '-C', str(source), 'show', 'HEAD:tools/build-release.py']).decode('utf-8'))
    names = next(ast.literal_eval(statement.value) for statement in module.body
                 if isinstance(statement, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == 'FILES'
                         for target in statement.targets))
    paths = [*names, 'integration/AGENTS.distribution.md']
    raw = subprocess.check_output(['git', '-C', str(source), 'cat-file', '--batch'],
                                  input=''.join('HEAD:' + name + '\n' for name in paths).encode())
    entries, offset = {}, 0
    for name in paths:
        end = raw.index(b'\n', offset)
        fields = raw[offset:end].split()
        assert len(fields) == 3 and fields[1] == b'blob', 'Invalid Git batch object'
        size, start = int(fields[2]), end + 1
        assert raw[start + size:start + size + 1] == b'\n', 'Truncated Git batch'
        entries[name] = raw[start:start + size]
        offset = start + size + 1
    entries['AGENTS.md'] = entries.pop('integration/AGENTS.distribution.md')
    manifest = {'schema_version': 1, 'version': '0.9.1', 'provenance': 'docs/PROVENANCE.md',
                'files': {name: hashlib.sha256(data).hexdigest() for name, data in entries.items()}}
    data = (json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode()
    assert hashlib.sha256(data).hexdigest() == EXPECTED, 'Harness release bytes differ'
    if destination.exists() and any(destination.iterdir()):
        raise ValueError('Destination must be empty')
    entries['RELEASE.json'] = data
    for name, content in entries.items():
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--destination', required=True, type=Path)
    args = parser.parse_args()
    prepare(args.source, args.destination)
