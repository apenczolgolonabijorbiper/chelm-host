"""Require complete, disjoint Windows shard evidence for one immutable package."""
import argparse
import hashlib
import json
from pathlib import Path


def check(root, count=4):
    summaries = sorted(Path(root).rglob('windows-qualification.json'))
    if len(summaries) != count:
        raise ValueError('Missing or extra shard summaries')
    identity = inventory = None
    seen_shards, covered = set(), []
    for path in summaries:
        value = json.loads(path.read_text())
        index, total = map(int, value['shard'].split('/'))
        if (value['profile'] != 'reliability' or total != count or
                index not in range(1, count + 1) or index in seen_shards):
            raise ValueError('Invalid or duplicate shard')
        seen_shards.add(index)
        package = (value['archive_sha256'], value['manifest_sha256'])
        files = value['all_test_files']
        if identity is None:
            identity, inventory = package, files
        if package != identity or files != inventory or files != sorted(set(files)) or not files:
            raise ValueError('Shards disagree on package or complete test inventory')
        selected = [test for i, test in enumerate(files) if i % count == index - 1]
        if not selected or selected != value['test_files']:
            raise ValueError('Shard selection mismatch')
        covered.extend(selected)

        def report(entry):
            name = entry['report']
            if Path(name).name != name:
                raise ValueError('Unsafe report path')
            data = (path.parent / name).read_bytes()
            if hashlib.sha256(data).hexdigest() != entry['report_sha256']:
                raise ValueError('Retained report hash mismatch')
            result = json.loads(data)
            if result['platform'] != 'win32' or result['packages']['host']['manifest_sha256'] != identity[1]:
                raise ValueError('Report package/platform mismatch')
            if result['all_test_files'] != inventory:
                raise ValueError('Report test inventory mismatch')
            return result

        def required(entry, repeat, expected_files):
            result = report(entry)
            if entry['exit'] != 0 or result['test_files'] != expected_files or len(result['attempts']) != repeat:
                raise ValueError('Incomplete required attempts')
            for number, attempt in enumerate(result['attempts'], 1):
                counts = attempt['counts']
                if (attempt['attempt'] != number or attempt['exit'] != 0 or attempt['error'] or attempt['signal'] or
                        not counts['tests'] or counts['tests'] != counts['pass'] or
                        any(counts.get(key, 0) for key in ('fail', 'cancelled', 'skipped'))):
                    raise ValueError('Required attempt failed, skipped or incomplete')
            return result

        comparisons = {entry['label']: entry for entry in value['comparisons']}
        if len(comparisons) != len(value['comparisons']):
            raise ValueError('Duplicate comparison labels')
        supported = required(comparisons['supported'], 3, selected)
        policy = supported['policy']
        if (policy['concurrency'] != 2 or policy['repeat'] != 3 or policy.get('name') or
                policy['attempt-ms'] != 600000 or policy.get('shard', '1/1') != value['shard']):
            raise ValueError('Supported policy mismatch')
        for concurrency in (4, 1):
            result = report(comparisons['qualification-concurrency-' + str(concurrency)])
            if result['test_files'] != selected or len(result['attempts']) != 1:
                raise ValueError('Missing retained diagnostic')
        individual = []
        for entry in value['individual_files']:
            result = report(entry)
            if len(result['test_files']) != 1 or result['policy'].get('name'):
                raise ValueError('Invalid individual-file attempt')
            individual.extend(result['test_files'])
            required(entry, 1, result['test_files'])
        if individual != selected:
            raise ValueError('Missing or duplicate individual-file coverage')
        if index == 1:
            result = required(comparisons['mcp-standalone'], 10, ['tests/conformance/cognitive.test.mjs'])
            expected = '^Independent authenticated MCP client completes and reconnects to the same snapshot/result contract$'
            if result['policy'].get('name') != expected or any(a['counts']['tests'] != 1 for a in result['attempts']):
                raise ValueError('Standalone MCP selection mismatch')
    if sorted(covered) != inventory:
        raise ValueError('Incomplete or overlapping suite coverage')
    return {'shards': count, 'test_files': len(inventory), 'required_passes_per_file': 3,
            'archive_sha256': identity[0], 'manifest_sha256': identity[1]}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reports', type=Path)
    args = parser.parse_args()
    print(json.dumps(check(args.reports), indent=2))
