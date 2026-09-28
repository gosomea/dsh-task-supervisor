"""Metadata fixtures prove sample determinism, pairing and admission refusal."""
import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from select_sample import CONDITIONS, EXCLUDED, require_admission, select, sample_sha256


class SampleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dsh-deepswe-selection-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        for name, language in [('go-one', 'go'), ('go-two', 'go'), ('ts-one', 'typescript'),
                               ('ts-two', 'typescript'), ('anko-typed-variable-bindings', 'go')]:
            task = self.root / 'tasks' / name
            task.mkdir(parents=True)
            (task / 'instruction.md').write_text('Implement behavior described by this fixture.')
            (task / 'task.toml').write_text(f'''[metadata]
language = "{language}"
repository_url = "https://example.invalid/{name}"
base_commit_hash = "base-{name}"
[verifier]
environment_mode = "separate"
timeout_sec = 1800
[agent]
timeout_sec = 10800
[environment]
docker_image = "fixture/{name}:v1"
cpus = 2
memory_mb = 8192
storage_mb = 20480
''')
        subprocess.run(['git', '-C', str(self.root), 'add', 'tasks'], check=True)
        subprocess.run(['git', '-C', str(self.root), '-c', 'user.name=fixture',
                        '-c', 'user.email=fixture@local', 'commit', '-qm', 'fixture'], check=True)
        self.commit = subprocess.check_output(['git', '-C', str(self.root), 'rev-parse', 'HEAD'], text=True).strip()

    def test_selection_and_paired_order_are_reproducible_and_complete(self):
        sample = select(self.root, self.commit)
        self.assertEqual(sample, select(self.root, self.commit))
        self.assertEqual({task['language'] for task in sample['tasks']}, {'go', 'typescript'})
        self.assertTrue(set(task['id'] for task in sample['tasks']).isdisjoint(EXCLUDED))
        self.assertEqual(len(sample['order']), 16)
        self.assertEqual(len({row['id'] for row in sample['order']}), 16)
        for task in sample['tasks']:
            for repeat in (1, 2):
                self.assertEqual({r['condition'] for r in sample['order']
                                  if r['taskId'] == task['id'] and r['repeat'] == repeat}, set(CONDITIONS))
        self.assertEqual(json.loads(json.dumps(sample)), sample)

    def test_changed_revision_or_dirty_metadata_cannot_be_selected(self):
        with self.assertRaisesRegex(ValueError, 'revision'):
            select(self.root, '0' * 40)
        (self.root / 'tasks/go-one/task.toml').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'clean'):
            select(self.root, self.commit)

    def test_candidate_sample_never_authorizes_model_delivery(self):
        sample = select(self.root, self.commit)
        digest = sample_sha256(sample)
        with self.assertRaisesRegex(ValueError, 'forbidden'):
            require_admission(sample, digest)
        sample['modelAdmitted'] = True
        sample['release'] = {}
        with self.assertRaisesRegex(ValueError, 'bound'):
            require_admission(sample, digest)
        sample['release'] = {key: 'a' * 64 for key in
                             ('runnerSha256', 'runtimeSha256', 'pluginSha256', 'profileSha256')}
        sample['release']['gates'] = {key: True for key in sample['admissionRequirements']}
        sample['release']['sampleSha256'] = digest
        for task in sample['tasks']:
            task['imageDigest'] = 'sha256:' + 'b' * 64
        require_admission(sample, digest)
        invalid = copy.deepcopy(sample)
        invalid['release']['gates'][sample['admissionRequirements'][0]] = 'true'
        with self.assertRaisesRegex(ValueError, 'requirement'):
            require_admission(invalid, digest)
        invalid = copy.deepcopy(sample)
        invalid['order'].pop()
        with self.assertRaisesRegex(ValueError, 'denominator'):
            require_admission(invalid, digest)
        invalid = copy.deepcopy(sample)
        invalid['order'][0] = copy.deepcopy(invalid['order'][1])
        with self.assertRaisesRegex(ValueError, 'immutable selection'):
            require_admission(invalid, digest)
        with self.assertRaisesRegex(ValueError, 'matrix'):
            require_admission(invalid, sample_sha256(invalid))
        invalid = copy.deepcopy(sample)
        invalid['tasks'][0]['instructionSha256'] = 'c' * 64
        with self.assertRaisesRegex(ValueError, 'immutable selection'):
            require_admission(invalid, digest)


if __name__ == '__main__':
    unittest.main()
