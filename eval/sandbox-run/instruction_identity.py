"""Bind raw instructions and the objective produced by native /task trim()."""
import hashlib
import re


TASK_OBJECTIVE_NORMALIZATION = 'dsh-task-command-trim-v1'
# ECMAScript WhiteSpace + LineTerminator, as used by String.prototype.trim.
# Python str.strip also removes characters which the DSH command preserves.
JS_TRIM = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680' + ''.join(
    chr(value) for value in range(0x2000, 0x200b)) + '\u2028\u2029\u202f\u205f\u3000\ufeff'


def task_instruction_identity(instruction):
    objective = instruction.strip(JS_TRIM)
    if not objective:
        raise ValueError('empty native Task objective')
    return {
        'instructionSha256': hashlib.sha256(instruction.encode()).hexdigest(),
        'taskObjectiveSha256': hashlib.sha256(objective.encode()).hexdigest(),
        'taskObjectiveNormalization': TASK_OBJECTIVE_NORMALIZATION,
    }


def expected_task_objective_sha256(started):
    normalization = started.get('taskObjectiveNormalization')
    digest = started.get('taskObjectiveSha256')
    if normalization is None and digest is None:
        # Legacy records keep their original exact-byte protocol.
        return started.get('instructionSha256')
    if (normalization != TASK_OBJECTIVE_NORMALIZATION or not isinstance(digest, str)
            or re.fullmatch('[a-f0-9]{64}', digest) is None):
        raise ValueError('invalid native Task instruction identity')
    return digest
