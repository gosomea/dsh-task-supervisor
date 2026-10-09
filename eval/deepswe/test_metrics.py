import unittest

from metrics import collect, usage_coverage, read_home
import json
from pathlib import Path
from tempfile import TemporaryDirectory


class MetricTests(unittest.TestCase):
    def test_plain_native_generations_and_ambiguous_identity(self):
        with TemporaryDirectory() as directory:
            home = Path(directory)
            session = home / 'sessions/main'; session.mkdir(parents=True)
            (session / 'session.jsonl').write_text(json.dumps({'type': 'session', 'id': 'old'}) + '\n')
            (session / 'session.v4.jsonl').write_text(json.dumps({'type': 'session', 'id': 'current'}) + '\n')
            sessions, _, _ = read_home(home)
            self.assertEqual(set(sessions), {'current'})
            (session / 'session.v4.jsonl.zstd').write_bytes(b'not-read-because-ambiguous')
            with self.assertRaisesRegex(ValueError, 'Ambiguous'):
                read_home(home)

    def test_native_synthetic_zero_on_provider_failure_is_not_free(self):
        events = [{'type': 'step/start', 'data': {'turn': 1, 'step': 1}},
                  {'type': 'assistant/attempt', 'data': {'turn': 1, 'step': 1,
                    'stream': [
                        {'type': 'chunk', 'chunk': {'type': 'usage', 'usage': {
                            'inputTokens': 0, 'outputTokens': 0, 'totalTokens': 0}}},
                        {'type': 'chunk', 'chunk': {'type': 'finish', 'reason': {
                            'kind': 'error', 'failure': {'code': 'SERVER'}}}}]}},
                  {'type': 'llm/retry-started', 'data': {'turn': 1, 'step': 1}},
                  {'type': 'assistant/message', 'data': {'turn': 1, 'step': 1,
                    'usage': {'inputTokens': 5}}}]
        self.assertEqual(usage_coverage(events)['unreportedAttempts'], 1)
        tokens = {'uncachedInputTokens': 5, 'outputTokens': 2,
                  'cacheReadTokens': 0, 'cacheWriteTokens': 0}
        sessions = {'main': [{'type': 'session', 'id': 'main'}, *events]}
        projections = {'main': {'record': {'rows': {'tokenUsage': {'val': tokens}}}}}
        result = collect(sessions, projections, 'main')
        self.assertFalse(result['tokenCoverageComplete'])
        self.assertIsNone(result['allSessionTokens'])
        self.assertEqual(result['tokensReported'], tokens)

    def test_interrupted_attempt_embedded_usage_is_reported(self):
        events = [{'type': 'step/start', 'data': {'turn': 1, 'step': 1}},
                  {'type': 'assistant/attempt', 'data': {'turn': 1, 'step': 1,
                    'stream': [{'type': 'chunk', 'time': 7, 'chunk': {'type': 'usage',
                               'usage': {'inputTokens': 3, 'outputTokens': 1}}}]}}]
        self.assertEqual(usage_coverage(events)['unreportedAttempts'], 0)

    def test_retry_without_usage_keeps_complete_cost_unknown(self):
        events = [{'type': 'step/start', 'data': {'turn': 1, 'step': 1}},
                  {'type': 'assistant/attempt', 'data': {'turn': 1, 'step': 1, 'stream': []}},
                  {'type': 'llm/retry-started', 'data': {'turn': 1, 'step': 1}},
                  {'type': 'assistant/message', 'data': {'turn': 1, 'step': 1, 'usage': {'inputTokens': 5}}}]
        self.assertEqual(usage_coverage(events), {'settledAttempts': 2, 'unreportedAttempts': 1, 'unsettledSteps': 0})

    def test_only_durable_lineage_counts_and_missing_review_is_unknown(self):
        tokens = {'uncachedInputTokens': 1, 'outputTokens': 2, 'cacheReadTokens': 3, 'cacheWriteTokens': 0}
        sessions = {'main': [{'type': 'session', 'id': 'main'}],
                    'child': [{'type': 'session', 'id': 'child', 'parentSession': 'main'}],
                    'other': [{'type': 'session', 'id': 'other'}]}
        projections = {sid: {'record': {'rows': {'tokenUsage': {'val': {'totals': tokens}}}}} for sid in sessions}
        result = collect(sessions, projections, 'main')
        self.assertEqual(result['allSessionTokens']['outputTokens'], 4)
        self.assertEqual(result['excludedUnrelatedSessions'], 1)
        sessions['main'].append({'type': 'extension/record', 'data': {'namespace': 'dsh-task-supervisor-review',
            'payload': {'id': 'job', 'mainSessionId': 'main', 'reviewerSessionId': 'missing'}}})
        result = collect(sessions, projections, 'main')
        self.assertIsNone(result['allSessionTokens'])
        self.assertEqual(result['missingReviewerSessions'], ['missing'])


if __name__ == '__main__':
    unittest.main()

class IndependentProtocolMetrics(unittest.TestCase):
    def test_records_check_coverage_phases_and_exact_repeated_reads(self):
        job = {'id': 'j', 'mainSessionId': 'main', 'kind': 'stage', 'reviewerSessionId': 'review', 'verificationMode': 'independent',
               'finishedAt': '2026-09-30T00:00:10+00:00', 'verification': {
                   'checkPlan': [{'checks': [{'id': 'a'}, {'id': 'b'}]}],
                   'checkFindings': [{'checkId': 'a'}, {'checkId': 'b'}],
                   'phaseTimes': {'planning': '2026-09-30T00:00:00+00:00', 'independent': '2026-09-30T00:00:02+00:00', 'comparison': '2026-09-30T00:00:07+00:00'}}}
        call = {'type': 'tool/call', 'data': {'name': 'inspect_task_artifact', 'arguments': '{"path":"x"}'}}
        sessions = {'main': [{'type': 'session', 'id': 'main'}, {'type': 'extension/record', 'data': {'namespace': 'dsh-task-supervisor-review', 'payload': job}}],
                    'review': [{'type': 'session', 'id': 'review', 'parentSession': 'main'}, call, call]}
        result = collect(sessions, {}, 'main')
        self.assertEqual(result['reviewToolCalls'], 2)
        self.assertEqual(result['repeatedExactReads'], 1)
        self.assertEqual(result['plannedIndependentChecks'], 2)
        self.assertEqual(result['recordedIndependentCheckResults'], 2)
        self.assertEqual(result['reviewPhaseDurations'][0]['independentMs'], 5000)
        self.assertIsNone(result['allSessionTokens'])
        self.assertIsNone(result['falsePauseRate'])
