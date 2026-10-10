from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase

from batch import next_operation, validate_release, run_batch
import hashlib
import json
from unittest.mock import patch


class OriginalPositionTests(TestCase):
    def test_repair_release_can_only_acknowledge_exact_preexisting_result(self):
        for acknowledgement in ('exact', 'different', 'missing'):
            with self.subTest(acknowledgement=acknowledgement), TemporaryDirectory() as directory:
                root = Path(directory) / 'release'; root.mkdir()
                runs = Path(directory) / 'runs'; (runs / 'p').mkdir(parents=True)
                (root / 'specs').mkdir(); (root / 'specs/p.json').write_text('{}')
                order = root / 'order.json'; order.write_text(json.dumps({'positions': [{'id': 'p'}]}))
                result = runs / 'p/result.json'
                result.write_text(json.dumps({'terminal': {'infrastructureFault': True,
                    'firstStopReason': 'native-upstream-fault'}, 'gradingFault': None}))
                release = {'runnerFilesSha256': {}, 'orderSha256': hashlib.sha256(order.read_bytes()).hexdigest(),
                    'specsSha256': {'p': hashlib.sha256(b'{}').hexdigest()}}
                if acknowledgement != 'missing':
                    release['acknowledgedSealedFaults'] = {'p': hashlib.sha256(result.read_bytes()).hexdigest()
                        if acknowledgement == 'exact' else '0' * 64}
                (root / 'release.json').write_text(json.dumps(release))
                if acknowledgement == 'exact':
                    run_batch(root, runs, 'python', 'localhost',
                              invoke=lambda *_: self.fail('no replacement delivery or regrading'))
                    kinds = [json.loads(p.read_text())['kind'] for p in (runs / 'batch-events').glob('*.json')]
                    self.assertIn('acknowledged-prior-fault', kinds)
                    self.assertIn('matrix-sealed', kinds)
                else:
                    with self.assertRaisesRegex(RuntimeError, 'stop new delivery'):
                        run_batch(root, runs, 'python', 'localhost',
                                  invoke=lambda *_: self.fail('no model delivery'))

    def test_restarts_follow_original_position_without_delivery(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            self.assertEqual(next_operation(root), 'run')
            for name, operation in [('started.json', 'observe'), ('terminal.json', 'collect'),
                                    ('collection.json', 'collect'), ('collection-complete.json', 'grade'), ('result.json', None)]:
                (root / name).write_text('{}')
                self.assertEqual(next_operation(root), operation)

    def test_collection_fault_requires_exact_ack_before_next_delivery(self):
        with TemporaryDirectory() as directory:
            root = Path(directory) / 'release'; root.mkdir()
            runs = Path(directory) / 'runs'; (runs / 'p').mkdir(parents=True)
            (root / 'specs').mkdir(); (root / 'specs/p.json').write_text('{}')
            order = root / 'order.json'; order.write_text(json.dumps({'positions': [{'id': 'p'}]}))
            outcome = runs / 'p/result.json'; outcome.write_text(json.dumps({'terminal': {
                'infrastructureFault': False, 'firstStopReason': 'internal-review-fault'},
                'collectionInfrastructureFault': True, 'gradingFault': None}))
            release = {'runnerFilesSha256': {}, 'orderSha256': hashlib.sha256(order.read_bytes()).hexdigest(),
                'specsSha256': {'p': hashlib.sha256(b'{}').hexdigest()}}
            (root / 'release.json').write_text(json.dumps(release))
            with self.assertRaisesRegex(RuntimeError, 'stop new delivery'):
                run_batch(root, runs, 'python', 'localhost', invoke=lambda *_: self.fail('no model delivery'))
            release['acknowledgedSealedFaults'] = {'p': hashlib.sha256(outcome.read_bytes()).hexdigest()}
            (root / 'release.json').write_text(json.dumps(release))
            run_batch(root, runs, 'python', 'localhost', invoke=lambda *_: self.fail('no replacement delivery'))

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

    def test_server_restart_cannot_silently_change_the_run_environment(self):
        release = {'runnerFilesSha256': {}, 'capacity': {'dockerContext': 'isolated'},
            'runtimeInventory': {'server': {'containerId': 'server', 'imageId': 'image', 'startedAt': 'original'}}}
        row = {'Image': 'image', 'State': {'Running': True, 'StartedAt': 'restarted'}}
        with patch('batch.subprocess.check_output', return_value=json.dumps([row]).encode()):
            with self.assertRaisesRegex(ValueError, 'restarted'): validate_release(release, Path('.'))
