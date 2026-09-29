import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from export_pilot import details, export
from summarize_pilot import summarize

HERE = Path(__file__).parent
BUCKETS = {'uncachedInputTokens': 10, 'outputTokens': 2, 'cacheReadTokens': 20, 'cacheWriteTokens': 0}


class EvidenceExportTests(unittest.TestCase):
    def setUp(self):
        self.work = tempfile.TemporaryDirectory()
        self.addCleanup(self.work.cleanup)
        self.root = Path(self.work.name) / 'batch'
        self.protocol = json.loads((HERE / 'sample-20260928.json').read_text())
        self.protocol['release'] = {'sampleSha256': 'a' * 64}
        self.reader = HERE / 'summarize_pilot.py'

    def seal(self, index, *, overrides=None):
        row = self.protocol['order'][index]
        folder = self.root / 'attempts' / row['id']
        folder.mkdir(parents=True)
        value = {**row, 'started': True, 'delivered': True,
                 'terminal': {'status': 'native-complete', 'nativeFinished': True,
                              'finishedBeforeDeadline': True, 'cleanupAcknowledged': True},
                 'route': {'routesMatched': True, 'protocolDeviation': False},
                 'grade': {'reward': 1, 'fault': None},
                 'metrics': {'allSessionTokens': dict(BUCKETS), 'tokensReported': dict(BUCKETS),
                             'tokenCoverageComplete': True, 'sessions': [{}, {}],
                             'checkCount': 2, 'internalReviewFaults': {}, 'humanInterventions': 1}}
        value.update(overrides or {})
        (folder / 'result.json').write_text(json.dumps(value))
        return folder

    def test_plan_stop_export_retains_mode_and_source_without_private_paths(self):
        self.seal(0, overrides={'terminal': {'status': 'native-stopped', 'nativeFinished': False,
            'nativeStop': {'kind': 'plan-mode-no-continuation', 'reason': 'max-tokens', 'turn': 1,
                'seq': 137, 'planModeSeq': 3, 'planModeActive': True, 'driverSourceSha256': 'b' * 64,
                'privatePath': '/private/not-exported', 'nativeStoppedAtUnix': 20}}})
        snapshot = summarize(self.root, self.protocol)
        evidence = details(self.root, self.protocol, snapshot)
        stop = evidence['positions'][0]['nativeStop']
        self.assertTrue(stop['planModeActive'])
        self.assertEqual(stop['planModeSeq'], 3)
        self.assertEqual(stop['driverSourceSha256'], 'b' * 64)
        self.assertNotIn('privatePath', stop)

    def test_partial_matrix_cannot_be_mislabelled_final_or_overwrite_evidence(self):
        folder = self.seal(0)
        original = (folder / 'result.json').read_bytes()
        destination = Path(self.work.name) / 'export'
        with self.assertRaises(ValueError):
            export(self.root, self.protocol, destination, self.reader)
        self.assertFalse(destination.exists())
        result = export(self.root, self.protocol, destination, self.reader, partial=True)
        self.assertEqual(result, {'planned': 16, 'sealed': 1, 'partial': True})
        detail = json.loads((destination / 'evidence-details.json').read_text())
        self.assertEqual(len(detail['positions']), 16)
        self.assertEqual(len(detail['pairedTaskRepeats']), 4)
        self.assertIsNone(detail['allSessionTokens'])
        self.assertEqual(detail['tokenUnknownPositions'], 15)
        self.assertEqual(detail['tokensReportedLowerBound'], BUCKETS)
        self.assertEqual((folder / 'result.json').read_bytes(), original)
        with self.assertRaises(FileExistsError):
            export(self.root, self.protocol, destination, self.reader, partial=True)

    def test_full_export_preserves_pairing_and_distinguishes_unstarted_grader(self):
        for index in range(16):
            folder = self.seal(index)
            if index > 0:
                (folder / 'grade').mkdir()
                (folder / 'grade/started.json').write_text('{}')
        first = self.root / 'attempts' / self.protocol['order'][0]['id'] / 'result.json'
        value = json.loads(first.read_text())
        value.update(started=False, delivered=False,
                     terminal={'status': 'infrastructure-fault', 'nativeFinished': False},
                     grade={'reward': None, 'fault': {'code': 'pre-delivery-infrastructure-failure',
                                                     'message': 'Bearer PRIVATE_VALUE https://host/?token=secret'}})
        first.write_text(json.dumps(value))
        destination = Path(self.work.name) / 'export'
        export(self.root, self.protocol, destination, self.reader)
        detail = json.loads((destination / 'evidence-details.json').read_text())
        self.assertEqual((detail['sealed'], detail['deliveredInSealedResults'], detail['gradingStartedPositions']), (16, 15, 15))
        self.assertEqual(detail['gradingFaultPositions'], 0)
        self.assertEqual(detail['unstartedGradeFaultPositions'], 1)
        self.assertEqual(detail['allSessionTokens'], {key: 16 * val for key, val in BUCKETS.items()})
        self.assertNotIn('PRIVATE_VALUE', (destination / 'evidence-details.json').read_text())
        self.assertNotIn('token=secret', (destination / 'report.zh.md').read_text())

    def test_incomplete_coverage_keeps_reported_usage_as_lower_bound(self):
        self.seal(0, overrides={'metrics': {'allSessionTokens': BUCKETS, 'tokensReported': BUCKETS,
                                           'tokenCoverageComplete': False}})
        destination = Path(self.work.name) / 'export'
        export(self.root, self.protocol, destination, self.reader, partial=True)
        detail = json.loads((destination / 'evidence-details.json').read_text())
        self.assertIsNone(detail['positions'][0]['tokens'])
        self.assertEqual(detail['tokensReportedLowerBound'], BUCKETS)
        self.assertEqual(detail['tokenUnknownPositions'], 16)

    def test_newly_sealed_result_does_not_mix_into_earlier_snapshot(self):
        snapshot = summarize(self.root, self.protocol)
        self.seal(0)
        evidence = details(self.root, self.protocol, snapshot)
        self.assertEqual(evidence['sealed'], 0)
        self.assertEqual(evidence['deliveredInSealedResults'], 0)
        self.assertEqual(evidence['tokenUnknownPositions'], 16)
        self.assertIsNone(evidence['positions'][0]['resultSha256'])
        self.assertIsNone(evidence['positions'][0]['tokens'])
        self.assertIsNone(evidence['positions'][0]['primarySuccess'])

    def test_missing_sealed_result_rejects_export(self):
        folder = self.seal(0)
        snapshot = summarize(self.root, self.protocol)
        (folder / 'result.json').unlink()
        with self.assertRaisesRegex(ValueError, 'snapshot is missing'):
            details(self.root, self.protocol, snapshot)

    def test_zero_usage_supplement_must_bind_unchanged_result_and_real_basis(self):
        folder = self.seal(0, overrides={'started': False, 'delivered': False,
                                       'route': {'actualHttpRequests': 0},
                                       'metrics': {'allSessionTokens': 0, 'tokenCoverageComplete': True}})
        supplement = {'kind': 'pre-delivery-zero-model-token-supplement',
                      'originalResultSha256': hashlib.sha256((folder / 'result.json').read_bytes()).hexdigest(),
                      'originalResultUnchanged': True, 'tokenCoverageComplete': True,
                      'allSessionTokens': {key: 0 for key in BUCKETS},
                      'basis': {'auditBytes': 0, 'mainSessionCreated': False, 'startedFileAbsent': True,
                                'deliveryIntentAbsent': True}}
        path = folder / 'metric-shape-supplement.json'
        path.write_text(json.dumps(supplement))
        destination = Path(self.work.name) / 'export'
        export(self.root, self.protocol, destination, self.reader, partial=True)
        detail = json.loads((destination / 'evidence-details.json').read_text())
        self.assertEqual(detail['tokenUnknownPositions'], 15)
        self.assertEqual(detail['positions'][0]['tokens']['outputTokens'], 0)
        supplement['basis']['auditBytes'] = 1
        path.write_text(json.dumps(supplement))
        with self.assertRaises(ValueError):
            export(self.root, self.protocol, Path(self.work.name) / 'invalid', self.reader, partial=True)


if __name__ == '__main__':
    unittest.main()
