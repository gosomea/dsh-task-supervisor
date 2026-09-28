import json
from pathlib import Path
import tempfile
import unittest

from summarize_pilot import primary, summarize


class SummaryTests(unittest.TestCase):
    def test_native_failure_and_unknown_grade_are_distinct(self):
        self.assertFalse(primary({'terminal': {'nativeFinished': False}, 'grade': {'reward': 1},
                                 'route': {'routesMatched': True, 'protocolDeviation': False}}))
        self.assertIsNone(primary({'terminal': {'nativeFinished': True, 'finishedBeforeDeadline': True,
                                             'cleanupAcknowledged': True}, 'grade': {'reward': None, 'fault': 'timeout'}}))
        self.assertIsNone(primary({'terminal': {'nativeFinished': True, 'finishedBeforeDeadline': True},
                                  'grade': {'reward': 1}}))

    def test_full_denominator_and_missing_usage_survive_partial_batch(self):
        protocol = json.loads(Path(__file__).with_name('sample-20260928.json').read_text())
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = protocol['order'][0]
            attempt = root / 'attempts' / first['id']
            attempt.mkdir(parents=True)
            (attempt / 'started.json').write_text('{}')
            (attempt / 'result.json').write_text(json.dumps({**first, 'terminal': {
                'status': 'native-complete', 'nativeFinished': True, 'finishedBeforeDeadline': True,
                'cleanupAcknowledged': True}, 'grade': {'reward': 1, 'fault': None},
                'route': {'routesMatched': True, 'protocolDeviation': False}}))
            result = summarize(root, protocol)
            self.assertEqual((result['planned'], result['started'], result['sealed']), (16, 1, 1))
            goal = result['conditions']['goal']
            self.assertEqual((goal['primarySuccesses'], goal['unknownPrimary']), (1, 3))
            self.assertEqual(goal['successRateBounds'], [0.25, 1])
            self.assertIsNone(goal['successRate'])
            self.assertIsNone(goal['allSessionTokenSumMeasured'])
            self.assertEqual(goal['tokenUnknownPositions'], 4)
            self.assertEqual(goal['scalarMetrics']['extraCheckCpuNs'], {
                'measuredSum': None, 'measuredPositions': 0, 'unknownPositions': 4})
            self.assertEqual(len(result['positions']), 16)
            self.assertTrue(all(row['unknown'] == 4 for row in result['paired']))
            (attempt / 'result.json').write_text(json.dumps({**first, 'repeat': 9}))
            with self.assertRaises(ValueError):
                summarize(root, protocol)

    def test_route_failure_does_not_drop_or_count_a_position_as_valid_success(self):
        result = {'terminal': {'nativeFinished': True, 'finishedBeforeDeadline': True,
                               'cleanupAcknowledged': True}, 'grade': {'reward': 1, 'fault': None}}
        self.assertIsNone(primary(result))
        result['route'] = {'routesMatched': False, 'protocolDeviation': True}
        self.assertIsNone(primary(result))
        result['route'] = {'routesMatched': True, 'protocolDeviation': False,
                           'decisionVerified': False}
        result['terminal']['nativeFinished'] = False
        self.assertFalse(primary(result))


if __name__ == '__main__':
    unittest.main()
