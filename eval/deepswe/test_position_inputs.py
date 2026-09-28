"""Actual position inputs cannot escape frozen grading and native Plan runtimes."""
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from position_inputs import POSITION_ROOTS, assert_position_inputs


class PositionInputTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-position-inputs-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        roots = {}
        for name in POSITION_ROOTS:
            path = self.root / name
            if name in ('hostNode', 'hostDocker', 'chrome', 'reviewAudit'):
                path.write_text(name)
            else:
                path.mkdir()
            roots[name] = str(path)
        chrome = Path(roots['chromeRuntime']) / 'Contents' / 'MacOS'
        chrome.mkdir(parents=True); (chrome / 'Chrome').write_text('chrome launcher')
        roots['chrome'] = str(chrome / 'Chrome')
        playwright = Path(roots['playwrightRuntime']) / 'playwright'; playwright.mkdir()
        roots['playwright'] = str(playwright)
        (playwright.parent / 'playwright-core').mkdir()
        docker = patch('position_inputs.shutil.which', return_value=roots['hostDocker'])
        docker.start(); self.addCleanup(docker.stop)
        runner = Path(roots['runner']); self.executing = runner / 'run_pilot.py'; self.executing.write_text('adapter')
        pier = Path(roots['pierRuntime']) / 'bin'; pier.mkdir(); (pier / 'pier').write_text('grader')
        entry = Path(roots['playwright']) / 'index.mjs'; entry.write_text('playwright')
        self.spec = {'condition': 'plan', 'taskId': 'fixture', 'runner': str(runner),
            'dataset': roots['dataset'], 'pierBin': str(pier / 'pier'), 'hostNode': roots['hostNode'],
            'planClient': {'playwrightEntry': str(entry), 'chromePath': roots['chrome']},
            'release': {'roots': roots}, 'netctlImage': 'sha256:' + 'a' * 64,
            'storageMiB': 20480, 'storageEnforcement': 'official-docker-metadata-only'}
        self.protocol = {'tasks': [{'id': 'fixture', 'storageMiB': 20480}]}

    def test_actual_inputs_and_matching_node_alias_are_admitted(self):
        assert_position_inputs(self.spec, self.protocol, self.executing)
        alias = self.root / 'node-alias'; alias.symlink_to(self.spec['hostNode'])
        self.spec['hostNode'] = str(alias)
        assert_position_inputs(self.spec, self.protocol, self.executing)

    def test_dataset_and_grader_outside_frozen_roots_are_rejected(self):
        foreign = self.root / 'foreign'; foreign.mkdir(); (foreign / 'pier').write_text('different')
        for key, value in (('dataset', str(foreign)), ('pierBin', str(foreign / 'pier'))):
            spec = copy.deepcopy(self.spec); spec[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                assert_position_inputs(spec, self.protocol, self.executing)

    def test_native_plan_cannot_change_binary_or_import_code(self):
        foreign = self.root / 'foreign-binary'; foreign.write_text('other')
        for key in ('hostNode', 'playwrightEntry', 'chromePath'):
            spec = copy.deepcopy(self.spec)
            if key == 'hostNode': spec[key] = str(foreign)
            else: spec['planClient'][key] = str(foreign)
            with self.subTest(key=key), self.assertRaises(ValueError):
                assert_position_inputs(spec, self.protocol, self.executing)

    def test_unfrozen_audit_and_mutable_network_image_are_rejected(self):
        spec = copy.deepcopy(self.spec); spec['release']['roots'].pop('reviewAudit')
        with self.assertRaises(ValueError): assert_position_inputs(spec, self.protocol, self.executing)
        spec = copy.deepcopy(self.spec); spec['netctlImage'] = 'dsh-eval-netctl:1'
        with self.assertRaises(ValueError): assert_position_inputs(spec, self.protocol, self.executing)

    def test_added_storage_quota_or_changed_storage_metadata_is_rejected(self):
        for key, value in (('storageMiB', 4096), ('storageEnforcement', 'hard-limit'),
                           ('storageBoundBytes', 20480 * 1024 * 1024)):
            spec = copy.deepcopy(self.spec); spec[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                assert_position_inputs(spec, self.protocol, self.executing)

    def test_actual_path_docker_cannot_escape_frozen_host_cli(self):
        foreign = self.root / 'other-docker'; foreign.write_text('other docker')
        for value in (str(foreign), None):
            with self.subTest(value=value), patch('position_inputs.shutil.which', return_value=value), self.assertRaises(ValueError):
                assert_position_inputs(self.spec, self.protocol, self.executing)

    def test_application_and_import_dependency_trees_must_be_frozen(self):
        for key in ('chromeRuntime', 'playwrightRuntime'):
            spec = copy.deepcopy(self.spec); spec['release']['roots'][key] = spec['release']['roots'][key.replace('Runtime', '')]
            with self.subTest(key=key), self.assertRaises(ValueError):
                assert_position_inputs(spec, self.protocol, self.executing)
        core = Path(self.spec['release']['roots']['playwright']).parent / 'playwright-core'
        foreign = self.root / 'foreign-core'; foreign.mkdir()
        core.rmdir(); core.symlink_to(foreign)
        with self.assertRaises(ValueError):
            assert_position_inputs(self.spec, self.protocol, self.executing)
