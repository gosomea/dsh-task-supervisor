"""Independent environment telemetry excludes image events and unrelated trials."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

from grade import cleanup_owned_projects, environment_evidence, stop_group


class GradeEnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-grade-observer-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.trial = self.root / 'jobs' / 'official' / 'task__xyz'
        self.trial.mkdir(parents=True)
        (self.trial / 'result.json').write_text(json.dumps({'trial_name': 'task__xyz'}))

    def event(self, kind, project, ident):
        return {'Type': kind, 'Action': 'start', 'Actor': {'ID': ident, 'Attributes': {'com.docker.compose.project': project}}}

    def test_only_owned_container_ids_establish_separate_verifier(self):
        events = [self.event('container', 'task__xyz', 'main'),
                  self.event('image', 'task__xyz__verifier__trial', 'image'),
                  self.event('container', 'task__xyz__verifier__trial', 'verifier'),
                  self.event('container', 'another', 'unrelated')]
        (self.root / 'docker-events.jsonl').write_text('\n'.join(json.dumps(e) for e in events))
        with patch('grade.docker', return_value=b''):
            result = environment_evidence(self.root, 'fixture')
        self.assertTrue(result['separateEnvironmentObserved'])
        self.assertEqual(result['carrierContainerCount'], 1)
        self.assertEqual(result['verifierContainerCount'], 1)

    def test_image_only_verifier_does_not_establish_execution(self):
        events = [self.event('container', 'task__xyz', 'main'),
                  self.event('image', 'task__xyz__verifier__trial', 'image')]
        (self.root / 'docker-events.jsonl').write_text('\n'.join(json.dumps(e) for e in events))
        with patch('grade.docker', return_value=b''):
            result = environment_evidence(self.root, 'fixture')
        self.assertFalse(result['separateEnvironmentObserved'])

    def test_cleanup_refuses_unrelated_task_before_docker_calls(self):
        (self.trial / 'config.json').write_text(json.dumps({'task': {'path': '/unrelated'}, 'trial_name': 'task__xyz'}))
        with patch('grade.docker') as docker:
            with self.assertRaises(ValueError):
                cleanup_owned_projects(self.root, 'fixture')
            docker.assert_not_called()

    def test_group_stop_kills_descendant_that_ignores_sigterm(self):
        marker = self.root / 'late-write'
        ready = self.root / 'child-ready'
        child = "import signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path(%r).write_text('ready'); time.sleep(0.5); Path(%r).write_text('leaked')" % (str(ready), str(marker))
        leader = 'import subprocess,time,sys; subprocess.Popen([sys.executable,"-c",%r]); time.sleep(10)' % child
        process = subprocess.Popen([sys.executable, '-c', leader], start_new_session=True)
        self.addCleanup(lambda: stop_group(process))
        until = time.monotonic() + 5
        while not ready.exists() and time.monotonic() < until:
            time.sleep(0.01)
        self.assertTrue(ready.exists())
        stop_group(process)
        time.sleep(0.6)
        self.assertIsNotNone(process.poll())
        self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
