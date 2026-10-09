import json
import unittest

from review_windows import summarize_review_windows


def row(seq, time, status, attempt=1, job='review', kind='stage', task='task', **extra):
    return ({'seq': seq, 'time': time}, {'id': job, 'taskId': task, 'mainSessionId': 'main',
        'kind': kind, 'status': status, 'attempt': attempt, **extra})


class ReviewWindowTests(unittest.TestCase):
    def test_same_job_retry_and_duplicate_terminal_are_one_window(self):
        records = [row(1, 1000, 'queued'), row(2, 1100, 'started'),
            row(3, 5100, 'failed'), row(4, 5300, 'queued'),
            row(5, 5600, 'started', 2), row(6, 8000, 'applied', 2),
            row(7, 9000, 'applied', 2)]
        value = summarize_review_windows(records, 'main', 'task')
        self.assertEqual(len(value['jobs']), 1)
        self.assertEqual(value['jobs'][0]['observedReviewAttempts'], 2)
        self.assertEqual(value['jobs'][0]['terminalRecordSeq'], 6)
        self.assertEqual(value['jobs'][0]['observedStartedWindowMs'], 6900)
        self.assertEqual(value['totalObservedJobWindowMs'], 7000)
        self.assertEqual(value['observedUnionWindowMs'], 7000)

    def test_overlap_and_nested_jobs_are_not_double_counted_in_union(self):
        records = [row(1, 1000, 'started', job='a'), row(2, 2000, 'started', job='b'),
            row(3, 2500, 'started', job='c', kind='progress'),
            row(4, 3000, 'applied', job='c', kind='progress'),
            row(5, 5000, 'applied', job='a'), row(6, 6000, 'applied', job='b')]
        value = summarize_review_windows(records, 'main', 'task')
        self.assertEqual(value['totalObservedJobWindowMs'], 8500)
        self.assertEqual(value['observedUnionWindowMs'], 5000)
        self.assertEqual(value['byKind']['stage']['totalObservedJobWindowMs'], 8000)
        self.assertEqual(value['byKind']['progress']['totalObservedJobWindowMs'], 500)

    def test_missing_times_unfinished_and_backwards_windows_remain_unknown(self):
        cases = [[row(1, None, 'started'), row(2, 2000, 'failed')],
                 [row(1, 1000, 'started')],
                 [row(1, 2000, 'started'), row(2, 1000, 'stale')],
                 [row(1, 2000, 'applied')],
                 [row(1, True, 'started'), row(2, 2000, 'failed')]]
        for records in cases:
            with self.subTest(records=records):
                value = summarize_review_windows(records, 'main', 'task')
                self.assertIsNone(value['totalObservedJobWindowMs'])
                self.assertIsNone(value['observedUnionWindowMs'])
                self.assertEqual(value['unknownWindows'], 1)

    def test_foreign_tasks_and_private_body_do_not_enter_report(self):
        private = 'https://private.example/auth?token=credential-canary'
        records = [row(1, 1000, 'started', finding=private), row(2, 2000, 'applied', finding=private),
                   row(3, 3000, 'started', task='other'), row(4, 9000, 'applied', task='other')]
        value = summarize_review_windows(records, 'main', 'task')
        self.assertEqual(value['totalObservedJobWindowMs'], 1000)
        self.assertEqual(len(value['jobs']), 1)
        self.assertNotIn('credential-canary', json.dumps(value))
        self.assertEqual(summarize_review_windows(records, 'foreign-main', 'task')['jobs'], [])

    def test_partially_missing_windows_do_not_become_a_known_total(self):
        records = [row(1, 1000, 'started', job='known'), row(2, 2000, 'applied', job='known'),
                   row(3, 3000, 'started', job='unknown')]
        value = summarize_review_windows(records, 'main', 'task')
        self.assertIsNone(value['totalObservedJobWindowMs'])
        self.assertIsNone(value['observedUnionWindowMs'])
        self.assertEqual(value['byKind']['stage']['unknownWindows'], 1)

    def test_cancelled_queued_retry_ends_after_the_last_terminal_transition(self):
        records = [row(1, 1000, 'started'), row(2, 5000, 'failed'),
                   row(3, 5300, 'queued'), row(4, 7000, 'failed')]
        value = summarize_review_windows(records, 'main', 'task')
        self.assertEqual(value['jobs'][0]['terminalRecordSeq'], 4)
        self.assertEqual(value['totalObservedJobWindowMs'], 6000)


if __name__ == '__main__':
    unittest.main()
