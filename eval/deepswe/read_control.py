#!/usr/bin/env python3
"""Read official Harbor control evidence without treating an unrun verifier as reward zero."""
import argparse
import hashlib
import json
from pathlib import Path


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_control(job):
    result = {'jobName': job.name, 'reward': None, 'rawReward': None,
              'scored': False, 'fault': None, 'tests': None, 'evidenceSha256': {}}
    trials = list(job.glob('*/result.json'))
    if len(trials) != 1:
        result['fault'] = 'missing-or-ambiguous-trial'
        return result
    path = trials[0]
    result['evidenceSha256']['trialResult'] = sha(path)
    trial = json.loads(path.read_text())
    if trial.get('exception_info'):
        # Exception messages can contain signed download URLs; export only the type.
        result['fault'] = 'harbor-exception'
        result['exceptionType'] = trial['exception_info'].get('exception_type')
        return result
    rewards = (trial.get('verifier_result') or {}).get('rewards') or {}
    reward = rewards.get('reward')
    result['rawReward'] = reward
    report = path.parent / 'verifier/ctrf.json'
    if not report.is_file():
        result['fault'] = 'verifier-test-report-missing'
        return result
    result['evidenceSha256']['testReport'] = sha(report)
    report_results = json.loads(report.read_text()).get('results', {})
    summary = report_results.get('summary', {})
    keys = ('tests', 'passed', 'failed', 'skipped', 'pending', 'other')
    if any(type(summary.get(key)) is not int or summary[key] < 0 for key in keys):
        result['fault'] = 'invalid-test-summary'
        return result
    result['tests'] = {key: summary[key] for key in keys}
    if summary['tests'] < 1 or summary['tests'] != summary['passed'] + summary['failed'] \
            or any(summary[key] for key in ('skipped', 'pending', 'other')):
        result['fault'] = 'verifier-tests-incomplete'
        return result
    rows = report_results.get('tests')
    if not isinstance(rows, list) or len(rows) != summary['tests'] or any(
            not isinstance(row, dict) or not isinstance(row.get('name'), str) or not row['name']
            or row.get('status') not in ('passed', 'failed') for row in rows):
        result['fault'] = 'invalid-test-details'
        return result
    if any(sum(row['status'] == key for row in rows) != summary[key] for key in ('passed', 'failed')):
        result['fault'] = 'test-details-summary-mismatch'
        return result
    # Official merged CTRF can fill missing tests with failed entries. Preserve that
    # score, but do not count a synthetic entry as an actually executed test.
    missing = sum('missing from report (test did not run or produced no result' in
                  str(row.get('message', '')) for row in rows)
    result['execution'] = {'reportedPositions': len(rows), 'missingResultPositions': missing,
                           'positionsWithResult': len(rows) - missing,
                           'allPositionsHaveResult': missing == 0}
    expected = 1 if summary['failed'] == 0 else 0
    if type(reward) not in (int, float) or reward != expected:
        result['fault'] = 'reward-test-summary-mismatch'
        return result
    result.update(reward=reward, scored=True)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('job', type=Path)
    args = parser.parse_args()
    print(json.dumps(read_control(args.job), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
