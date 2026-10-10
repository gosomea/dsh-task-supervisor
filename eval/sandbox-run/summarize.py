"""Full planned denominator; repeated runs are paired within four tasks."""
from collections import Counter
import itertools
import json
from pathlib import Path
import statistics

from records import exclusive_json

CONDITIONS = ('goal', 'plan', 'supervisor-independent')


def measured_sum(results, key):
    values = [result['metrics'].get(key) for result in results]
    return sum(values) if values and all(value is not None for value in values) else None


def summarize(order, root):
    positions = order['positions']
    identities = [row['id'] for row in positions]
    if len(identities) != len(set(identities)): raise ValueError('duplicate planned position')
    rows = []
    for position in positions:
        directory = Path(root) / position['id']
        path = directory / 'result.json'
        result = json.loads(path.read_text()) if path.exists() else None
        if result and (result['id'] != position['id'] or result['condition'] != position['condition']
                       or result['taskId'] != position['taskId'] or result['repeat'] != position['repeat']):
            raise ValueError('result does not belong to planned position')
        state = 'sealed' if result else 'started' if (directory / 'started.json').exists() else 'not-delivered'
        failure = directory / 'admission-fault.json'
        rows.append({**position, 'state': state, 'result': result,
            'notDeliveredReason': json.loads(failure.read_text()).get('reason') if failure.exists() else None})
    conditions = {}
    for condition in CONDITIONS:
        subset = [row for row in rows if row['condition'] == condition]
        done = [row['result'] for row in subset if row['result']]
        strict = sum(result['strictSuccess'] for result in done)
        complete_tokens = all(result['metrics'].get('allSessionTokens') is not None for result in done)
        token_fields = ('uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')
        reported = {key: sum((result['metrics'].get('tokensReported') or {}).get(key, 0) for result in done) for key in token_fields}
        conditions[condition] = {'planned': len(subset), 'sealed': len(done),
            'notDelivered': sum(row['state'] == 'not-delivered' for row in subset),
            'startedNotSealed': sum(row['state'] == 'started' for row in subset),
            'strictSuccesses': strict, 'strictSuccessRateFullDenominator': strict / len(subset) if subset else None,
            'rewardOne': sum(result['reward'] == 1 for result in done),
            'rewardZero': sum(result['reward'] == 0 for result in done),
            'rewardUnknown': sum(result['reward'] is None for result in done),
            'firstStopReasons': dict(Counter(result['terminal']['firstStopReason'] for result in done)),
            'infrastructureFaults': sum(bool(result['terminal']['infrastructureFault']
                or result.get('collectionInfrastructureFault')) for result in done),
            'executionInfrastructureFaults': sum(result['terminal']['infrastructureFault'] for result in done),
            'collectionInfrastructureFaults': sum(result.get('collectionInfrastructureFault') is True for result in done),
            'gradingFaults': sum(bool(result['gradingFault']) for result in done),
            'announcedCompleteOfficialFailed': sum(result['announcedCompleteOfficialFailed'] for result in done),
            'allSessionTokens': reported if done and complete_tokens else None,
            'tokensReportedLowerBound': reported if done else None,
            'metrics': {key: measured_sum(done, key) for key in (
                'requestCount', 'reviewToolCalls', 'repeatedExactReads', 'reviewReadFailures',
                'recordedIndependentCheckResults', 'taskFaultRetryReservations', 'taskTruncationReservations',
                'reviewProtocolSubmissions', 'checkWaitMs', 'wholeElapsedSec', 'protocolUserActions',
                'toolCallsAllSessions', 'contextCompactions', 'contextCompactionAttempts')},
            'falseAcceptanceRate': None, 'falsePauseRate': None, 'correctionBenefit': None}
    paired = []
    task_ids = sorted({row['taskId'] for row in rows})
    for task_id in task_ids:
        values = {}
        for condition in CONDITIONS:
            subset = [row for row in rows if row['taskId'] == task_id and row['condition'] == condition]
            values[condition] = {'positions': [row['id'] for row in subset],
                'strictSuccessRate': statistics.mean(row['result']['strictSuccess'] for row in subset)
                    if subset and all(row['result'] for row in subset) else None,
                'rewards': [row['result']['reward'] if row['result'] else None for row in subset]}
        paired.append({'taskId': task_id, 'conditions': values})
    comparisons = {}
    for baseline in ('goal', 'plan'):
        differences = [row['conditions']['supervisor-independent']['strictSuccessRate'] - row['conditions'][baseline]['strictSuccessRate']
            for row in paired if row['conditions']['supervisor-independent']['strictSuccessRate'] is not None
            and row['conditions'][baseline]['strictSuccessRate'] is not None]
        interval = None
        if len(differences) == len(task_ids) and differences:
            # Exact bootstrap over task clusters; repetitions are not extra tasks.
            distribution = sorted(statistics.mean(sample) for sample in itertools.product(differences, repeat=len(differences)))
            interval = [distribution[int(.025 * (len(distribution) - 1))], distribution[int(.975 * (len(distribution) - 1))]]
        comparisons[baseline] = {'pairedTaskCount': len(differences), 'taskDifferences': differences,
            'meanStrictSuccessDifference': statistics.mean(differences) if differences else None,
            'taskClusterBootstrap95Percent': interval,
            'interpretation': 'exploratory small sample; four tasks, repetitions are paired, no general long-horizon claim'}
    return {'schemaVersion': 1, 'kind': 'dsh-long-horizon-public-comparison', 'seed': order['seed'],
        'planned': len(rows), 'sealed': sum(row['state'] == 'sealed' for row in rows),
        'complete': all(row['state'] == 'sealed' for row in rows), 'conditions': conditions,
        'pairedTasks': paired, 'comparisons': comparisons, 'positions': rows,
        'falseAcceptanceRate': None, 'falsePauseRate': None, 'correctionBenefit': None}


