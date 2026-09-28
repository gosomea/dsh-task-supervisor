"""Frozen bytes, dependency links and private gate evidence cannot silently change."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from freeze_release import GATE_CHECKS, candidate, fingerprint, require_frozen_release, validate_gate, validate_links, verify_candidate
from select_sample import sample_sha256


class FreezeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dsh-freeze-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def test_mutation_and_extra_file_change_fingerprint(self):
        (self.root / 'file').write_text('one')
        first = fingerprint(self.root)
        (self.root / 'file').write_text('two')
        self.assertNotEqual(first['sha256'], fingerprint(self.root)['sha256'])
        second = fingerprint(self.root)
        (self.root / 'extra').write_text('new')
        self.assertNotEqual(second['sha256'], fingerprint(self.root)['sha256'])

    def test_binary_file_itself_is_hashed(self):
        binary = self.root / 'node'; binary.write_bytes(b'\0\x01')
        first = fingerprint(binary)
        self.assertEqual(first['entries'][0]['bytes'], 2)
        binary.write_bytes(b'\0\x02')
        self.assertNotEqual(first['sha256'], fingerprint(binary)['sha256'])

    def test_nonexcluded_credentials_are_rejected(self):
        (self.root / '.credentials.yaml').write_text('secret')
        with self.assertRaises(ValueError):
            fingerprint(self.root)

    def test_guest_dependency_requires_target_in_frozen_runtime(self):
        plugin = self.root / 'plugin'; plugin.mkdir()
        runtime = self.root / 'runtime'; runtime.mkdir()
        (runtime / 'module').write_text('runtime bytes')
        (plugin / 'module').symlink_to('/dsh/module')
        roots = {'plugin': plugin, 'runtime': runtime}
        record = fingerprint(plugin)
        validate_links(plugin, record, roots, {'/dsh': runtime})
        with self.assertRaises(ValueError):
            validate_links(plugin, record, {'plugin': plugin}, {'/dsh': runtime})
        (runtime / 'module').unlink()
        with self.assertRaises(ValueError):
            validate_links(plugin, record, roots, {'/dsh': runtime})

    def test_explicit_credential_exclusion_does_not_publish_secret_digest(self):
        credential = self.root / '.credentials.yaml'; credential.write_text('secret')
        record = fingerprint(self.root, ['.credentials.yaml'])
        self.assertEqual(record['entries'], [])
        self.assertNotIn(hashlib.sha256(b'secret').hexdigest(), json.dumps(record))

    def test_gate_evidence_tampering_is_rejected(self):
        evidence = self.root / 'actual.json'; evidence.write_text('actual')
        gate = {'schemaVersion': 1, 'kind': 'grading-gate', 'passed': True,
                'checks': {k: True for k in ('committedPatchOnly', 'officialMaterialsUnchanged',
                          'separateVerifierObserved', 'dirtyExcluded', 'cleanupConfirmed')},
                'evidence': [{'relativePath': 'actual.json', 'sha256': hashlib.sha256(b'actual').hexdigest()}]}
        path = self.root / 'gate.json'; path.write_text(json.dumps(gate))
        validate_gate(path, self.root)
        evidence.write_text('modified')
        with self.assertRaises(ValueError):
            validate_gate(path, self.root)

    def test_missing_real_gates_leave_candidate_unadmitted(self):
        roots = {}
        for name in ('runner', 'runtime', 'plugin', 'profile', 'node', 'docker', 'pier', 'dataset'):
            path = self.root / name; path.mkdir(); (path / 'input').write_text(name)
            roots[name] = path
        sample = json.loads((Path(__file__).parent / 'sample-20260928.json').read_text())
        record = candidate(sample, roots, self.root, [])
        self.assertFalse(record['modelAdmitted'])
        record['missingGates'] = []
        with self.assertRaises(ValueError):
            verify_candidate(record, roots, self.root)

    def test_final_admission_binds_actual_runtime_and_every_requirement_evidence(self):
        roots = {}
        for name in ('runner', 'runtime', 'plugin', 'profile', 'node', 'docker', 'pier', 'dataset'):
            path = self.root / name; path.mkdir(); (path / 'input').write_text(name)
            roots[name] = str(path)
        source = Path(__file__).parent / 'sample-20260928.json'
        original = json.loads(source.read_text())
        runner = Path(roots['runner'])
        (runner / source.name).write_bytes(source.read_bytes())
        module = runner / 'freeze_release.py'; module.write_text('fixture runner')
        facts = self.root / 'facts.json'; facts.write_text('private evidence bytes')
        row = {'relativePath': facts.name, 'sha256': hashlib.sha256(facts.read_bytes()).hexdigest()}
        gate_paths = []
        for kind, checks in GATE_CHECKS.items():
            path = self.root / (kind + '.json')
            path.write_text(json.dumps({'kind': kind, 'schemaVersion': 1, 'passed': True,
                                       'checks': {k: True for k in checks}, 'evidence': [row]}))
            gate_paths.append(path)
        frozen = candidate(original, roots, self.root, gate_paths)
        frozen_path = self.root / 'candidate.json'; frozen_path.write_text(json.dumps(frozen))
        protocol = json.loads(json.dumps(original))
        protocol['modelAdmitted'] = True
        for task in protocol['tasks']:
            task['imageDigest'] = 'sha256:' + 'a' * 64
        protocol['release'] = {'sampleSha256': sample_sha256(original),
            **{name + 'Sha256': frozen['fingerprints'][name]['sha256'] for name in ('runner', 'runtime', 'plugin', 'profile')},
            'gates': {req: True for req in protocol['admissionRequirements']},
            'admissionEvidence': {req: [row] for req in protocol['admissionRequirements']}}
        protocol_path = self.root / 'admitted.json'; protocol_path.write_text(json.dumps(protocol))
        spec = {'protocol': str(protocol_path), 'candidate': str(frozen_path), 'roots': roots,
                'evidenceRoot': str(self.root), 'expectedSampleSha256': sample_sha256(original)}
        with patch('freeze_release.__file__', str(module)):
            self.assertEqual(require_frozen_release(spec)['plannedAttempts'], 16)
            missing = protocol['admissionRequirements'][0]
            protocol['release']['admissionEvidence'].pop(missing)
            protocol_path.write_text(json.dumps(protocol))
            with self.assertRaises(ValueError):
                require_frozen_release(spec)
            protocol['release']['admissionEvidence'][missing] = [row]
            protocol_path.write_text(json.dumps(protocol))
            (Path(roots['runtime']) / 'input').write_text('changed after freeze')
            with self.assertRaises(ValueError):
                require_frozen_release(spec)


if __name__ == '__main__':
    unittest.main()
