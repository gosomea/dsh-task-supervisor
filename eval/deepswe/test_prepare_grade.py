"""The official HEAD collector sees only the already committed submission."""
import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from committed_patch import extract
from prepare_grade import prepare, official_files


class PrepareGradeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-grade-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.agent = self.root / 'agent'
        self.agent.mkdir()
        self.git(self.agent, 'init', '-q')
        self.git(self.agent, 'config', 'user.name', 'fixture')
        self.git(self.agent, 'config', 'user.email', 'fixture@local')
        (self.agent / 'file').write_text('base\n')
        self.git(self.agent, 'add', '.')
        self.git(self.agent, 'commit', '-qm', 'base')
        self.base = self.git(self.agent, 'rev-parse', 'HEAD').decode().strip()
        self.official = self.root / 'task-fixture'
        self.official.mkdir()
        (self.official / 'task.toml').write_text(f'''[metadata]
base_commit_hash = "{self.base}"
[verifier]
environment_mode = "separate"
''')
        (self.official / 'tests').mkdir()
        (self.official / 'tests' / 'test.sh').write_text('official tests\n')
        (self.official / 'instruction.md').write_text('official instruction\n')
        self.submission = self.root / 'submission'
        self.submission.mkdir()

    def git(self, root, *args):
        return subprocess.check_output(['git', '-C', str(root), *args])

    def export(self):
        patch, receipt = extract(self.agent, self.base)
        (self.submission / 'model.patch').write_bytes(patch)
        (self.submission / 'receipt.json').write_text(json.dumps(receipt))
        return receipt

    def test_committed_binary_reaches_head_collector_and_dirty_stays_out(self):
        (self.agent / 'file').write_text('committed\n')
        (self.agent / 'binary').write_bytes(b'\0\x01\xff')
        self.git(self.agent, 'add', '.')
        self.git(self.agent, 'commit', '-qm', 'repair')
        expected_tree = self.git(self.agent, 'rev-parse', 'HEAD^{tree}')
        (self.agent / 'file').write_text('dirty later\n')
        (self.agent / 'untracked').write_text('never submit\n')
        receipt = self.export()
        staged = self.root / 'staged'
        prepare(self.official, self.submission, staged)
        self.assertEqual(official_files(staged), official_files(self.official))
        carrier = self.root / 'carrier'
        self.git(self.root, 'clone', '-q', str(self.agent), str(carrier))
        self.git(carrier, 'checkout', '-q', self.base)
        script = (staged / 'solution' / 'solve.sh').read_text().replace('cd /app', f'cd {carrier}').replace('/solution/model.patch', str(staged / 'solution' / 'model.patch'))
        subprocess.run(['bash', '-c', script], check=True, env={'PATH': '/usr/bin:/bin', 'HOME': str(self.root)})
        self.assertEqual(self.git(carrier, 'rev-parse', 'HEAD^{tree}'), expected_tree)
        collected = self.git(carrier, 'diff', '--binary', self.base, 'HEAD')
        self.assertIn(b'+committed', collected)
        self.assertIn(b'GIT binary patch', collected)
        self.assertNotIn(b'dirty later', collected)
        self.assertFalse((carrier / 'untracked').exists())
        self.assertTrue(receipt['workingTreeDirty'])
        with self.assertRaises(FileExistsError):
            prepare(self.official, self.submission, staged)

    def test_tampered_patch_rejected(self):
        self.export()
        (self.submission / 'model.patch').write_bytes(b'tampered')
        with self.assertRaises(ValueError):
            prepare(self.official, self.submission, self.root / 'staged')

    def test_uncommitted_submission_receipt_rejected(self):
        receipt = self.export()
        receipt['workingTreeSubmitted'] = True
        (self.submission / 'receipt.json').write_text(json.dumps(receipt))
        with self.assertRaises(ValueError):
            prepare(self.official, self.submission, self.root / 'staged')


if __name__ == '__main__':
    unittest.main()
