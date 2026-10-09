import hashlib
import unittest

from instruction_identity import expected_task_objective_sha256, task_instruction_identity


class InstructionIdentityTests(unittest.TestCase):
    def test_raw_instruction_and_native_objective_have_separate_identities(self):
        raw = '\ufeff\u00a0  要求\n\n保留  两个空格\n\t'
        value = task_instruction_identity(raw)
        self.assertEqual(value['instructionSha256'], hashlib.sha256(raw.encode()).hexdigest())
        self.assertEqual(value['taskObjectiveSha256'], hashlib.sha256('要求\n\n保留  两个空格'.encode()).hexdigest())
        self.assertEqual(expected_task_objective_sha256(value), value['taskObjectiveSha256'])

    def test_preserves_characters_outside_ecmascript_trim_set(self):
        for character in ('\u0085', '\u001c', '\u180e', '\u200b'):
            raw = character + 'objective' + character
            self.assertEqual(task_instruction_identity(raw)['taskObjectiveSha256'],
                             hashlib.sha256(raw.encode()).hexdigest())

    def test_legacy_identity_is_not_normalized_retroactively(self):
        original = hashlib.sha256(b'objective\n').hexdigest()
        self.assertEqual(expected_task_objective_sha256({'instructionSha256': original}), original)
        with self.assertRaisesRegex(ValueError, 'empty'):
            task_instruction_identity(' \n\t\ufeff')

    def test_partial_or_unknown_identity_is_rejected(self):
        for value in ({'taskObjectiveSha256': 'a' * 64},
                      {'taskObjectiveNormalization': 'collapse-all-whitespace', 'taskObjectiveSha256': 'a' * 64},
                      {'taskObjectiveNormalization': 'dsh-task-command-trim-v1', 'taskObjectiveSha256': 'bad'}):
            with self.assertRaisesRegex(ValueError, 'invalid'):
                expected_task_objective_sha256(value)


if __name__ == '__main__':
    unittest.main()
