import copy
import unittest

from completion import completion_evidence


class CompletionEvidenceTests(unittest.TestCase):
    def fixture(self):
        task = {'id': 'task', 'revision': 8, 'phase': 'complete', 'requirementsVersion': 1,
            'completedAt': '1970-01-01T00:01:39Z', 'lastReview': {'jobId': 'job'}}
        job = {'id': 'job', 'revision': 6, 'status': 'applied', 'kind': 'completion',
            'taskId': 'task', 'mainSessionId': 'session', 'input': {'requirementsVersion': 1},
            'decision': {'verdict': 'pass'}}
        events = [{'type': 'extension/record', 'seq': i, 'time': 99000,
            'data': {'namespace': ns, 'kind': kind, 'payload': payload}}
            for i, ns, kind, payload in [(1, 'dsh-task-supervisor-review', 'job', job),
                (2, 'dsh-task-supervisor', 'state', task)]]
        return events, {'condition': 'supervisor-independent', 'sessionId': 'session', 'deadlineAtUnix': 100}

    def test_completion_inside_last_polling_gap_qualifies(self):
        events, started = self.fixture()
        proof = completion_evidence(events, {}, started)
        self.assertEqual(proof['atUnix'], 99)
        self.assertEqual(proof['reviewJobId'], 'job')

    def test_foreign_unapplied_late_or_reopened_completion_cannot_qualify(self):
        events, started = self.fixture()
        for key, value in [('status', 'submitted'), ('mainSessionId', 'foreign'), ('kind', 'stage')]:
            changed = copy.deepcopy(events); changed[0]['data']['payload'][key] = value
            self.assertIsNone(completion_evidence(changed, {}, started))
        events[1]['time'] = 101000
        self.assertIsNone(completion_evidence(events, {}, started))
        events[1]['data']['payload']['phase'] = 'active'
        self.assertIsNone(completion_evidence(events, {}, started))

    def test_plan_aborted_final_round_is_not_completion(self):
        started = {'condition': 'plan', 'sessionId': 'session', 'deadlineAtUnix': 100}
        values = {'plan': {'active': False}, 'turnOutline': {'turns': [{'response': 'done'}]},
            'sessionStats': {'openStep': None, 'pendingCalls': []}}
        end = {'type': 'turn/end', 'seq': 8, 'time': 99000, 'data': {'reason': {'kind': 'completed'}}}
        self.assertIsNotNone(completion_evidence([end], values, started))
        end['data']['reason']['kind'] = 'aborted'
        self.assertIsNone(completion_evidence([end], values, started))
