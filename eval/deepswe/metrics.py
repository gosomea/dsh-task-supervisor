#!/usr/bin/env python3
"""Read settled private Session logs; export only lineage, counters and digests."""
import argparse
from datetime import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import subprocess

FIELDS = ('uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')


def usage_coverage(events):
    starts = {(row['data']['turn'], row['data']['step']) for row in events if row['type'] == 'step/start'}
    settled = set()
    slots, generations = {}, {}
    for row in events:
        if row['type'] not in ('assistant/message', 'assistant/attempt', 'llm/retry-started'):
            continue
        data = row['data']
        step = (data['turn'], data['step'])
        if row['type'] == 'llm/retry-started':
            generations[step] = generations.get(step, 0) + 1
            continue
        settled.add(step)
        usage = data.get('usage')
        chunks = [record['chunk'] for record in data.get('stream', [])
                  if record.get('type') == 'chunk']
        if usage is None:
            usage = next((chunk.get('usage') for chunk in reversed(chunks)
                          if chunk.get('type') == 'usage'), None)
        # DSH synthesizes a zero usage chunk on transport/server failures. The
        # settled log cannot prove the upstream billed nothing, or that partial
        # usage covers the whole failed request. Retain projection totals as a
        # reported lower bound, and keep full cost unknown for these attempts.
        if any(chunk.get('type') == 'finish' and chunk.get('reason', {}).get('kind') == 'error'
               for chunk in chunks):
            usage = None
        slots[(*step, generations.get(step, 0))] = usage
    missing = sum(value is None for value in slots.values()) + len(starts - settled)
    return {'settledAttempts': len(slots), 'unreportedAttempts': missing,
            'unsettledSteps': len(starts - settled)}


def collect(sessions, projections, main_id):
    if main_id not in sessions:
        raise ValueError('Main Session evidence missing')
    linked = {main_id}
    # Durable native headers cover reviews, workers and generic native subagents.
    while True:
        following = {sid for sid, events in sessions.items()
                     if events and events[0].get('parentSession') in linked}
        if following <= linked:
            break
        linked |= following
    jobs = {}
    for event in sessions[main_id]:
        if event.get('type') == 'extension/record' and event['data'].get('namespace') == 'dsh-task-supervisor-review':
            job = event['data']['payload']
            if job.get('mainSessionId') != main_id:
                raise ValueError('Foreign review job in main Session')
            jobs[job['id']] = job
    expected = {job['reviewerSessionId'] for job in jobs.values() if job.get('reviewerSessionId')}
    missing_lineage = sorted(expected - linked)
    token_rows, evidence = [], []
    missing_usage = 0
    for sid in sorted(linked):
        events = sessions[sid]
        coverage = usage_coverage(events)
        missing_usage += coverage['unreportedAttempts']
        state = projections.get(sid, {})
        value = state.get('record', {}).get('rows', {}).get('tokenUsage', {}).get('val')
        totals = value.get('totals', value) if isinstance(value, dict) else None
        if not isinstance(totals, dict) or any(type(totals.get(key)) is not int or totals[key] < 0 for key in FIELDS):
            totals = None
        evidence.append({'sessionId': sid, 'parentSession': events[0].get('parentSession'),
                         'usageCoverage': coverage, 'tokensReported': totals})
        token_rows.append(totals)
    complete = not missing_lineage and not missing_usage and all(row is not None for row in token_rows)
    measured = [row for row in token_rows if row is not None]
    reported = {key: sum(row[key] for row in measured) for key in FIELDS} if measured else None
    checks = {}
    for job in jobs.values():
        for check in (job.get('verification') or {}).get('checks', []):
            checks[check['id']] = check
    wait_ms = sum(max(0, (datetime.fromisoformat(row['finishedAt']) - datetime.fromisoformat(row['startedAt'])).total_seconds() * 1000)
                  for row in checks.values())
    review_calls, repeated_reads, checks_planned, check_results = 0, 0, 0, 0
    phase_rows = []
    for job in jobs.values():
        seen = set()
        for event in sessions.get(job.get('reviewerSessionId'), []):
            if event.get('type') != 'tool/call':
                continue
            review_calls += 1
            data = event['data']
            if data.get('name', '').startswith(('read_', 'inspect_')):
                key = (data['name'], data.get('arguments'))
                repeated_reads += int(key in seen)
                seen.add(key)
        verification = job.get('verification') or {}
        checks_planned += sum(len(row['checks']) for row in verification.get('checkPlan', []))
        check_results += len((job.get('decision') or {}).get('checks', verification.get('checkFindings', [])))
        times = verification.get('phaseTimes') or {}
        def elapsed(start, end):
            if not start or not end:
                return None
            return max(0, (datetime.fromisoformat(end) - datetime.fromisoformat(start)).total_seconds() * 1000)
        phase_rows.append({'jobId': job['id'], 'kind': job.get('kind'), 'mode': job.get('verificationMode'),
                           'planningMs': elapsed(times.get('planning'), times.get('independent')),
                           'independentMs': elapsed(times.get('independent'), times.get('comparison')),
                           'comparisonAndDecisionMs': elapsed(times.get('comparison'), job.get('finishedAt'))})
    return {'allSessionTokens': reported if complete else None, 'tokensReported': reported,
            'tokenCoverageComplete': complete, 'unreportedAttempts': missing_usage,
            'sessions': evidence, 'missingReviewerSessions': missing_lineage,
            'excludedUnrelatedSessions': len(sessions) - len(linked),
            'reviewToolCalls': review_calls, 'repeatedExactReads': repeated_reads,
            'plannedIndependentChecks': checks_planned, 'recordedIndependentCheckResults': check_results,
            'reviewPhaseDurations': phase_rows,
            'checkWaitMs': wait_ms if checks else None, 'checkCount': len(checks),
            'independentReviewJobs': sum('verification' in job for job in jobs.values()),
            'independentComparisonJobs': sum((job.get('verification') or {}).get('phase') == 'comparison' for job in jobs.values()),
            'independentEvidenceCoverage': {
                'applicableCriterionFindings': sum(len((job.get('verification') or {}).get('observations', [])) for job in jobs.values()),
                'readFiles': sum(len((job.get('verification') or {}).get('readFiles', [])) for job in jobs.values())},
            'extraCheckCpuNs': None, 'extraCheckCpuMeasurement': 'not-recorded-by-current-native-check-ledger',
            'falsePauseRate': None, 'correctionBenefit': None}


