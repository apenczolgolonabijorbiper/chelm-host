"""Reconstruct the byte-exact harness 0.7.0 test distribution from its pinned source."""
import argparse
import ast
import hashlib
import json
from pathlib import Path

EXPECTED = '2154ea76f5184afdb76e73f7c15f324bef2a51e2afccd645c231cb75dbdecb80'


def prepare(source, destination):
    source, destination = Path(source), Path(destination)
    assert (source / 'VERSION').read_text().strip() == '0.7.0', 'Wrong harness version'
    module = ast.parse((source / 'tools/build-release.py').read_text())
    names = next(ast.literal_eval(statement.value) for statement in module.body
                 if isinstance(statement, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id == 'FILES'
                         for target in statement.targets))
    entries = {name: (source / name).read_bytes() for name in names}
    entries['AGENTS.md'] = (source / 'integration/AGENTS.distribution.md').read_bytes()
    manifest = {'schema_version': 1, 'version': '0.7.0', 'provenance': 'docs/PROVENANCE.md',
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
