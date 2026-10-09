import hashlib
import json
import io
from pathlib import Path
import tempfile
import tarfile
import unittest
from unittest.mock import patch

from gateway import LABEL, archive_storage, stop_gateway


class GatewayCollectionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.receipt = {'context': 'isolated', 'lease': 'lease', 'adminId': 'admin',
            'volumes': {'client': {'name': 'owned', 'path': '/private/owned'}}}
        (self.root / 'gateway-cleanup.json').write_text(json.dumps({'lease': 'lease', 'adminRemoved': True}))

    def test_sealed_cleanup_does_not_stop_or_recreate_resources(self):
        (self.root / 'check-quiescence.json').write_text(json.dumps({'lease': 'lease', 'acknowledged': True}))
        with patch('gateway.docker', return_value='') as docker:
            stop_gateway(self.receipt, root=self.root)
            docker.assert_called_once_with('isolated', 'ps', '-aq', '--no-trunc', '--filter', 'id=admin')

    def test_prior_cleanup_fault_remains_a_fault_on_replay(self):
        (self.root / 'check-quiescence.json').write_text(json.dumps({'lease': 'lease', 'acknowledged': False}))
        with patch('gateway.docker', return_value=''), self.assertRaisesRegex(RuntimeError, 'retained an infrastructure fault'):
            stop_gateway(self.receipt, root=self.root)

    def test_sealed_native_quiescence_reconciles_original_stopped_administrator(self):
        (self.root / 'check-quiescence.json').write_text(json.dumps({'lease': 'lease', 'acknowledged': True}))
        original = (self.root / 'gateway-cleanup.json').read_bytes()
        def reply(context, *args):
            if args[:2] == ('ps', '-aq'): return 'admin'
            if args[0] == 'inspect':
                return json.dumps([{'Id': 'admin', 'Config': {'Labels': {LABEL: 'lease'}}, 'State': {'Running': False}}])
            return ''
        with patch('gateway.docker', side_effect=reply) as docker:
            stop_gateway(self.receipt, root=self.root)
            self.assertTrue(any(call.args[1:] == ('rm', 'admin') for call in docker.call_args_list))
        self.assertEqual((self.root / 'gateway-cleanup.json').read_bytes(), original)
        self.assertTrue((self.root / 'administrator-removal-reconciled.json').exists())

    def test_sealed_cleanup_never_removes_live_administrator(self):
        (self.root / 'check-quiescence.json').write_text(json.dumps({'lease': 'lease', 'acknowledged': True}))
        def reply(context, *args):
            if args[:2] == ('ps', '-aq'): return 'admin'
            return json.dumps([{'Id': 'admin', 'Config': {'Labels': {LABEL: 'lease'}}, 'State': {'Running': True}}])
        with patch('gateway.docker', side_effect=reply) as docker, self.assertRaisesRegex(RuntimeError, 'live or foreign'):
            stop_gateway(self.receipt, root=self.root)
        self.assertFalse(any(call.args[1] == 'rm' for call in docker.call_args_list))

    def test_removed_last_check_does_not_hide_administrator_removal(self):
        (self.root / 'gateway-cleanup.json').unlink()
        self.receipt.update(adminImage='frozen', checkImage='check')
        self.receipt['volumes']['private'] = {'name': 'owned', 'path': '/private/owned'}
        check = {'snapshotId': 'snapshot', 'id': 'check-id',
            'record': {'image': 'check', 'snapshotId': 'snapshot', 'name': 'dsh-review-check-id'},
            'removed': {'removed': True, 'name': 'dsh-review-check-id'}}
        def reply(context, *args):
            if args[0] == 'ps': return 'admin' if args[-1] == 'id=admin' else ''
            if args[0] == 'inspect':
                return 'false' if '--format' in args else json.dumps([{'Id': 'admin', 'Config': {'Labels': {LABEL: 'lease'}}}])
            if args[:2] == ('volume', 'inspect'):
                return json.dumps([{'Labels': {LABEL: 'lease'}, 'Mountpoint': '/private/owned'}])
            if args[0] == 'run': return json.dumps([check])
            return ''
        with patch('gateway.docker', side_effect=reply) as docker:
            stop_gateway(self.receipt, root=self.root)
        self.assertTrue(any(call.args[1:] == ('rm', 'admin') for call in docker.call_args_list))

    def test_archive_seal_releases_only_owned_volumes_once(self):
        archive = self.root / 'check-storage.tar.gz'; archive.write_bytes(b'verified immutable archive')
        (self.root / 'check-storage.json').write_text(json.dumps({'lease': 'lease',
            'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}))
        def reply(context, *args):
            if args[:2] == ('volume', 'ls'): return 'owned'
            if args[:2] == ('volume', 'inspect'):
                return json.dumps([{'Labels': {LABEL: 'lease'}}])
            return ''
        with patch('gateway.docker', side_effect=reply) as docker:
            archive_storage(self.receipt, root=self.root)
            archive_storage(self.receipt, root=self.root)
            self.assertEqual(sum(call.args[1:3] == ('volume', 'rm') for call in docker.call_args_list), 1)
        self.assertTrue(json.loads((self.root / 'check-storage-released.json').read_text())['archivedBeforeRemoval'])

    def test_changed_archive_never_releases_original_storage(self):
        (self.root / 'check-storage.tar.gz').write_bytes(b'changed')
        (self.root / 'check-storage.json').write_text(json.dumps({'lease': 'lease', 'sha256': 'wrong'}))
        with patch('gateway.docker') as docker, self.assertRaisesRegex(ValueError, 'archive changed'):
            archive_storage(self.receipt, root=self.root)
        docker.assert_not_called()

    def test_unknown_export_reconciles_complete_original_bytes_without_relaunch(self):
        self.receipt['adminImage'] = 'frozen'
        (self.root / 'check-storage-intent.json').write_text(json.dumps({
            'lease': 'lease', 'volumes': self.receipt['volumes'], 'helper': 'dsh-lh-archive-lease'}))
        with tarfile.open(self.root / 'check-storage.part.gz', 'w:gz') as archive:
            for role in ('client', 'private', 'channel'):
                info = tarfile.TarInfo(role + '/evidence'); info.size = 1
                archive.addfile(info, io.BytesIO(b'x'))
        def reply(context, *args):
            if args[:2] == ('volume', 'inspect'):
                return json.dumps([{'Labels': {LABEL: 'lease'}, 'Mountpoint': '/private/owned'}])
            if args[:2] == ('volume', 'ls'): return 'owned'
            return ''
        with patch('gateway.docker', side_effect=reply), patch('gateway.subprocess.run') as run:
            archive_storage(self.receipt, root=self.root)
            run.assert_not_called()
        self.assertTrue((self.root / 'check-storage-released.json').exists())

    def test_unknown_incomplete_export_stays_reserved_without_removal(self):
        self.receipt['adminImage'] = 'frozen'
        (self.root / 'check-storage-intent.json').write_text(json.dumps({
            'lease': 'lease', 'volumes': self.receipt['volumes'], 'helper': 'dsh-lh-archive-lease'}))
        (self.root / 'check-storage.part.gz').write_bytes(b'incomplete')
        def reply(context, *args):
            if args[:2] == ('volume', 'inspect'):
                return json.dumps([{'Labels': {LABEL: 'lease'}, 'Mountpoint': '/private/owned'}])
            return ''
        with patch('gateway.docker', side_effect=reply) as docker, patch('gateway.subprocess.run') as run:
            with self.assertRaises(OSError): archive_storage(self.receipt, root=self.root)
            run.assert_not_called()
            self.assertFalse(any(call.args[1:3] == ('volume', 'rm') for call in docker.call_args_list))
        self.assertFalse((self.root / 'check-storage.json').exists())
