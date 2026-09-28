import json
from pathlib import Path
import tempfile
import unittest

from read_control import read_control


class ControlTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='dsh-control-reader-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.trial = self.root / 'trial'
        (self.trial / 'verifier').mkdir(parents=True)

    def fixture(self, reward, passed=None, failed=None, **extra):
        (self.trial / 'result.json').write_text(json.dumps({
            'verifier_result': {'rewards': {'reward': reward}}, **extra}))
        if passed is not None:
            (self.trial / 'verifier/ctrf.json').write_text(json.dumps({'results': {'summary': {
                'tests': passed + failed, 'passed': passed, 'failed': failed,
                'skipped': 0, 'pending': 0, 'other': 0}}}))

    def test_script_zero_without_running_tests_is_unscored(self):
        self.fixture(0)
        result = read_control(self.root)
        self.assertIsNone(result['reward'])
        self.assertEqual(result['rawReward'], 0)
        self.assertEqual(result['fault'], 'verifier-test-report-missing')

    def test_actual_pass_and_fail_are_scored(self):
        for reward, passed, failed in [(1, 7, 0), (0, 0, 7)]:
            self.fixture(reward, passed, failed)
            result = read_control(self.root)
            self.assertEqual(result['reward'], reward)
            self.assertTrue(result['scored'])
            self.assertIsNone(result['fault'])

    def test_exception_redacts_private_details(self):
        self.fixture(0, exception_info={'exception_type': 'RuntimeError',
                                       'exception_message': 'https://private.invalid/signed?token=secret'})
        result = read_control(self.root)
        self.assertEqual(result['fault'], 'harbor-exception')
        self.assertNotIn('secret', json.dumps(result))

    def test_empty_or_inconsistent_summary_cannot_pass(self):
        for reward, passed, failed in [(1, 0, 0), (1, 0, 7), (True, 7, 0)]:
            self.fixture(reward, passed, failed)
            self.assertIsNone(read_control(self.root)['reward'])


if __name__ == '__main__':
    unittest.main()
