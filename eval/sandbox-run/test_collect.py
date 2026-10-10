import json
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import patch
from collect import collect, collection_recovery, grade
from preparation_identity import file_digest

from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from opensandbox.exceptions import SandboxApiException
from collect import destroy_original, protocol_action_metrics
from monitor import Journal


class CollectionRecoveryTests(unittest.TestCase):
    def test_goal_creation_is_one_action_and_plan_approval_is_a_second_action(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(directory); journal.write('delivery-receipt.json', {'accepted': True})
            journal.write('actions/initial-approval-receipt.json', {'transport': 'native-goal-command'})
            self.assertEqual(protocol_action_metrics(journal)['protocolUserActions'], 1)
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(directory); journal.write('delivery-receipt.json', {'accepted': True})
            journal.write('actions/initial-approval-receipt.json', {'transport': 'native-question-answer'})
            self.assertEqual(protocol_action_metrics(journal)['protocolUserActions'], 2)

    def test_unknown_delivery_does_not_invent_a_user_action_count(self):
        with tempfile.TemporaryDirectory() as directory:
            self.assertIsNone(protocol_action_metrics(Journal(directory))['protocolUserActions'])

    def test_destroy_lost_response_reconciles_exact_absence(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(directory); runtime = Mock()
            runtime.connect.side_effect = SandboxApiException(status_code=404)
            destroy_original(runtime, journal, 'original')
            destroy_original(runtime, journal, 'original')
            self.assertTrue(journal.read('sandbox-destroyed.json')['reconciledLifecycleNotFound'])
            runtime.connect.assert_called_once_with('original')
            runtime.destroy.assert_not_called()

    def test_connection_fault_cannot_prove_destroyed(self):
        with tempfile.TemporaryDirectory() as directory:
            journal = Journal(directory); runtime = Mock()
            runtime.connect.side_effect = SandboxApiException(status_code=503)
            with self.assertRaises(SandboxApiException): destroy_original(runtime, journal, 'original')
            self.assertIsNone(journal.read('sandbox-destroyed.json'))


class OriginalCollectionTests(TestCase):
    def setUp(self):
        directory = TemporaryDirectory(); self.addCleanup(directory.cleanup)
        self.journal = Journal(Path(directory.name))
        self.journal.write('preparation-reconciliation.json', {'originalRejection': True})
        self.child = self.journal.root / 'preparation-recovery' / file_digest(
            self.journal.root / 'preparation-reconciliation.json')
        ready = {'specSha256': 'a' * 64, 'sandboxId': 'original-worker', 'gateway': {'lease': 'child-lease'}}
        Journal(self.child).write('prepared.json', ready)
        self.ready = {**ready, 'preparationRecovery': {'attemptDirectory': str(self.child)}}
        self.journal.write('prepared.json', self.ready)
        self.journal.write('gateway/gateway-cleanup.json', {'lease': 'old-rejected-lease'})
        self.journal.write('started.json', {'sessionId': 'original-session', 'id': 'position',
            'condition': 'supervisor-independent'})
        self.journal.write('terminal.json', {'sessionId': 'original-session', 'cleanup': {'acknowledged': True},
            'controllerComplete': True, 'finishedBeforeDeadline': True, 'infrastructureFault': False})
        self.collection = self.journal.write('collection.json', {'sandboxId': 'original-worker',
            'sessionId': 'original-session', 'home': str(self.journal.root / 'home'), 'filesSha256': {}})
        self.journal.write('sandbox-destroyed.json', {'sandboxId': 'original-worker', 'destroyed': True})

    def record_recovery(self, **changes):
        value = {'schemaVersion': 1, 'kind': 'recovered-gateway-collection-ownership',
            'source': 'evaluation-protocol-runner-repair', 'modelRequests': 0, 'agentReruns': 0,
            'authorizationActions': 0, 'gatewayLease': 'child-lease', 'gatewayRoot': str(self.child / 'gateway'),
            'originalExecutionStopped': True, 'faultEvidenceSha256': 'f' * 64,
            'originalRecordsSha256': {name: file_digest(self.journal.root / name) for name in
                ('started.json', 'prepared.json', 'terminal.json', 'collection.json', 'sandbox-destroyed.json')}}
        return self.journal.write('collection-reconciliation.json', {**value, **changes})

    def test_partial_collection_uses_original_child_storage_and_never_reconnects_worker(self):
        runtime = Mock(); originals = {path: file_digest(path) for path in self.journal.root.rglob('*.json')}
        with patch('gateway.stop_gateway') as stop, patch('gateway.archive_storage',
                side_effect=[RuntimeError('temporary archive failure'), None]) as archive:
            with self.assertRaisesRegex(RuntimeError, 'archive failure'):
                collect(runtime, {}, self.journal)
            self.assertIsNone(self.journal.read('collection-complete.json'))
            self.assertEqual(collect(runtime, {}, self.journal), self.collection)
            for call in stop.call_args_list + archive.call_args_list:
                self.assertEqual(call.kwargs['root'], self.child / 'gateway')
                self.assertEqual(call.args[0]['lease'], 'child-lease')
        self.assertEqual(runtime.mock_calls, [])
        self.assertTrue(self.journal.read('collection-complete.json')['artifactsAndOwnedCheckStorageCollected'])
        self.assertEqual(originals, {path: file_digest(path) for path in originals})

    def test_foreign_promoted_identity_cannot_stop_or_archive_any_gateway(self):
        for bad in ({**self.ready, 'preparationRecovery': {'attemptDirectory': '/foreign'}},
                    {**self.ready, 'gateway': {'lease': 'foreign'}}, {**self.ready, 'sandboxId': 'foreign'}):
            with self.subTest(bad=bad), patch.object(self.journal, 'read', side_effect=lambda name:
                    bad if name == 'prepared.json' else json.loads((self.journal.root / name).read_text())
                    if (self.journal.root / name).exists() else None), patch('gateway.stop_gateway') as stop, \
                    patch('gateway.archive_storage') as archive:
                with self.assertRaisesRegex(RuntimeError, 'differs'): collect(Mock(), {}, self.journal)
                stop.assert_not_called(); archive.assert_not_called()
                self.assertIsNone(self.journal.read('collection-complete.json'))

    def test_reconciliation_is_bound_to_exact_original_records_and_no_authority(self):
        self.assertIsNone(collection_recovery(self.journal))
        value = self.record_recovery()
        self.assertEqual(collection_recovery(self.journal)['originalRecordsSha256'], value['originalRecordsSha256'])
        for key, bad in [('gatewayLease', 'foreign'), ('gatewayRoot', '/foreign'),
                         ('modelRequests', 1), ('agentReruns', 1), ('authorizationActions', 1),
                         ('originalRecordsSha256', {}), ('faultEvidenceSha256', 'private-url')]:
            with self.subTest(key=key), patch.object(self.journal, 'read', side_effect=lambda name:
                    {**value, key: bad} if name == 'collection-reconciliation.json' else
                    json.loads((self.journal.root / name).read_text()) if (self.journal.root / name).exists() else None):
                with self.assertRaisesRegex(RuntimeError, 'reconciliation differs'):
                    collection_recovery(self.journal)

    def test_recovered_collection_keeps_real_reward_but_excludes_strict_success(self):
        import sys
        sys.path.append(str(Path(__file__).resolve().parents[1] / 'deepswe'))
        self.record_recovery()
        self.journal.write('collection-complete.json', {'artifactsAndOwnedCheckStorageCollected': True})
        with patch('metrics.read_home', return_value=({}, {}, {})), patch('metrics.collect', return_value={}), \
                patch('collect.execution_metrics', return_value={}), \
                patch('collect.development_grade', return_value={'reward': 1, 'fault': None}):
            result = grade({'case': 'fixture'}, self.journal)
        self.assertEqual(result['reward'], 1)
        self.assertFalse(result['strictSuccess'])
        self.assertTrue(result['collectionInfrastructureFault'])
        self.assertFalse(result['terminal']['infrastructureFault'])
        self.assertEqual(result['collectionRecovery']['gatewayLease'], 'child-lease')


if __name__ == '__main__': unittest.main()
