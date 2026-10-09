from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from batch import next_operation, validate_release
import hashlib


class OriginalPositionTests(TestCase):
    def test_restarts_follow_original_position_without_delivery(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(next_operation(root), 'run')
            for name, operation in [('started.json', 'observe'), ('terminal.json', 'collect'),
                                    ('collection.json', 'collect'), ('collection-complete.json', 'grade'), ('result.json', None)]:
                (root / name).write_text('{}')
                self.assertEqual(next_operation(root), operation)

    def test_unknown_delivery_cannot_be_resubmitted(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); (root / 'delivery-intent.json').write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'no new model'): next_operation(root)

    def test_external_runtime_change_stops_new_delivery(self):
        with TemporaryDirectory() as directory:
            root = Path(directory); runtime = root / 'sdk.py'; runtime.write_bytes(b'frozen')
            release = {'runnerFilesSha256': {}, 'runtimeFilesSha256': {
                str(runtime): hashlib.sha256(runtime.read_bytes()).hexdigest()}}
            validate_release(release, root)
            runtime.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'runtime input differs'):
                validate_release(release, root)
