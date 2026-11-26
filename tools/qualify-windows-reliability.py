"""Verify one release ZIP and run focused or extended Windows checks.

This optional qualification supplements the ordinary staged release gates.
Serial/parallel suite failures are retained diagnostics; every individual file
must pass. Extended comparisons use the default 600-second attempt bound.
"""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile


def qualify(package, harness, output, profile='qualification'):
    package, harness, output = (Path(p).resolve() for p in (package, harness, output))
    output.mkdir(parents=True, exist_ok=True)
    archive_hash = hashlib.sha256(package.read_bytes()).hexdigest()
    checksum = package.with_suffix(package.suffix + '.sha256').read_text().split()
    if checksum != [archive_hash, package.name]:
        raise ValueError('Package checksum mismatch')
    with tempfile.TemporaryDirectory(prefix='chelm-windows-qualification-') as directory:
        stage = Path(directory) / 'chelm-host'
        with zipfile.ZipFile(package) as archive:
            manifest = json.loads(archive.read('chelm-host/RELEASE.json'))
            expected = {'chelm-host/' + name for name in manifest['files']} | {'chelm-host/RELEASE.json'}
            names = archive.namelist()
            if len(names) != len(set(names)) or set(names) != expected:
                raise ValueError('Package inventory mismatch')
            for name in names:
                parts = name.split('/')
                if parts[0] != 'chelm-host' or any(p in {'', '.', '..'} for p in parts) or '\\' in name:
                    raise ValueError('Unsafe package member')
                data = archive.read(name)
                relative = '/'.join(parts[1:])
                if relative != 'RELEASE.json' and hashlib.sha256(data).hexdigest() != manifest['files'][relative]:
                    raise ValueError('Package member hash mismatch: ' + relative)
                target = Path(directory).joinpath(*parts)
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
        env = {**os.environ, 'CHELM_HARNESS_ROOT': str(harness),
               'CHELM_PROVIDER_HARNESS_ROOT': str(harness), 'GOLEM_PYTHON': sys.executable}
        subprocess.run(['node', str(stage / 'integration/install-dependencies.mjs')], cwd=stage, env=env, check=True)
        base = ['node', str(stage / 'tools/run-tests.mjs'), '--report', str(output)]
        summary = {'archive_sha256': archive_hash, 'version': manifest['version'],
                   'manifest_sha256': hashlib.sha256((stage / 'RELEASE.json').read_bytes()).hexdigest(),
                   'comparisons': [], 'individual_files': []}

        def run(label, args, group):
            result = subprocess.run([*base, '--label', label, *args], cwd=stage, env=env)
            report = output / ('tests-' + label + '-win32.json')
            if not report.is_file():
                raise RuntimeError('Missing retained attempt report: ' + label)
            summary[group].append({'label': label, 'exit': result.returncode, 'report': report.name,
                                   'report_sha256': hashlib.sha256(report.read_bytes()).hexdigest()})
            (output / 'windows-qualification.json').write_text(json.dumps(summary, indent=2) + '\n')
            return result.returncode

        if profile != 'qualification':
            subprocess.run(['node', str(stage / 'bin/chelm.mjs'), 'verify',
                            '--harness', str(harness), '--python', sys.executable],
                           cwd=stage, env=env, check=True)
            cases = ['Independent authenticated MCP client completes and reconnects to the same snapshot/result contract']
            if profile == 'focused':
                cases.extend([
                    'MCP response loss after commit is labelled and reconciles one durable result after reconnect',
                    'VF-6: bounded Windows sharing retries preserve atomic replacement and propagate other failures',
                    'Owned timeout occurs after child startup, kills descendants, preserves unrelated sentinel',
                    'Abrupt caller termination leaves supervisor able to clean its owned child tree',
                    'Owned normal success and thrown error preserve exit/output and remove descendants',
                    'SEC-2: paths reject traversal, drives, reserved Git and links',
                    'CON-2: launching a CLI through an OS path alias still emits JSON',
                    'NFR-1: unloaded Windows profiles use the actual OS SID and fail closed on lookup errors',
                    'Config-2 local/file/stdio and remote queue enforce preference, retain owner retry and allow submission after a switch',
                    'Runtime schema seed, local preferred registration and reserved-principal refusal are explicit',
                ])
            pattern = '^(' + '|'.join(cases) + ')$'
            args = ['--name', pattern, '--attempt-ms', '180000']
            if profile == 'smoke':
                args += ['--file', 'tests/conformance/cognitive.test.mjs']
            if run(profile, args, 'comparisons'):
                raise RuntimeError('Packaged Windows ' + profile + ' checks failed')
            log = (output / ('tests-' + profile + '-win32-1.log')).read_text(encoding='utf-8')
            for case in cases:
                if not re.search(r'^ok \d+ - ' + re.escape(case) + '$', log, re.MULTILINE):
                    raise RuntimeError('Required Windows case did not pass: ' + case)
            return

        # Both use the same immutable package, fixture code and finite budget.
        for concurrency in (4, 1):
            run('qualification-concurrency-' + str(concurrency), ['--concurrency', str(concurrency)], 'comparisons')
        # The owner's index omits the four historical filenames. Cover all files
        # separately rather than guessing which four produced its 34 tests.
        failures = []
        for index, test in enumerate(sorted((stage / 'tests').rglob('*.test.mjs'))):
            relative = test.relative_to(stage).as_posix()
            label = 'qualification-file-' + str(index).zfill(2)
            if run(label, ['--concurrency', '1', '--file', relative], 'individual_files'):
                failures.append(relative)
        if failures:
            raise RuntimeError('Individual-file failures retained: ' + ', '.join(failures))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--package', required=True, type=Path)
    parser.add_argument('--harness', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--profile', choices=['qualification', 'smoke', 'focused'], default='qualification')
    args = parser.parse_args()
    if os.name != 'nt':
        parser.error('Windows qualification requires Windows')
    qualify(args.package, args.harness, args.output, args.profile)
