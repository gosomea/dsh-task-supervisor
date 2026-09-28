"""Committed grading excludes later uncommitted and untracked Agent work."""
from pathlib import Path
import subprocess
import tempfile
import unittest

from committed_patch import extract


class CommittedPatchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dsh-committed-patch-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.git('init', '-q')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@local')
        (self.root / 'file.txt').write_text('base\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'base')
        self.base = self.git('rev-parse', 'HEAD').decode().strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args])

    def test_dirty_work_without_commit_is_not_submitted(self):
        (self.root / 'file.txt').write_text('uncommitted repair\n')
        (self.root / 'extra.txt').write_text('untracked\n')
        patch, receipt = extract(self.root, self.base)
        self.assertEqual(patch, b'')
        self.assertTrue(receipt['workingTreeDirty'])
        self.assertFalse(receipt['workingTreeSubmitted'])

    def test_committed_binary_is_exported_but_later_work_is_excluded(self):
        (self.root / 'file.txt').write_text('committed repair\n')
        (self.root / 'binary').write_bytes(b'\0\x01\x02')
        self.git('add', '.')
        self.git('commit', '-qm', 'repair')
        (self.root / 'file.txt').write_text('later work\n')
        patch, receipt = extract(self.root, self.base)
        self.assertIn(b'+committed repair', patch)
        self.assertIn(b'GIT binary patch', patch)
        self.assertNotIn(b'later work', patch)
        self.assertTrue(receipt['workingTreeDirty'])

    def test_unrelated_commit_is_rejected(self):
        self.git('checkout', '--orphan', 'other')
        self.git('commit', '-qm', 'unrelated')
        with self.assertRaises(subprocess.CalledProcessError):
            extract(self.root, self.base)


if __name__ == '__main__':
    unittest.main()
