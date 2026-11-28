"""Select the reference, all approved versions, eligible older neighbors and newest candidate."""
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare_harness',ROOT/'tools/prepare-harness.py')
download=importlib.util.module_from_spec(spec)
spec.loader.exec_module(download)

DEFAULT_MINIMUM = '0.11.0'

def version_core(value):
    match = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9.-]+)?', value)
    if not match:
        raise ValueError('Invalid Harness version: ' + value)
    return tuple(map(int, match.groups()))

def qualification_minimum(catalog):
    minimum = catalog.get('minimum_harness_version', DEFAULT_MINIMUM)
    if not re.fullmatch(r'\d+\.\d+\.\d+', minimum):
        raise ValueError('Qualification minimum must be a stable version')
    return minimum

def require_minimum(catalog, value):
    minimum = qualification_minimum(catalog)
    core, floor = version_core(value), version_core(minimum)
    if core < floor or core == floor and '-' in value:
        raise ValueError('Harness ' + value + ' is below the qualification minimum ' + minimum)

def plan(catalog,releases,candidate=None):
    version=version_core
    floor=version(qualification_minimum(catalog))
    reference=version(catalog['reference_version'])
    stable=sorted({r['tag_name'][1:] for r in releases if not r.get('draft') and not r.get('prerelease') and re.fullmatch(r'v\d+\.\d+\.\d+',r['tag_name']) and any(a['name'].endswith('.zip') for a in r.get('assets',[])) and version_core(r['tag_name'][1:])>=floor},key=version)
    selected=set(catalog['approved_releases'])|{catalog['reference_version']}
    for value in selected:require_minimum(catalog,value)
    selected.update([v for v in stable if version(v)<reference and v not in selected][-2:])
    newer=[v for v in stable if version(v)>reference and v not in selected]
    if newer:selected.add(newer[-1])
    if candidate:
        require_minimum(catalog,candidate)
        selected.add(candidate)
    return {'include':[{'version':v,'approved':v in catalog['approved_releases']} for v in sorted(selected,key=lambda v:(version(v), '-' not in v, v))]}

if __name__=='__main__':
    releases=[]
    # Traverse the full release listing, including older neighbors beyond page one.
    for page in range(1,11):
        rows=json.loads(download.download('https://api.github.com/repos/apenczolgolonabijorbiper/golem14-harness/releases?per_page=100&page='+str(page)))
        releases.extend(rows)
        if len(rows)<100:break
    print(json.dumps(plan(json.loads((ROOT/'harness-compatibility.json').read_text()),releases,sys.argv[1] if len(sys.argv)>1 and sys.argv[1] else None)))
