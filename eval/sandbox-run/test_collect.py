from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from opensandbox.exceptions import SandboxApiException
from collect import destroy_original
from monitor import Journal


class CollectionRecoveryTests(unittest.TestCase):
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
