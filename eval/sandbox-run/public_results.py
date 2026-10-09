"""Export immutable safe result snapshots without model text or private paths.

This is report-only postprocessing. It does not alter frozen execution inputs,
grant permission, send a model request or overwrite an existing snapshot.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path

from records import exclusive_json
from summarize import report, summarize

NUMERIC_METRICS = (
    'unreportedAttempts', 'excludedUnrelatedSessions', 'reviewToolCalls',
    'repeatedExactReads', 'plannedIndependentChecks', 'recordedIndependentCheckResults',
    'checkWaitMs', 'checkCount', 'independentReviewJobs', 'independentComparisonJobs',
    'extraCheckCpuNs', 'requestCount', 'toolCallsAllSessions', 'contextCompactions',
    'contextCompactionAttempts', 'reviewReads', 'reviewReadFailures',
    'reviewProtocolSubmissions', 'reviewFaultHistoryCount', 'taskFaultRetryReservations',
    'taskTruncationReservations', 'wholeElapsedSec', 'protocolUserActions',
    'protocolControlReceipts', 'protocolInstructionSubmissions', 'humanRescueActions',
)
TOKENS = ('uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')


def number(value):
    return value if type(value) in (int, float) and value >= 0 else None


def code(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value) else None


def tokens(value):
    return {key: number(value.get(key)) for key in TOKENS} if isinstance(value, dict) else None


def hashes(value):
    return {key: val for key, val in (value or {}).items()
            if code(key) and isinstance(val, str) and re.fullmatch('[a-f0-9]{64}', val)}


def counters(value, keys):
    return {key: number(value.get(key)) for key in keys} if isinstance(value, dict) else None


def metrics(value):
    out = {key: number(value.get(key)) for key in NUMERIC_METRICS}
    out.update(allSessionTokens=tokens(value.get('allSessionTokens')),
               tokensReported=tokens(value.get('tokensReported')),
               tokenCoverageComplete=value.get('tokenCoverageComplete') is True,
               independentEvidenceCoverage=counters(value.get('independentEvidenceCoverage'),
                   ('applicableCriterionFindings', 'readFiles')))
    out['sessions'] = [{
        'sessionId': code(row.get('sessionId')), 'parentSession': code(row.get('parentSession')),
        'tokensReported': tokens(row.get('tokensReported')),
        'usageCoverage': counters(row.get('usageCoverage'),
            ('settledAttempts', 'unreportedAttempts', 'unsettledSteps')),
    } for row in value.get('sessions', [])]
    out['reviewPhaseDurations'] = [{
        'jobId': code(row.get('jobId')), 'kind': code(row.get('kind')), 'mode': code(row.get('mode')),
        **{key: number(row.get(key)) for key in ('planningMs', 'independentMs', 'comparisonAndDecisionMs')},
    } for row in value.get('reviewPhaseDurations', [])]
    return out


def result(value):
    terminal, official = value['terminal'], value['officialGrade']
    grade = {key: official.get(key) is True for key in
             ('scored', 'cleanupConfirmed', 'separateEnvironmentObserved')}
    grade.update(reward=number(official.get('reward')), fault=code(official.get('fault')),
                 tests=counters(official.get('tests'), ('tests', 'passed', 'failed', 'skipped', 'pending', 'other')),
                 execution=counters(official.get('execution'),
                     ('reportedPositions', 'missingResultPositions', 'positionsWithResult')),
                 evidenceSha256=hashes(official.get('evidenceSha256')),
                 officialFilesSha256=hashes(official.get('officialFilesSha256')),
                 imageDigest=code(official.get('imageDigest')),
                 architecture=code(official.get('architecture')))
    for bucket in ('F2P', 'P2P'):
        row = official.get(bucket)
        grade[bucket] = counters(row, ('total', 'passed', 'failed', 'rate'))
    return {
        'schemaVersion': 1, **{key: code(value[key]) for key in ('id', 'condition', 'taskId')},
        'repeat': number(value['repeat']), 'formal': value.get('formal') is True,
        'reward': number(value.get('reward')), 'strictSuccess': value.get('strictSuccess') is True,
        'gradingFault': code(value.get('gradingFault')),
        'terminal': {
            'sessionId': code(terminal.get('sessionId')),
            'firstStopReason': code(terminal.get('firstStopReason')),
            **{key: number(terminal.get(key)) for key in ('atUnix', 'deadlineAtUnix', 'rescueCount')},
            **{key: terminal.get(key) is True for key in
               ('controllerComplete', 'finishedBeforeDeadline', 'infrastructureFault')},
        },
        'officialGrade': grade, 'metrics': metrics(value['metrics']),
        'artifactHashes': hashes(value.get('artifactHashes')),
        'announcedCompleteOfficialFailed': value.get('announcedCompleteOfficialFailed') is True,
        'falseAcceptanceRate': None, 'falsePauseRate': None, 'correctionBenefit': None,
    }


def snapshot(order_path, runs, out):
    order_path, runs, out = map(Path, (order_path, runs, out))
    order = json.loads(order_path.read_text())
    value = summarize(order, runs)
    for condition in value['conditions'].values():
        condition['firstStopReasons'] = {
            code(key) or 'unclassified-private-detail': count
            for key, count in condition['firstStopReasons'].items()
        }
    for row in value['positions']:
        directory = runs / row['id']
        row['notDeliveredReason'] = code(row['notDeliveredReason'])
        if row['state'] == 'not-delivered' and row['notDeliveredReason'] is None:
            row['notDeliveredReason'] = 'awaiting-serial-position'
        if row['result']:
            row['privateResultSha256'] = hashlib.sha256((directory / 'result.json').read_bytes()).hexdigest()
            row['result'] = result(row['result'])
        elif (directory / 'started.json').exists():
            started = json.loads((directory / 'started.json').read_text())
            row['execution'] = {key: number(started.get(key)) for key in ('startedAtUnix', 'deadlineAtUnix')}
            row['execution']['sessionId'] = code(started.get('sessionId'))
    value.update(exportedAt=datetime.now(timezone.utc).isoformat(), reportOnly=True,
                 orderSha256=hashlib.sha256(order_path.read_bytes()).hexdigest())
    out.mkdir(parents=True, exist_ok=False)
    exclusive_json(out / 'summary.json', value)
    (out / 'report.zh.md').write_text(report(value) + detail_report(value))
    return value


def detail_report(value):
    lines = ['', '## 逐位置结果', '',
             '| 位置 | 状态 | 首次停止 | 官方 reward | F2P | P2P | 请求 | 全部 token | 用户动作 |',
             '|---|---|---|---:|---|---|---:|---|---:|']
    for row in value['positions']:
        outcome = row['result']
        if not outcome:
            lines.append(f"| {row['id']} | {row['state']} | — | — | — | — | — | — | — |")
            continue
        cost = outcome['metrics']
        total = cost['allSessionTokens']
        token_text = 'null（见已报告下界）' if total is None else str(sum(total.values()))
        def bucket(key):
            data = outcome['officialGrade'][key]
            return 'null' if data is None else f"{data['passed']}/{data['total']}"
        lines.append(f"| {row['id']} | sealed | {outcome['terminal']['firstStopReason']} | "
                     f"{outcome['reward']} | {bucket('F2P')} | {bucket('P2P')} | "
                     f"{cost['requestCount']} | {token_text} | {cost['protocolUserActions']} |")
    lines += ['', '快照仅导出计数、身份与摘要，不包含模型正文、工具参数、私有路径或凭据。',
              '未封口位置不代表失败；当前成功数与完整分母同时保留，最终比较等待全部位置封口。',
              'Token 总和包含独立列出的 uncached/cache-read/cache-write/output；缺失用量不补为零。',
              '各 Session 用量、审查阶段耗时、读取失败、独立检查与资源限制见机器记录及冻结 release。']
    return '\n'.join(lines) + '\n'


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('order', type=Path)
    parser.add_argument('runs', type=Path)
    parser.add_argument('out', type=Path)
    args = parser.parse_args()
    value = snapshot(args.order, args.runs, args.out)
    print(json.dumps({'planned': value['planned'], 'sealed': value['sealed'], 'complete': value['complete']}))
