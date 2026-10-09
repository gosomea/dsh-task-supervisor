import copy
import tempfile
import unittest

from monitor import Journal, observe
from native_fault import native_request_fault


def fixture():
    events = [{'type': 'turn/end', 'seq': 50, 'time': 10000,
               'data': {'turn': 2, 'reason': {'kind': 'error',
                   'error': {'code': 'SERVER', 'message': 'private-url-must-not-be-exported'}}}}]
    values = {'sessionStats': {'openStep': None, 'pendingCalls': {}, 'lastTurn': 2},
              'turnBoundary': {'openTurnStartSeq': None, 'lastTurn': 2},
              'inbox': {'next-turn': [], 'next-step': []},
              'plan': {'active': True},
              'goal': {'current': {'goal': {'id': 'goal-a', 'phase': 'active'}}}}
    return events, values


class NativeFaultTests(unittest.TestCase):
    def test_only_settled_native_request_failure_is_proof(self):
        events, values = fixture()
        for condition in ('goal', 'plan'):
            proof = native_request_fault(events, values, condition, 'a' * 64)
            self.assertEqual(proof['errorCode'], 'SERVER')
            self.assertNotIn('message', str(proof))
        self.assertIsNone(native_request_fault(events, values, 'supervisor-independent', 'a' * 64))
        self.assertIsNone(native_request_fault(events, values, 'plan', 'unverified'))

    def test_native_queue_or_newer_step_prevents_premature_stop(self):
        events, values = fixture()
        for family, field, value in (
                ('inbox', 'next-turn', ['queued']), ('inbox', 'next-step', ['queued']),
                ('sessionStats', 'openStep', 1), ('sessionStats', 'pendingCalls', {'a': {}}),
                ('turnBoundary', 'openTurnStartSeq', 49), ('sessionStats', 'lastTurn', 3),
                ('plan', 'pending', True)):
            changed = copy.deepcopy(values); changed[family][field] = value
            self.assertIsNone(native_request_fault(events, changed, 'plan', 'a' * 64))
        self.assertIsNone(native_request_fault(events + [{'type': 'step/start'}], values, 'plan', 'a' * 64))
        events[0]['data']['reason']['error']['code'] = 'UNKNOWN'
        self.assertIsNone(native_request_fault(events, values, 'plan', 'a' * 64))

    def test_two_observations_resume_original_and_do_not_grant(self):
        events, values = fixture()
        proof = native_request_fault(events, values, 'plan', 'a' * 64)
        view = {'idle': True, 'nativeRequestFault': proof,
                'nativeState': {'taskPhase': 'planning'},
                'planApprovalReady': {'questionId': 'unused'}}
        started = {'id': 'position', 'sessionId': 'session-a', 'condition': 'plan', 'deadlineAtUnix': 1000}
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(directory)
            observe(journal, started, lambda _: view,
                    lambda _: self.fail('grant while request fault unresolved'),
                    lambda *_: self.fail('first observation must allow native settling'),
                    clock=lambda: 10, max_ticks=1)
            terminal = observe(Journal(directory), started, lambda _: view,
                lambda _: self.fail('do not rescue'), lambda *_: {'acknowledged': True}, clock=lambda: 70)
            self.assertEqual(terminal['firstStopReason'], 'native-upstream-fault')
            self.assertTrue(terminal['infrastructureFault'])
            self.assertFalse(terminal['controllerComplete'])
            self.assertEqual(terminal['requestFaultEvidence']['seq'], 50)
            self.assertEqual(terminal['rescueCount'], 0)


if __name__ == '__main__':
    unittest.main()
