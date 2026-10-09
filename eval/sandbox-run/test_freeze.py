from collections import Counter
import unittest

from freeze import matrix


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
