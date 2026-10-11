from collections import Counter
import unittest

from freeze import matrix, development_gate, development_amendment_gate, amended_package_gate


class FrozenMatrixTests(unittest.TestCase):
    def test_order_is_deterministic_and_has_complete_paired_denominator(self):
        tasks = ['a', 'b', 'c', 'd']
        first = matrix(tasks)
        self.assertEqual(first, matrix(list(reversed(tasks))))
        rows = first['positions']
        self.assertEqual(len(rows), 24)
        self.assertEqual(len({row['id'] for row in rows}), 24)
        self.assertEqual(set(Counter((row['taskId'], row['condition']) for row in rows).values()), {2})
        self.assertEqual(set(row['repeat'] for row in rows), {1, 2})

    def test_duplicate_tasks_cannot_inflate_the_denominator(self):
        with self.assertRaisesRegex(ValueError, 'distinct'): matrix(['a', 'b', 'c', 'a'])

    def test_exposed_development_runs_supervisor_only_twice_per_task(self):
        value = matrix(['a', 'b', 'c', 'd'], development=True)
        self.assertEqual(value, matrix(['d', 'c', 'b', 'a'], development=True))
        self.assertEqual(len(value['positions']), 8)
        self.assertEqual({row['condition'] for row in value['positions']}, {'supervisor-independent'})
        self.assertEqual(set(Counter(row['taskId'] for row in value['positions']).values()), {2})
        self.assertEqual(value['scope'], 'exposed-supervisor-development')
        self.assertEqual(len(matrix(['a', 'b', 'c', 'd'])['positions']), 24)

    def test_old_or_different_package_and_incomplete_development_cannot_admit(self):
        for value in ({'step': 3, 'status': 'validated'}, {'step': 4, 'status': 'validated', 'candidate7': {'tarballSha256': 'other'}}):
            with self.assertRaises(ValueError): development_gate(value, 'frozen')
        value = {'step': 4, 'status': 'validated', 'candidate7': {'tarballSha256': 'frozen'}, 'cases': []}
        with self.assertRaisesRegex(ValueError, 'cross-product'): development_gate(value, 'frozen')

    def amendment(self):
        return {'schemaVersion': 1, 'kind': 'review-budget-reserve-correction',
            'previousReleaseSha256': 'release', 'previousPluginSourceCommit': 'old-source',
            'previousTarballSha256': 'old-package', 'pluginSourceCommit': 'new-source',
            'tarballSha256': 'new-package', 'changedSources': ['src/review-budget.ts'],
            'priorModelEvidenceReused': True, 'priorModelEvidenceRelabeled': False,
            'checks': {**{key: True for key in ('preFixRegressionFailed', 'lightReserveNativeHostPassed',
                'absoluteTaskCutoffPassed', 'lateDecisionRejected', 'sameJobAndEvidencePreserved',
                'hostClientStrictPassed', 'buildPassed', 'cleanInstallBytesMatched')},
                'kernelExitCode': 0, 'kernelPassed': 505}}

    def validate_amendment(self, value, changed=None):
        development_amendment_gate(value, 'new-package',
            {'pluginSourceCommit': 'old-source', 'tarballSha256': 'old-package'},
            'release', 'new-source', changed or ['src/review-budget.ts'])

    def test_budget_only_amendment_keeps_prior_model_identity(self):
        self.validate_amendment(self.amendment())

    def test_amendment_rejects_identity_changes_and_relabeling(self):
        for key, value in (('previousReleaseSha256', 'other'), ('previousPluginSourceCommit', 'other'),
            ('previousTarballSha256', 'other'), ('pluginSourceCommit', 'other'), ('tarballSha256', 'other'),
            ('priorModelEvidenceRelabeled', True), ('priorModelEvidenceReused', False),
            ('changedSources', ['src/reviewer.ts'])):
            amended = self.amendment(); amended[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.validate_amendment(amended)
        with self.assertRaisesRegex(ValueError, 'source change'):
            self.validate_amendment(self.amendment(), ['src/review-budget.ts', 'src/reviewer.ts'])

    def test_amendment_cannot_skip_native_host_or_clean_package_validation(self):
        for key in self.amendment()['checks']:
            amended = self.amendment(); amended['checks'][key] = False if isinstance(amended['checks'][key], bool) else 1 if key == 'kernelExitCode' else 0
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, 'incomplete'):
                self.validate_amendment(amended)

    def test_amended_route_and_gateway_cannot_reuse_old_package_admission(self):
        amended_package_gate({'tarballSha256': 'current'}, 'current', True)
        amended_package_gate({}, 'current', False)  # Original frozen records retain their reader.
        for value in ({}, {'tarballSha256': 'old'}):
            with self.assertRaisesRegex(ValueError, 'current-package'):
                amended_package_gate(value, 'current', True)
