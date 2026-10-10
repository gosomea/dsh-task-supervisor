import subprocess
import unittest
from unittest.mock import patch

from resource_observation import StorageObservationError, sample_private_storage


ROOTS = ['/volumes/client', '/volumes/private']
IDENTITY = '1:10:directory\n1:20:directory\n'
COMPLETE = '100\t/volumes/client\n200\t/volumes/private\n'
DISAPPEARED = "du: cannot access '/volumes/private/check-one/tmp': No such file or directory\n"


class Commands:
    def __init__(self, samples, *, changed=False, stat_error=False):
        self.samples = list(samples)
        self.du_calls = 0
        self.stat_calls = 0
        self.changed = changed
        self.stat_error = stat_error

    def __call__(self, command, **kwargs):
        if 'stat' in command:
            self.stat_calls += 1
            value = '1:99:directory\n1:20:directory\n' if self.changed and self.stat_calls > 1 else IDENTITY
            return subprocess.CompletedProcess(command, int(self.stat_error), value, '')
        if 'du' in command:
            self.du_calls += 1
            code, stdout, stderr = self.samples.pop(0)
            return subprocess.CompletedProcess(command, code, stdout, stderr)
        raise AssertionError('unexpected observation command')


class ResourceObservationTests(unittest.TestCase):
    def sample(self, commands):
        return sample_private_storage(['docker', '--context', 'isolated'], 'original-admin', ROOTS, run=commands)

    def test_complete_sample_keeps_apparent_bytes(self):
        commands = Commands([(0, COMPLETE, '')])
        self.assertEqual(self.sample(commands), {'bytes': 300, 'resamples': 0, 'transientMissingEntries': 0})
        self.assertEqual(commands.du_calls, 1)

    def test_disappearing_child_is_resampled_without_accepting_partial_total(self):
        commands = Commands([(1, '1\t/volumes/private\n', DISAPPEARED), (0, COMPLETE, '')])
        self.assertEqual(self.sample(commands), {'bytes': 300, 'resamples': 1, 'transientMissingEntries': 1})
        self.assertEqual(commands.du_calls, 2)

    def test_a_second_race_remains_an_observation_fault(self):
        commands = Commands([(1, COMPLETE, DISAPPEARED)] * 2)
        with self.assertRaisesRegex(StorageObservationError, 'both bounded samples'):
            self.sample(commands)
        self.assertEqual(commands.du_calls, 2)

    def test_missing_root_and_foreign_path_are_not_admissible_races(self):
        for path in ['/volumes/private', '/volumes/private-other/tmp', '/volumes/private/../outside']:
            with self.subTest(path=path):
                error = f"du: cannot access '{path}': No such file or directory\n"
                commands = Commands([(1, COMPLETE, error)])
                with self.assertRaises(StorageObservationError):
                    self.sample(commands)
                self.assertEqual(commands.du_calls, 1)

    def test_access_denial_mixed_errors_and_unknown_exit_are_not_retried(self):
        for code, error in [(1, 'du: cannot read directory: Permission denied\n'),
                            (1, DISAPPEARED + 'unexpected daemon error\n'), (125, DISAPPEARED), (1, '')]:
            with self.subTest(code=code, error=error):
                commands = Commands([(code, COMPLETE, error)])
                with self.assertRaises(StorageObservationError):
                    self.sample(commands)
                self.assertEqual(commands.du_calls, 1)

    def test_root_replacement_is_rejected_even_after_successful_du(self):
        commands = Commands([(0, COMPLETE, '')], changed=True)
        with self.assertRaisesRegex(StorageObservationError, 'roots changed'):
            self.sample(commands)

    def test_missing_root_identity_is_rejected_before_sampling(self):
        commands = Commands([], stat_error=True)
        with self.assertRaisesRegex(StorageObservationError, 'identity unavailable'):
            self.sample(commands)
        self.assertEqual(commands.du_calls, 0)

    def test_malformed_or_partial_success_does_not_become_zero_usage(self):
        for stdout in ['', '100\t/volumes/client\n', '-1\t/volumes/client\n200\t/volumes/private\n',
                       COMPLETE + '200\t/volumes/private\n', COMPLETE.replace('/volumes/private', '/foreign')]:
            with self.subTest(stdout=stdout):
                with self.assertRaises(StorageObservationError):
                    self.sample(Commands([(0, stdout, '')]))

    def test_success_with_stderr_and_transport_timeout_remain_faults(self):
        with self.assertRaises(StorageObservationError):
            self.sample(Commands([(0, COMPLETE, 'warning\n')]))
        with self.assertRaises(subprocess.TimeoutExpired):
            sample_private_storage(['docker'], 'admin', ROOTS,
                                   run=lambda *args, **kwargs: (_ for _ in ()).throw(subprocess.TimeoutExpired('stat', 30)))

    def test_sample_still_enforces_the_original_storage_limit(self):
        from execution import with_resources
        replies = [b'10', b'{"CPUPerc":"0.1%","MemUsage":"1MiB / 8GiB"}',
                   b'[{"Id":"admin","Config":{"Labels":{"dsh.long-horizon.lease":"lease"}}}]']
        spec = {'storageLimitBytes': 1000, 'checkStorageLimitBytes': 250,
                'dockerContext': 'isolated', 'condition': 'supervisor-independent'}
        gateway = {'adminId': 'admin', 'lease': 'lease',
                   'volumes': {'client': {'path': ROOTS[0]}, 'private': {'path': ROOTS[1]}}}
        with patch('execution.subprocess.check_output', side_effect=replies), patch(
                'execution.sample_private_storage', return_value={'bytes': 300, 'resamples': 1, 'transientMissingEntries': 2}):
            view = with_resources({}, 'original-box', spec, gateway)
        self.assertTrue(view['storageExceeded'])
        self.assertEqual(view['resources']['privateCheckStorageBytes'], 300)
        self.assertEqual(view['resources']['checkStorageSampleRetries'], 1)


if __name__ == '__main__':
    unittest.main()
