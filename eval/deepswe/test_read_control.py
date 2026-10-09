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
                'skipped': 0, 'pending': 0, 'other': 0}, 'tests': [
                    {'name': f'pass-{i}', 'status': 'passed'} for i in range(passed)] + [
                    {'name': f'fail-{i}', 'status': 'failed'} for i in range(failed)]}}))

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

    def test_f2p_p2p_require_official_row_classification(self):
        self.fixture(0, 1, 1)
        path = self.trial / 'verifier/ctrf.json'
        report = json.loads(path.read_text())
        self.assertIsNone(read_control(self.root)['F2P'])
        report['results']['tests'][0]['name'] = '[p2p] retained behavior'
        report['results']['tests'][1]['name'] = '[f2p] missing behavior'
        path.write_text(json.dumps(report))
        result = read_control(self.root)
        self.assertEqual(result['F2P']['rate'], 0)
        self.assertEqual(result['P2P']['rate'], 1)

    def test_missing_or_mismatched_test_details_are_unscored(self):
        for rows, fault in [([], 'invalid-test-details'),
                            ([{'name': 'a', 'status': 'failed'}] * 7, 'test-details-summary-mismatch')]:
            self.fixture(1, 7, 0)
            path = self.trial / 'verifier/ctrf.json'
            report = json.loads(path.read_text())
            report['results']['tests'] = rows
            path.write_text(json.dumps(report))
            result = read_control(self.root)
            self.assertFalse(result['scored'])
            self.assertEqual(result['fault'], fault)

    def test_official_missing_result_failure_keeps_score_and_reports_execution_gap(self):
        self.fixture(0, 1, 1)
        path = self.trial / 'verifier/ctrf.json'
        report = json.loads(path.read_text())
        report['results']['tests'][1]['message'] = 'missing from report (test did not run or produced no result …)'
        path.write_text(json.dumps(report))
        result = read_control(self.root)
        self.assertEqual(result['reward'], 0)
        self.assertEqual(result['execution'], {'reportedPositions': 2, 'missingResultPositions': 1,
            'positionsWithResult': 1, 'allPositionsHaveResult': False})

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
