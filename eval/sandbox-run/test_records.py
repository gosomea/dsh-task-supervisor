"""Sealed records cannot be overwritten, including competing writers."""
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from records import exclusive_json
from select_sample import CONDITIONS, order


class SealedRecordTests(TestCase):
    def test_two_writers_leave_one_complete_record(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'result.json'
            def write(value):
                try:
                    exclusive_json(path, {'value': value, 'payload': 'x' * 10000})
                    return True
                except FileExistsError:
                    return False
            with ThreadPoolExecutor(2) as pool:
                result = list(pool.map(write, (1, 2)))
            self.assertEqual(sum(result), 1)
            self.assertIn(json.loads(path.read_text())['value'], (1, 2))
            self.assertEqual(list(Path(directory).iterdir()), [path])

    def test_invalid_result_never_creates_a_seal(self):
        with TemporaryDirectory() as directory:
            path = Path(directory) / 'result.json'
            with self.assertRaises(ValueError):
                exclusive_json(path, {'reward': float('nan')})
            self.assertFalse(path.exists())
            self.assertEqual(list(Path(directory).iterdir()), [])

    def test_formal_matrix_is_complete_unique_and_reproducible(self):
        tasks = ['go-a', 'go-b', 'ts-a', 'ts-b']
        rows = order(tasks)
        self.assertEqual(len(rows), 24)
        self.assertEqual(len({row['id'] for row in rows}), 24)
        self.assertEqual({(row['taskId'], row['repeat'], row['condition']) for row in rows},
            {(task, repeat, condition) for task in tasks for repeat in (1, 2) for condition in CONDITIONS})
        self.assertEqual(rows, order(list(reversed(tasks))))
        with self.assertRaises(ValueError):
            order(['a', 'a', 'b', 'c'])
