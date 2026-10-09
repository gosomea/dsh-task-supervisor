import copy
import unittest

from native_completion import plan_completion_evidence


def fixture():
    return ([{'type': 'turn/end', 'seq': 50, 'time': 10000,
              'data': {'turn': 2, 'reason': {'kind': 'completed'}}}],
            {'sessionStats': {'openStep': None, 'pendingCalls': {}, 'lastTurn': 2},
             'turnBoundary': {'openTurnStartSeq': None, 'lastTurn': 2},
             'inbox': {'next-turn': [], 'next-step': []}, 'plan': {'active': False}})


class NativeCompletionTests(unittest.TestCase):
    def test_current_completed_turn_is_native_plan_finish_proof(self):
        events, values = fixture()
        proof = plan_completion_evidence(events, values, 'a' * 64)
        self.assertEqual(proof['seq'], 50)
        self.assertEqual(proof['nativeStoppedAtUnix'], 10)
        self.assertIsNone(plan_completion_evidence(events, values, 'unverified'))

    def test_queue_new_turn_or_failed_turn_cannot_use_old_response_as_completion(self):
        events, values = fixture()
        values['turnOutline'] = {'turns': [{'response': 'old response'}]}
        for family, field, value in (
                ('inbox', 'next-turn', ['queued']), ('inbox', 'next-step', ['queued']),
                ('sessionStats', 'openStep', 1), ('sessionStats', 'pendingCalls', {'a': {}}),
                ('turnBoundary', 'openTurnStartSeq', 49), ('sessionStats', 'lastTurn', 3),
                ('plan', 'active', True), ('plan', 'pending', True)):
            changed = copy.deepcopy(values); changed[family][field] = value
            self.assertIsNone(plan_completion_evidence(events, changed, 'a' * 64))
        for kind in ('error', 'max-tokens', 'blocked', 'aborted'):
            changed = copy.deepcopy(events); changed[0]['data']['reason']['kind'] = kind
            self.assertIsNone(plan_completion_evidence(changed, values, 'a' * 64))
        self.assertIsNone(plan_completion_evidence(events + [{'type': 'step/start'}], values, 'a' * 64))
        del values['inbox']
        self.assertIsNone(plan_completion_evidence(events, values, 'a' * 64))
