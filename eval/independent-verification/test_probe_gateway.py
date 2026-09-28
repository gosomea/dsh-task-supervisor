"""Bounded management waits cannot strand the topology controller."""
import os
import subprocess
import sys
import unittest
import tempfile
import json
from pathlib import Path
from unittest.mock import patch

from probe_gateway import bounded_run, cleanup_container


class BoundedCommandTests(unittest.TestCase):
    def test_timeout_reaps_owned_process(self):
        launched = []
        original = subprocess.Popen

        def launch(*args, **kwargs):
            process = original(*args, **kwargs)
            launched.append(process)
            return process

        with patch('probe_gateway.subprocess.Popen', side_effect=launch):
            with self.assertRaises(subprocess.TimeoutExpired):
                bounded_run([sys.executable, '-c', 'import time; time.sleep(60)'], timeout=.05,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertIsNotNone(launched[0].returncode)
        with self.assertRaises(ProcessLookupError):
            os.kill(launched[0].pid, 0)

    def test_log_timeout_cannot_skip_owned_container_cleanup(self):
        actions = []

        def run(command, **kwargs):
            action = command[1]
            actions.append(action)
            if action == 'inspect':
                return subprocess.CompletedProcess(command, 0, json.dumps({'dsh.supervisor.topology': 'lease'}))
            if action == 'logs':
                raise subprocess.TimeoutExpired(command, 30)
            return subprocess.CompletedProcess(command, 0)

        with tempfile.TemporaryDirectory() as root, patch('probe_gateway.bounded_run', side_effect=run):
            result = cleanup_container(['docker'], 'owned', 'lease', Path(root) / 'log')
        self.assertEqual(actions, ['inspect', 'logs', 'stop', 'rm'])
        self.assertTrue(result['confirmed'])
        self.assertEqual(result['logFaultType'], 'TimeoutExpired')

    def test_unconfirmed_identity_blocks_mutation(self):
        with tempfile.TemporaryDirectory() as root, patch('probe_gateway.bounded_run', return_value=
            subprocess.CompletedProcess([], 0, json.dumps({'dsh.supervisor.topology': 'other'}))) as run:
            result = cleanup_container(['docker'], 'foreign', 'lease', Path(root) / 'log')
        self.assertFalse(result['confirmed'])
        self.assertEqual(run.call_count, 1)

    def test_nonzero_requires_explicit_check(self):
        command = [sys.executable, '-c', 'raise SystemExit(3)']
        self.assertEqual(bounded_run(command).returncode, 3)
        with self.assertRaises(subprocess.CalledProcessError):
            bounded_run(command, check=True)


if __name__ == '__main__':
    unittest.main()
