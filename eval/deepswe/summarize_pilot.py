#!/usr/bin/env python3
"""Report every planned pilot position; preserve unknown grades and token coverage."""
import argparse
from collections import Counter
import itertools
import json
from pathlib import Path


def primary(result):
    terminal = result.get('terminal') or {}
    grade = result.get('grade') or {}
    if terminal.get('nativeFinished') is False or terminal.get('finishedBeforeDeadline') is False:
        return False
    if terminal.get('nativeFinished') is not True or terminal.get('finishedBeforeDeadline') is not True:
        return None
    if terminal.get('cleanupAcknowledged') is not True or grade.get('fault') is not None:
        return None
    reward = grade.get('reward')
    return reward == 1 if type(reward) in (int, float) and reward in (0, 1) else None


def summarize(root, protocol):
    expected = {row['id']: row for row in protocol['order']}
    if len(expected) != protocol['plannedAttempts']:
        raise ValueError('Duplicate or incomplete planned denominator')
    results = {}
    started = set()
    for directory in sorted((root / 'attempts').glob('*')):
        if not directory.is_dir():
            continue
        if directory.name not in expected:
            raise ValueError('Unplanned attempt directory')
        if (directory / 'started.json').is_file():
            started.add(directory.name)
        path = directory / 'result.json'
        if not path.is_file():
            continue
        row = json.loads(path.read_text())
        if any(row.get(key) != expected[directory.name][key] for key in ('id', 'taskId', 'repeat', 'condition')):
            raise ValueError('Result identity differs from immutable order')
        results[directory.name] = row
    conditions = {}
    for condition in protocol['conditions']:
        slots = [row for row in protocol['order'] if row['condition'] == condition]
        rows = [results[row['id']] for row in slots if row['id'] in results]
        values = [primary(row) for row in rows]
        successes = sum(value is True for value in values)
        failures = sum(value is False for value in values)
        # Missing results and unscoreable completions remain in the same denominator.
        unknown = len(slots) - successes - failures
        usage = [row.get('metrics', {}).get('allSessionTokens') for row in rows]
        measured = [row for row in usage if isinstance(row, dict)]
        fields = ('uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')
        if any(any(type(row.get(key)) is not int or row[key] < 0 for key in fields) for row in measured):
            raise ValueError('Invalid measured token buckets')
        totals = {key: sum(row[key] for row in measured) for key in fields} if measured else None
        terminal_counts = Counter((row.get('terminal') or {}).get('status', 'unknown') for row in rows)
        conditions[condition] = {
            'planned': len(slots), 'started': sum(row['id'] in started for row in slots),
            'sealed': len(rows), 'primarySuccesses': successes, 'knownFailures': failures,
            'unknownPrimary': unknown,
            'successRate': successes / len(slots) if unknown == 0 else None,
            'successRateBounds': [successes / len(slots), (successes + unknown) / len(slots)],
            'terminalCounts': dict(terminal_counts),
            'officialRewards': dict(Counter(str((row.get('grade') or {}).get('reward')) for row in rows)),
            'gradingFaults': sum((row.get('grade') or {}).get('fault') is not None for row in rows),
            'internalReviewFaultPositions': sum(bool((row.get('terminal') or {}).get('reviewFault')) for row in rows),
            'falseCompletions': sum((row.get('terminal') or {}).get('nativeFinished') is True
                                    and (row.get('grade') or {}).get('reward') == 0
                                    and (row.get('grade') or {}).get('fault') is None for row in rows),
            'allSessionTokenSumMeasured': totals, 'tokenMeasuredPositions': len(measured),
            'tokenUnknownPositions': len(slots) - len(measured),
            'falsePauseRate': None, 'correctionBenefit': None,
        }
    paired = []
    for left, right in itertools.combinations(protocol['conditions'], 2):
        counts = Counter()
        for task in protocol['tasks']:
            for repeat in range(1, protocol['repeats'] + 1):
                a = results.get(f"{task['id']}-r{repeat}-{left}")
                b = results.get(f"{task['id']}-r{repeat}-{right}")
                av, bv = primary(a) if a else None, primary(b) if b else None
                if av is None or bv is None:
                    counts['unknown'] += 1
                else:
                    counts['leftWin' if av and not bv else 'rightWin' if bv and not av else 'tie'] += 1
        paired.append({'left': left, 'right': right, **dict(counts)})
    return {'schemaVersion': 1, 'kind': 'deepswe-pilot-summary', 'planned': len(expected),
            'started': len(started), 'sealed': len(results), 'conditions': conditions, 'paired': paired,
            'limitations': ['Two tasks and two repeats are correlated engineering checks, not superiority evidence.',
                            'No blind labels: false-pause and correction-benefit metrics remain null.',
                            'Incomplete token coverage must not be described as complete model cost.']}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('protocol', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    result = summarize(args.root, json.loads(args.protocol.read_text()))
    with args.output.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({key: result[key] for key in ('planned', 'started', 'sealed')}))


if __name__ == '__main__':
    main()
