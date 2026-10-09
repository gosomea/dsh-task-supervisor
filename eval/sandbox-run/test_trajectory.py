import json
import unittest

from trajectory import summarize_trajectory


def header(identity, parent=None):
    return {'type': 'session', 'id': identity, 'parentSession': parent}


def record(namespace, kind, payload):
    return {'type': 'extension/record', 'data':
        {'namespace': namespace, 'kind': kind, 'payload': payload}}


class TrajectoryTests(unittest.TestCase):
    def test_lineage_task_binding_and_duplicate_job_updates(self):
        task = {'id': 'task-current', 'planVersion': 1, 'stages': [{'id': 'a'}, {'id': 'b'}],
                'nodeRuns': [{'id': 'a', 'attempt': 2, 'status': 'passed'},
                             {'id': 'b', 'attempt': 1, 'status': 'pending'}],
                'objective': 'private-canary'}
        job = {'id': 'job', 'taskId': 'task-current', 'kind': 'stage',
               'mainSessionId': 'main', 'reviewerSessionId': 'review'}
        sessions = {
            'main': [header('main'), {'type': 'turn/start'}, {'type': 'step/start'},
                record('dsh-task-supervisor', 'state', {**task, 'planVersion': 0}),
                record('dsh-task-supervisor', 'state', task),
                record('dsh-task-supervisor', 'state', {**task, 'id': 'task-other', 'stages': []}),
                record('dsh-task-supervisor-review', 'job', job),
                record('dsh-task-supervisor-review', 'job', {**job, 'status': 'applied'})],
            'review': [header('review', 'main'), {'type': 'step/start'},
                {'type': 'tool/call'}, {'type': 'compaction/end'}],
            'worker': [header('worker', 'review'), {'type': 'turn/start'},
                {'type': 'tool/result', 'data': {'message': {'isError': True}}}],
            'unrelated': [header('unrelated'), {'type': 'tool/call'}],
        }
        value = summarize_trajectory(sessions, 'main', 'task-current')
        self.assertEqual(value['linkedSessions'], 3)
        self.assertEqual(value['excludedUnrelatedSessions'], 1)
        self.assertEqual(value['allToolCalls'], 1)
        self.assertEqual(value['allToolErrors'], 1)
        self.assertEqual(value['allModelSteps'], 2)
        self.assertEqual(value['allContextCompactions'], 1)
        self.assertEqual(value['supervisorTask']['declaredNodes'], 2)
        self.assertEqual(value['supervisorTask']['currentNodeAttemptOrdinalsSum'], 3)
        self.assertEqual(value['supervisorTask']['observedPlanVersions'], [0, 1])
        self.assertEqual(value['supervisorTask']['reviewJobsByKind']['stage'], 1)
        self.assertEqual(value['supervisorTask']['reviewWindows']['unknownWindows'], 1)
        self.assertIsNone(value['supervisorTask']['reviewWindows']['totalObservedJobWindowMs'])
        self.assertNotIn('private-canary', json.dumps(value))

    def test_missing_binding_or_old_node_runs_does_not_invent_nodes_or_attempts(self):
        sessions = {'main': [header('main'), record('dsh-task-supervisor', 'state',
            {'id': 'old', 'planVersion': 1, 'stages': [{'id': 'a'}]})]}
        self.assertIsNone(summarize_trajectory(sessions, 'main')['supervisorTask'])
        task = summarize_trajectory(sessions, 'main', 'old')['supervisorTask']
        self.assertEqual(task['declaredNodes'], 1)
        self.assertIsNone(task['currentNodeAttemptOrdinalsSum'])
        self.assertIsNone(task['nodeStatuses'])
        with self.assertRaises(ValueError):
            summarize_trajectory(sessions, 'missing')

    def test_turn_end_reasons_use_durable_kind_without_private_detail(self):
        sessions = {
            'main': [header('main'), {'type': 'turn/end', 'data': {'reason':
                {'kind': 'max-tokens', 'detail': 'private-canary'}}}],
            'review': [header('review', 'main'), {'type': 'turn/end', 'data': {'reason':
                {'kind': 'completed'}}}, {'type': 'turn/end', 'data': {'reason':
                {'kind': 'https://private-canary/auth'}}}],
            'other': [header('other'), {'type': 'turn/end', 'data': {'reason': {'kind': 'aborted'}}}],
        }
        value = summarize_trajectory(sessions, 'main')
        self.assertEqual(value['allTurnEndReasons'], {'max-tokens': 1, 'completed': 1, 'unclassified': 1})
        self.assertNotIn('aborted', value['allTurnEndReasons'])
        self.assertNotIn('private-canary', json.dumps(value))


if __name__ == '__main__':
    unittest.main()
