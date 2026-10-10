import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import TestCase
from unittest.mock import Mock, patch

from execution import prepare
from monitor import Journal
from opensandbox_runtime import OpenSandboxRuntime
from preparation_identity import file_digest, metadata_recovery_journal, position_label


class MetadataIdentityTests(TestCase):
    def test_valid_labels_keep_the_original_identity(self):
        for value in ('a', 'a' * 63, 'lh-01-goal_r1.example'):
            self.assertEqual(position_label(value), value)

    def test_long_or_invalid_values_have_deterministic_bounded_labels(self):
        for value in ('a' * 64, '中文任务', '-leading', 'trailing.', 'space here'):
            label = position_label(value)
            self.assertEqual(label, 'lh-' + hashlib.sha256(value.encode()).hexdigest()[:60])
            self.assertEqual(len(label), 63)
            self.assertRegex(label, r'^[a-z0-9][a-z0-9-]*[a-z0-9]$')
        self.assertNotEqual(position_label('a' * 64), position_label('a' * 65))

    def test_empty_identity_is_not_silently_mapped(self):
        for value in ('', None, 42):
            with self.assertRaises(ValueError): position_label(value)


class ReconciledPreparationTests(TestCase):
    def setUp(self):
        self.directory = TemporaryDirectory(); self.addCleanup(self.directory.cleanup)
        self.journal = Journal(Path(self.directory.name))
        self.spec = {'id': 'lh-' + 'x' * 65, 'condition': 'goal', 'snapshotId': 'snapshot',
                     'mainCpus': 2, 'mainMemoryMiB': 8192}
        self.spec_sha = hashlib.sha256(json.dumps(self.spec, sort_keys=True).encode()).hexdigest()
        self.journal.write('prepare-intent.json', {'id': self.spec['id'], 'modelRequests': 0,
                                                'specSha256': self.spec_sha})
        self.journal.write('prepare-fault.json', {'stage': 'sandbox-create', 'modelRequests': 0,
                                               'errorType': 'SandboxApiException'})
        self.receipt = {'schemaVersion': 1, 'id': self.spec['id'], 'specSha256': self.spec_sha,
            'intentSha256': file_digest(self.journal.root / 'prepare-intent.json'),
            'faultSha256': file_digest(self.journal.root / 'prepare-fault.json'),
            'errorCode': 'SANDBOX::INVALID_METADATA_LABEL', 'httpStatus': 400,
            'source': 'evaluation-protocol-runner-repair', 'modelRequests': 0,
            'originalAllocationAbsent': True, 'positionLabel': position_label(self.spec['id']),
            'rejectionEvidenceSha256': 'a' * 64}

    def write_receipt(self):
        self.journal.write('preparation-reconciliation.json', self.receipt)

    def test_missing_reconciliation_preserves_the_unknown_allocation_guard(self):
        with self.assertRaisesRegex(RuntimeError, 'uncertain preparation'):
            metadata_recovery_journal(self.spec, self.journal)

    def test_reconciliation_is_bound_to_exact_inputs_and_rejection(self):
        for key, value in [('id', 'other'), ('specSha256', 'b' * 64), ('intentSha256', 'b' * 64),
                           ('faultSha256', 'b' * 64), ('httpStatus', 503), ('errorCode', 'UNKNOWN'),
                           ('modelRequests', 1), ('originalAllocationAbsent', False),
                           ('positionLabel', 'other'), ('rejectionEvidenceSha256', '')]:
            with self.subTest(key=key):
                candidate = {**self.receipt, key: value}
                with patch.object(self.journal, 'read', side_effect=lambda name:
                        candidate if name == 'preparation-reconciliation.json' else
                        json.loads((self.journal.root / name).read_text()) if (self.journal.root / name).exists() else None):
                    with self.assertRaisesRegex(RuntimeError, 'reconciliation identity'):
                        metadata_recovery_journal(self.spec, self.journal)

    def test_any_original_allocation_or_delivery_blocks_repreparation(self):
        self.write_receipt()
        for name in ('sandbox-created.json', 'delivery-intent.json', 'started.json', 'terminal.json', 'result.json'):
            with self.subTest(name=name):
                path = self.journal.root / name; path.write_text('{}')
                with self.assertRaisesRegex(RuntimeError, 'allocation or delivery'):
                    metadata_recovery_journal(self.spec, self.journal)
                path.unlink()

    def test_only_one_reconciled_attempt_can_allocate(self):
        self.write_receipt(); runtime = Mock(spec=OpenSandboxRuntime); runtime.create.side_effect = TimeoutError('response lost')
        before = {name: file_digest(self.journal.root / name) for name in
                  ('prepare-intent.json', 'prepare-fault.json', 'preparation-reconciliation.json')}
        with patch('execution.validate_spec'):
            with self.assertRaises(TimeoutError): prepare(runtime, self.spec, self.journal)
            with self.assertRaisesRegex(RuntimeError, 'uncertain preparation'):
                prepare(runtime, self.spec, self.journal)
        runtime.create.assert_called_once()
        self.assertEqual(runtime.create.call_args.kwargs['metadata']['position'], position_label(self.spec['id']))
        self.assertEqual(before, {name: file_digest(self.journal.root / name) for name in before})

    def test_lost_parent_ack_reconnects_the_prepared_child_without_allocating(self):
        self.write_receipt(); child = metadata_recovery_journal(self.spec, self.journal)
        child.write('prepared.json', {'specSha256': self.spec_sha, 'sandboxId': 'original-child'})
        runtime = Mock(spec=OpenSandboxRuntime)
        with patch('execution.validate_spec'), patch('execution.RuntimeDshRpc'):
            _, _, ready = prepare(runtime, self.spec, self.journal)
        runtime.connect.assert_called_once_with('original-child')
        runtime.assert_no_worker_metadata.assert_not_called(); runtime.create.assert_not_called()
        self.assertEqual(ready['sandboxId'], 'original-child')
        self.assertEqual(self.journal.read('prepared.json'), ready)

    def test_live_original_resource_prevents_a_new_attempt(self):
        self.write_receipt(); runtime = Mock(spec=OpenSandboxRuntime)
        runtime.assert_no_worker_metadata.side_effect = RuntimeError('worker already exists')
        with patch('execution.validate_spec'):
            with self.assertRaisesRegex(RuntimeError, 'already exists'):
                prepare(runtime, self.spec, self.journal)
        runtime.create.assert_not_called()

    def test_supervisor_recovery_requires_exact_native_gateway_cleanup(self):
        self.spec['condition'] = 'supervisor-independent'
        spec_sha = hashlib.sha256(json.dumps(self.spec, sort_keys=True).encode()).hexdigest()
        # A separate original fixture keeps the old immutable intent untouched.
        journal = Journal(self.journal.root / 'supervisor')
        journal.write('prepare-intent.json', {'id': self.spec['id'], 'modelRequests': 0, 'specSha256': spec_sha})
        journal.write('prepare-fault.json', {'stage': 'sandbox-create', 'modelRequests': 0,
                                          'errorType': 'SandboxApiException'})
        journal.write('gateway/gateway-created.json', {'lease': 'owned'})
        journal.write('gateway/gateway-cleanup.json', {'lease': 'owned', 'adminRemoved': True})
        journal.write('gateway/check-quiescence.json', {'lease': 'owned', 'acknowledged': True, 'faults': []})
        receipt = {**self.receipt, 'specSha256': spec_sha,
            'intentSha256': file_digest(journal.root / 'prepare-intent.json'),
            'faultSha256': file_digest(journal.root / 'prepare-fault.json'),
            'gatewayCleanupSha256': file_digest(journal.root / 'gateway/gateway-cleanup.json'),
            'checkQuiescenceSha256': file_digest(journal.root / 'gateway/check-quiescence.json')}
        journal.write('preparation-reconciliation.json', receipt)
        child = metadata_recovery_journal(self.spec, journal)
        self.assertTrue(child.root.is_relative_to(journal.root / 'preparation-recovery'))
        for name in ('gateway/gateway-cleanup.json', 'gateway/check-quiescence.json'):
            path = journal.root / name; original = path.read_bytes(); path.write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'cleanup'):
                metadata_recovery_journal(self.spec, journal)
            path.write_bytes(original)
