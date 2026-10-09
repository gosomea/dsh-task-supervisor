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


if __name__ == '__main__': unittest.main()
