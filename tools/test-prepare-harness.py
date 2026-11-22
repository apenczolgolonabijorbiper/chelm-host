"""Synthetic integrity/error checks for the published-package downloader."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('prepare_harness', Path(__file__).with_name('prepare-harness.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PublishedPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original_root = module.ROOT
        module.ROOT = self.root
        self.addCleanup(setattr, module, 'ROOT', self.original_root)
        files = {'VERSION': b'0.11.0\n', 'docs/example.md': b'Synthetic only.\n'}
        manifest = json.dumps({'schema_version': 1, 'version': '0.11.0', 'files': {k: module.digest(v) for k,v in files.items()}}).encode()
        self.members = [('golem-harness/' + k,v) for k,v in files.items()] + [('golem-harness/RELEASE.json', manifest)]
        self.pinned = {'version': '0.11.0', 'archive': 'synthetic.zip', 'manifest_sha256': module.digest(manifest)}
        self.archive = self.root / 'input.zip'
        self.save(self.members)

    def save(self, members):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as package:
            for name, data in members:
                package.writestr(name,data)
        self.archive.write_bytes(output.getvalue())
        self.pinned['archive_sha256'] = module.digest(output.getvalue())
        (self.root / 'compatibility.json').write_text(json.dumps({'published_harness': self.pinned}))

    def test_extract_exact_bytes_and_refuse_existing_destination(self):
        module.prepare(self.root / 'out', archive=self.archive)
        self.assertEqual((self.root / 'out/docs/example.md').read_bytes(), b'Synthetic only.\n')
        with self.assertRaises(ValueError):module.prepare(self.root / 'out', archive=self.archive)

    def test_corrupt_archive_refused_before_output(self):
        self.archive.write_bytes(self.archive.read_bytes()+b'changed')
        with self.assertRaisesRegex(ValueError, 'archive hash'):module.prepare(self.root / 'out', archive=self.archive)
        self.assertFalse((self.root / 'out').exists())

    def test_wrong_manifest_hash_refused(self):
        self.pinned['manifest_sha256'] = '0'*64
        (self.root / 'compatibility.json').write_text(json.dumps({'published_harness': self.pinned}))
        with self.assertRaisesRegex(ValueError, 'manifest hash'):module.prepare(self.root / 'out', archive=self.archive)

    def test_traversal_refused(self):
        self.save(self.members+[('golem-harness/../escape',b'unsafe')])
        with self.assertRaisesRegex(ValueError, 'Unsafe'):module.prepare(self.root / 'out', archive=self.archive)
        self.assertFalse((self.root / 'escape').exists())

    def test_inventory_mismatch_refused(self):
        self.save(self.members+[('golem-harness/unlisted',b'extra')])
        with self.assertRaisesRegex(ValueError, 'inventory'):module.prepare(self.root / 'out', archive=self.archive)

if __name__ == '__main__':
    unittest.main()
