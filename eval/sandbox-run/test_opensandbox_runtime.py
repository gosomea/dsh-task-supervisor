"""Lifecycle ownership and the frozen SDK's native-isolation arguments."""
from datetime import datetime, timedelta, timezone
from unittest import TestCase, skipUnless
from unittest.mock import Mock, patch
import importlib.util

from opensandbox_runtime import OpenSandboxRuntime
from runtime import SandboxRef


@skipUnless(importlib.util.find_spec("opensandbox"), "requires the frozen OpenSandbox SDK")
class RuntimeTests(TestCase):
    def setUp(self):
        self.runtime = OpenSandboxRuntime.__new__(OpenSandboxRuntime)
        self.runtime._config = Mock()
        self.runtime._manager = Mock()
        self.runtime._boxes = {}
        self.runtime._owned = set()
        self.box = Mock(id="one")

    def test_creation_keeps_dsh_permission_and_enables_namespace_bootstrap(self):
        with patch("opensandbox.sync.sandbox.SandboxSync.create", return_value=self.box) as create:
            self.runtime.create(image="image@sha256:digest", snapshot_id=None, metadata={"lease": "test"},
                                cpu="2", memory="8Gi", platform="linux/amd64",
                                volumes=[{"name": "artifacts", "pvc": {"claim_name": "owned-volume"},
                                          "mount_path": "/artifacts", "read_only": False}])
        args = create.call_args.kwargs
        self.assertEqual(args["extensions"], {"bootstrap.execd.isolation": "enable"})
        self.assertEqual(args["resource"], {"cpu": "2", "memory": "8Gi"})
        self.assertEqual(args["network_policy"].default_action, "deny")
        self.assertEqual(args['platform'].os, 'linux')
        self.assertEqual(args['platform'].arch, 'amd64')
        self.assertEqual(args["volumes"][0].pvc.claim_name, "owned-volume")
        self.assertIn("one", self.runtime._owned)

    def test_reconnect_and_close_never_destroy_the_original_worker(self):
        with patch("opensandbox.sync.sandbox.SandboxSync.connect", return_value=self.box) as connect:
            self.runtime.connect("one")
            self.runtime.connect("one")
        connect.assert_called_once()
        self.runtime.close()
        self.box.close.assert_called_once()
        self.box.destroy.assert_not_called()

    def test_owned_worker_cleanup_and_detach(self):
        self.runtime._boxes["one"] = self.box
        self.runtime._owned.add("one")
        self.runtime.close()
        self.box.destroy.assert_called_once()
        self.box.close.assert_called_once()
        self.assertEqual(self.runtime._boxes, {})

    def test_failed_destroy_keeps_identity_for_reconciliation(self):
        self.runtime._boxes["one"] = self.box
        self.runtime._owned.add("one")
        self.box.destroy.side_effect = RuntimeError("lost response")
        with self.assertRaises(RuntimeError):
            self.runtime.destroy(SandboxRef("one"))
        self.assertIs(self.runtime._boxes["one"], self.box)
        self.assertIn("one", self.runtime._owned)

    def test_renewal_does_not_accept_past_cutoff(self):
        self.runtime._boxes["one"] = self.box
        with self.assertRaises(ValueError):
            self.runtime.renew_until(SandboxRef("one"), datetime.now(timezone.utc) - timedelta(seconds=1))
        self.box.renew.assert_not_called()

    def test_preparation_reconciliation_reads_every_page_and_never_creates(self):
        first = Mock(sandbox_infos=[Mock(metadata={'position': 'unrelated'})],
                     pagination=Mock(has_next_page=True))
        second = Mock(sandbox_infos=[], pagination=Mock(has_next_page=False))
        self.runtime._manager.list_sandbox_infos.side_effect = [first, second]
        self.runtime.assert_no_worker_metadata(('original', 'mapped'))
        filters = [call.args[0] for call in self.runtime._manager.list_sandbox_infos.call_args_list]
        self.assertEqual([f.page for f in filters], [1, 2])
        self.assertEqual(filters[0].metadata, {'role': 'long-horizon-worker'})
        self.assertFalse(self.runtime._owned)

    def test_preparation_reconciliation_rejects_original_or_mapped_resources(self):
        for position in ('original', 'mapped'):
            with self.subTest(position=position):
                self.runtime._manager.list_sandbox_infos.return_value = Mock(
                    sandbox_infos=[Mock(metadata={'position': position})], pagination=Mock(has_next_page=False))
                with self.assertRaisesRegex(RuntimeError, 'already exists'):
                    self.runtime.assert_no_worker_metadata(('original', 'mapped'))
