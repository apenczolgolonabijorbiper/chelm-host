"""Verify/download the published provider package; source builds are not releases."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]

def prepare(destination):
    pin = json.loads((ROOT / 'provider-compatibility.json').read_text())
    published = json.loads((ROOT / 'compatibility.json').read_text())['published_harness']
    if not pin['production_enabled'] or pin['status'] != 'published':
        raise ValueError('Provider release is not enabled')
    if any(pin[key] != published[key] for key in ('version', 'archive_sha256', 'manifest_sha256')):
        raise ValueError('Provider and published package pins disagree')
    spec = importlib.util.spec_from_file_location('published_harness', ROOT / 'tools/prepare-harness.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare(destination, version=pin['version'])

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, required=True)
    args = parser.parse_args()
    prepare(args.destination)
