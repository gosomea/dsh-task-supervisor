import json
import unittest

from public_results import metrics, result


class PublicResultsTests(unittest.TestCase):
    def test_only_explicit_safe_fields_leave_private_result(self):
        private = 'https://private.example/auth?token=credential-canary'
        source = {
            'id': 'lh-01-task-plan-r1', 'condition': 'plan', 'taskId': 'task', 'repeat': 1,
            'formal': True, 'reward': 0, 'strictSuccess': False, 'gradingFault': None,
            'terminal': {'sessionId': 'session-test', 'firstStopReason': 'completed',
                'controllerComplete': True, 'finishedBeforeDeadline': True,
                'infrastructureFault': False, 'privateUrl': private, 'cleanup': {'detail': private},
                'nativeCompletionEvidence': {'kind': 'native-plan-turn-completed',
                    'seq': 580, 'turn': 1, 'nativeStoppedAtUnix': 1791560982.206,
                    'controllerSourceSha256': '2f' * 32,
                    'basis': 'completed-current-turn-and-empty-queues', 'rawEvent': private}},
            'officialGrade': {'reward': 0, 'scored': True, 'fault': None,
                'privatePath': private, 'tests': {'tests': 2, 'passed': 1, 'failed': 1},
                'F2P': {'total': 1, 'passed': 0, 'failed': 1, 'rate': 0, 'message': private}},
            'metrics': {'allSessionTokens': None, 'tokensReported': {'outputTokens': 14},
                'sessions': [{'sessionId': 'session-test', 'tokensReported': {'outputTokens': 14},
                    'prompt': private}], 'rawModel': private},
            'finding': private, 'announcedCompleteOfficialFailed': True,
            'collectionInfrastructureFault': True,
            'collectionRecovery': {'kind': 'recovered-gateway-collection-ownership', 'gatewayRoot': private,
                'faultEvidenceSha256': 'f' * 64, 'modelRequests': 0, 'authorizationActions': 0},
        }
        public = result(source)
        self.assertNotIn('credential-canary', json.dumps(public))
        self.assertEqual(public['reward'], 0)
        self.assertEqual(public['officialGrade']['F2P']['passed'], 0)
        self.assertIsNone(public['metrics']['allSessionTokens'])
        self.assertEqual(public['metrics']['tokensReported']['outputTokens'], 14)
        self.assertEqual(public['terminal']['nativeCompletionEvidence']['seq'], 580)
        self.assertEqual(public['terminal']['nativeCompletionEvidence']['controllerSourceSha256'], '2f' * 32)
        self.assertTrue(public['collectionInfrastructureFault'])
        self.assertEqual(public['collectionRecovery']['faultEvidenceSha256'], 'f' * 64)

    def test_missing_or_invalid_usage_never_becomes_zero(self):
        public = metrics({'allSessionTokens': None, 'tokensReported': None,
                          'requestCount': 'private/path', 'extraCheckCpuNs': None})
        self.assertIsNone(public['allSessionTokens'])
        self.assertIsNone(public['requestCount'])
        self.assertIsNone(public['extraCheckCpuNs'])


if __name__ == '__main__':
    unittest.main()