def report(summary):
    lines = ['# 长程公开题对照结果', '',
        f"已封口 **{summary['sealed']}/{summary['planned']}** 个计划位置。基础设施和评分异常保留在分母中，未知奖励记为 null。", '',
        '| 条件 | 封口/计划 | reward=1 | reward=0 | 未知 | 严格成功 |',
        '|---|---:|---:|---:|---:|---:|']
    for key, row in summary['conditions'].items():
        lines.append(f"| {key} | {row['sealed']}/{row['planned']} | {row['rewardOne']} | {row['rewardZero']} | {row['rewardUnknown']} | {row['strictSuccesses']} |")
    lines += ['', '严格成功要求截止前控制器完成、官方 reward=1 且无基础设施或评分异常。',
        '已恢复的收集异常单列计数，保留实际官方评分和执行侧首次停止原因，不计为严格成功。', '',
        '## 逐题配对', '', '| 题目 | Goal | Plan | Supervisor |', '|---|---:|---:|---:|']
    for task in summary['pairedTasks']:
        values = [task['conditions'][key]['strictSuccessRate'] for key in CONDITIONS]
        lines.append('| ' + task['taskId'] + ' | ' + ' | '.join('未封口' if value is None else f'{value:.0%}' for value in values) + ' |')
    lines += ['', '## 解读范围', '',
        '仅四道软件任务，两次重复用于同题配对。区间按题目聚类；这批结果不能证明一般长程优势。',
        '无人工或盲审标注的误验收、误暂停和纠偏收益保持 null。宣布完成但官方失败另行机械统计。',
        '完整机器结果包含每个计划位置、首次停止原因、奖励、评分证据、token 完整性及恢复成本。']
    return '\n'.join(lines) + '\n'


def write_summary(order_path, root, out):
    value = summarize(json.loads(Path(order_path).read_text()), root)
    out = Path(out)
    exclusive_json(out, value)
    with out.with_suffix('.zh.md').open('x') as stream: stream.write(report(value))
    return value
