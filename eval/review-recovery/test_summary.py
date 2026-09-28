import unittest
from summary import summarize


def event(job):
    return {'type': 'extension/record', 'data': {'namespace': 'dsh-task-supervisor-review', 'payload': job}}


class AuditTests(unittest.TestCase):
    def test_recovery_and_faults_are_separate_from_decisions(self):
        base = {'id': 'a', 'kind': 'progress', 'runtimeId': 'first', 'reviewerSessionId': 'review-a',
                'attemptStartedAt': '2026-09-28T00:00:00+00:00', 'status': 'started'}
        events = [event(base), event({**base, 'status': 'repairing', 'fault': {'code': 'protocol-missing'}}),
                  event({**base, 'status': 'applied', 'decision': {'verdict': 'pass'}, 'finishedAt': '2026-09-28T00:00:02+00:00'})]
        result = summarize(events)
        self.assertEqual(result['jobs'], 1)
        self.assertEqual(result['protocolMissingJobs'], 1)
        self.assertEqual(result['jobsRecoveredAfterRepair'], 1)
        self.assertEqual(result['effectiveNeedsUserJobs'], 0)
        self.assertEqual(result['reviewWaitMs'], 2000)
        self.assertIsNone(result['falsePauseRate'])
        self.assertIsNone(result['correctionsConfirmed'])

    def test_manual_wait_is_not_model_wait_and_labels_are_required(self):
        base = {'id': 'a', 'kind': 'stage', 'runtimeId': 'first', 'status': 'failed',
                'fault': {'code': 'provider'}, 'attemptStartedAt': '2026-09-28T00:00:00+00:00',
                'finishedAt': '2026-09-28T00:00:01+00:00'}
        recovered = {**base, 'runtimeId': 'retry', 'fault': None, 'status': 'applied',
                     'decision': {'verdict': 'needs-user'}, 'attemptStartedAt': '2026-09-28T01:00:00+00:00',
                     'finishedAt': '2026-09-28T01:00:02+00:00'}
        result = summarize([event(base), event(recovered)], {'a': {'drift': False}})
        self.assertEqual(result['manualRecoveryWindows'], 1)
        self.assertEqual(result['reviewWaitMs'], 3000)
        self.assertEqual(result['effectiveNeedsUserJobs'], 1)
        self.assertEqual(result['falsePauseRate'], 1)
        self.assertEqual(result['faultsByCode'], {'provider': 1})

    def test_empty_sample_and_legacy_timing_stay_unknown(self):
        self.assertIsNone(summarize([])['protocolMissingRate'])
        result = summarize([event({'id': 'a', 'kind': 'plan', 'runtimeId': 'r', 'status': 'failed',
                                   'finishedAt': '2026-09-28T00:00:00+00:00'})])
        self.assertIsNone(result['reviewWaitMs'])
        self.assertEqual(result['unmeasuredOrUnfinishedWindows'], 1)


if __name__ == '__main__':
    unittest.main()
