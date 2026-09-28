import unittest

from metrics import collect, usage_coverage


class MetricTests(unittest.TestCase):
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
