"""Synthetic evidence controls; these do not claim actual Windows qualification."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('coverage_gate', Path(__file__).with_name('check-windows-reliability.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EvidenceControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.files = ['tests/conformance/cognitive.test.mjs', 'tests/one.test.mjs',
                      'tests/three.test.mjs', 'tests/two.test.mjs']
        self.paths = []
        for index in range(1, 5):
            folder = self.root / str(index)
            folder.mkdir()
            selected = self.files[index-1:index]
            summary = dict(profile='reliability', shard=f'{index}/4', archive_sha256='archive',
                           manifest_sha256='manifest', all_test_files=self.files,
                           test_files=selected, comparisons=[], individual_files=[])
            def entry(label, files, repeat, concurrency=1, name=None):
                policy = {'concurrency': concurrency, 'repeat': repeat, 'attempt-ms': 600000, 'shard': f'{index}/4'}
                if name:
                    policy['name'] = name
                result = dict(platform='win32', packages={'host': {'manifest_sha256': 'manifest'}},
                              all_test_files=self.files, test_files=files, policy=policy,
                              attempts=[dict(attempt=i, exit=0, error=None, signal=None,
                                             counts={'tests': 1, 'pass': 1, 'fail': 0, 'cancelled': 0, 'skipped': 0})
                                        for i in range(1, repeat+1)])
                path = folder / (label + '.json')
                path.write_text(json.dumps(result))
                return dict(label=label, exit=0, report=path.name,
                            report_sha256=hashlib.sha256(path.read_bytes()).hexdigest())
            summary['comparisons'].append(entry('supported', selected, 3, 2))
            for concurrency in (4, 1):
                summary['comparisons'].append(entry(f'qualification-concurrency-{concurrency}', selected, 1, concurrency))
            if index == 1:
                summary['comparisons'].append(entry('mcp-standalone', selected, 10,
                    name='^Independent authenticated MCP client completes and reconnects to the same snapshot/result contract$'))
            summary['individual_files'].append(entry('individual', selected, 1))
            path = folder / 'windows-qualification.json'
            path.write_text(json.dumps(summary))
            self.paths.append(path)

    def mutate_summary(self, fn):
        path = self.paths[0]
        value = json.loads(path.read_text())
        fn(value)
        path.write_text(json.dumps(value))

    def mutate_report(self, fn):
        path = self.paths[0].parent / 'supported.json'
        value = json.loads(path.read_text())
        fn(value)
        path.write_text(json.dumps(value))
        self.mutate_summary(lambda v: v['comparisons'][0].update(report_sha256=hashlib.sha256(path.read_bytes()).hexdigest()))

    def test_complete(self):
        self.assertEqual(module.check(self.root)['test_files'], 4)

    def test_missing(self):
        self.paths.pop().unlink()
        with self.assertRaises(ValueError): module.check(self.root)

    def test_duplicate_shard(self):
        self.mutate_summary(lambda v: v.update(shard='2/4'))
        with self.assertRaises(ValueError): module.check(self.root)

    def test_overlapping_selection(self):
        self.mutate_summary(lambda v: v.update(test_files=self.files[1:2]))
        with self.assertRaises(ValueError): module.check(self.root)

    def test_mixed_package(self):
        self.mutate_summary(lambda v: v.update(archive_sha256='another archive'))
        with self.assertRaises(ValueError): module.check(self.root)

    def test_masked_failed_attempt(self):
        self.mutate_report(lambda v: v['attempts'][0].update(exit=1))
        with self.assertRaises(ValueError): module.check(self.root)

    def test_skipped_attempt(self):
        self.mutate_report(lambda v: v['attempts'][0]['counts'].update(skipped=1))
        with self.assertRaises(ValueError): module.check(self.root)

    def test_report_tampering(self):
        path = self.paths[0].parent / 'supported.json'
        path.write_text(path.read_text()+' ')
        with self.assertRaises(ValueError): module.check(self.root)

    def test_missing_individual(self):
        self.mutate_summary(lambda v: v.update(individual_files=[]))
        with self.assertRaises(ValueError): module.check(self.root)


if __name__ == '__main__':
    unittest.main()
