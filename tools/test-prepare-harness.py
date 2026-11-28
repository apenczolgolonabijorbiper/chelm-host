"""Synthetic integrity/error checks for the published-package downloader."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
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
        files = {'VERSION': b'0.13.0\n', 'docs/example.md': b'Synthetic only.\n'}
        manifest = json.dumps({'schema_version': 1, 'version': '0.13.0', 'files': {k: module.digest(v) for k,v in files.items()}}).encode()
        self.members = [('golem-harness/' + k,v) for k,v in files.items()] + [('golem-harness/RELEASE.json', manifest)]
        self.pinned = {'version': '0.13.0', 'archive': 'synthetic.zip', 'manifest_sha256': module.digest(manifest)}
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

    def test_unsupported_version_refused_before_output(self):
        with self.assertRaisesRegex(ValueError,'Unsupported'):
            module.prepare(self.root/'out',version='9.9.9',archive=self.archive)
        self.assertFalse((self.root/'out').exists())

    def test_candidate_requires_digest_and_does_not_change_approvals(self):
        before = (self.root/'compatibility.json').read_bytes()
        with self.assertRaisesRegex(ValueError,'explicit archive'):
            module.prepare(self.root/'out',version='0.13.0',archive=self.archive,candidate=True)
        result=module.prepare(self.root/'out',version='0.13.0',archive=self.archive,candidate=True,sha256=module.digest(self.archive.read_bytes()))
        self.assertFalse(result['production_approved'])
        self.assertEqual((self.root/'compatibility.json').read_bytes(),before)

class QualificationTests(unittest.TestCase):
    def load(self, name):
        spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name+'.py'))
        value = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(value)
        return value

    def test_plan_keeps_reference_approved_neighbors_and_newest(self):
        planner = self.load('harness-qualification-plan')
        releases = [{'tag_name':'v'+v,'prerelease':False,'assets':[{'name':'release.zip'}]} for v in ['0.9.1','0.10.0','0.11.0','0.12.0','0.13.0','0.13.3','0.14.0']]
        plan = planner.plan({'reference_version':'0.13.0','approved_releases':{'0.13.0':{},'0.13.3':{}}},releases,'0.15.0-rc.1')['include']
        self.assertEqual({r['version'] for r in plan},{'0.11.0','0.12.0','0.13.0','0.13.3','0.14.0','0.15.0-rc.1'})
        self.assertEqual([r['version'] for r in plan if r['approved']],['0.13.0','0.13.3'])

    def test_plan_never_selects_releases_below_the_supported_minimum(self):
        planner = self.load('harness-qualification-plan')
        catalog = {'minimum_harness_version':'0.11.0','reference_version':'0.13.0',
                   'approved_releases':{'0.11.0':{},'0.13.0':{},'0.15.0':{}}}
        releases = [{'tag_name':'v'+v,'prerelease':False,'assets':[{'name':'release.zip'}]}
                    for v in ['0.8.0','0.9.1','0.10.0','0.11.0','0.12.0','0.13.0','0.14.0','0.15.0','0.16.0']]
        selected = planner.plan(catalog,releases)['include']
        self.assertEqual([r['version'] for r in selected],['0.11.0','0.12.0','0.13.0','0.15.0','0.16.0'])
        for candidate in ['0.9.1','0.10.0','0.11.0-rc.1']:
            with self.assertRaisesRegex(ValueError,'minimum 0.11.0'):
                planner.plan(catalog,releases,candidate)
        self.assertIn('0.16.0-rc.1',[r['version'] for r in planner.plan(catalog,releases,'0.16.0-rc.1')['include']])

    def test_manual_qualification_rejects_below_floor_before_package_access(self):
        qualifier = self.load('qualify-harness')
        planner = self.load('harness-qualification-plan')
        with tempfile.TemporaryDirectory() as output, patch.object(qualifier,'module',return_value=planner):
            self.assertFalse(qualifier.qualify('0.10.0',output))
            report = json.loads((Path(output)/'0.10.0.json').read_text())
            self.assertEqual(report['phase'],'version-policy')
            self.assertIn('minimum 0.11.0',report['diagnostic'])
            self.assertNotIn('package',report)

    def test_failed_stale_or_different_package_evidence_cannot_be_promoted(self):
        promoter = self.load('promote-harness')
        identity = {'version':'0.13.0','archive_sha256':'a'*64,'manifest_sha256':'b'*64}
        catalog = {'requirements':{}}
        report = {'status':'pass','required':{},'package':identity.copy(),'features':{'file_worker':{'status':'pass','checks':[{'name':n,'exit':0,'counts':{'tests':1,'pass':1}} for n in ['file_worker','adapter','upgrade']]}}}
        self.assertEqual(promoter.validate(report,catalog,identity),['file_worker'])
        report['package']['manifest_sha256']='c'*64
        with self.assertRaisesRegex(ValueError,'official'):promoter.validate(report,catalog,identity)
        report['package']=identity.copy();report['features']['file_worker']['checks'][0]['exit']=1
        with self.assertRaisesRegex(ValueError,'conformance'):promoter.validate(report,catalog,identity)
        report['required']={'new_contract':1}
        with self.assertRaisesRegex(ValueError,'requirements'):promoter.validate(report,catalog,identity)

if __name__ == '__main__':
    unittest.main()
