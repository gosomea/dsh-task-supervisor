from collections import Counter
import unittest

from freeze import matrix, development_gate


class FrozenMatrixTests(unittest.TestCase):
    def test_order_is_deterministic_and_has_complete_paired_denominator(self):
        tasks = ['a', 'b', 'c', 'd']
        first = matrix(tasks)
        self.assertEqual(first, matrix(list(reversed(tasks))))
        rows = first['positions']
        self.assertEqual(len(rows), 24)
        self.assertEqual(len({row['id'] for row in rows}), 24)
        self.assertEqual(set(Counter((row['taskId'], row['condition']) for row in rows).values()), {2})
        self.assertEqual(set(row['repeat'] for row in rows), {1, 2})

    def test_duplicate_tasks_cannot_inflate_the_denominator(self):
        with self.assertRaisesRegex(ValueError, 'distinct'): matrix(['a', 'b', 'c', 'a'])

    def test_exposed_development_runs_supervisor_only_twice_per_task(self):
        value = matrix(['a', 'b', 'c', 'd'], development=True)
        self.assertEqual(value, matrix(['d', 'c', 'b', 'a'], development=True))
        self.assertEqual(len(value['positions']), 8)
        self.assertEqual({row['condition'] for row in value['positions']}, {'supervisor-independent'})
        self.assertEqual(set(Counter(row['taskId'] for row in value['positions']).values()), {2})
        self.assertEqual(value['scope'], 'exposed-supervisor-development')
        self.assertEqual(len(matrix(['a', 'b', 'c', 'd'])['positions']), 24)

    def test_old_or_different_package_and_incomplete_development_cannot_admit(self):
        for value in ({'step': 3, 'status': 'validated'}, {'step': 4, 'status': 'validated', 'candidate7': {'tarballSha256': 'other'}}):
            with self.assertRaises(ValueError): development_gate(value, 'frozen')
        value = {'step': 4, 'status': 'validated', 'candidate7': {'tarballSha256': 'frozen'}, 'cases': []}
        with self.assertRaisesRegex(ValueError, 'cross-product'): development_gate(value, 'frozen')