def read_home(home):
    latest = {}
    for path in (home / 'sessions').glob('**/session.v*.jsonl.zstd'):
        match = re.fullmatch(r'session\.v(\d+)\.jsonl\.zstd', path.name)
        if match and (path.parent not in latest or int(match[1]) > latest[path.parent][0]):
            latest[path.parent] = (int(match[1]), path)
    sessions, projections, hashes = {}, {}, []
    for _, path in latest.values():
        raw = subprocess.check_output(['zstd', '-dc', str(path)], timeout=30)
        events = [json.loads(line) for line in raw.splitlines() if line.strip()]
        if not events or events[0].get('type') != 'session':
            raise ValueError('Missing native Session header')
        sid = events[0]['id']
        if sid in sessions:
            raise ValueError('Duplicate native Session identity')
        sessions[sid] = events
        projection = home / 'storages/session_projcache/sessions' / f'{sid}.json'
        if projection.is_file():
            projections[sid] = json.loads(projection.read_text())
        hashes.append({'relativePath': str(path.relative_to(home)), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return sessions, projections, hashes


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('home', type=Path)
    parser.add_argument('main_session_id')
    parser.add_argument('output', type=Path)
    parser.add_argument('--review-audit', type=Path,
                        default=Path(__file__).parents[1] / 'review-recovery/summary.py',
                        help='Use the frozen reviewAudit input when reading a released run')
    args = parser.parse_args()
    sessions, projections, hashes = read_home(args.home)
    metrics = collect(sessions, projections, args.main_session_id)
    spec = importlib.util.spec_from_file_location('review_recovery_audit', args.review_audit)
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)
    review = audit.summarize(sessions[args.main_session_id])
    metrics.update(reviewWaitMs=review['reviewWaitMs'], repairTurns=review['repairTurns'],
                   internalReviewFaults=review['faultsByCode'], reviewAudit=review,
                   reviewAuditSha256=hashlib.sha256(args.review_audit.read_bytes()).hexdigest(),
                   schemaVersion=1, kind='deepswe-native-metrics', evidence=hashes)
    with args.output.open('x') as output:
        json.dump(metrics, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({'sessions': len(metrics['sessions']), 'tokenCoverageComplete': metrics['tokenCoverageComplete']}))


if __name__ == '__main__':
    main()
