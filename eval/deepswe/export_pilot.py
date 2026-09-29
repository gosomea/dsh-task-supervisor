#!/usr/bin/env python3
"""Export sealed evidence and a Chinese report without changing a running experiment."""
import argparse
from collections import Counter
import hashlib
import importlib.util
import json
import math
from pathlib import Path
import re

TOKEN_FIELDS = ('uncachedInputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens')
COUNTERS = ('reviewWaitMs', 'checkWaitMs', 'repairTurns', 'humanInterventions', 'extraCheckCpuNs',
            'checkCount', 'independentReviewJobs', 'independentComparisonJobs', 'unreportedAttempts')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def token_buckets(value):
    if isinstance(value, dict) and all(type(value.get(k)) is int and value[k] >= 0 for k in TOKEN_FIELDS):
        return {k: value[k] for k in TOKEN_FIELDS}
    return None


def number(value):
    return value if type(value) in (int, float) and value >= 0 and math.isfinite(value) else None


def label(value):
    """Export structured identifiers, never free-form failure messages."""
    return value if isinstance(value, str) and re.fullmatch(r'[a-zA-Z0-9_.:-]{1,100}', value) else None


def fault_codes(fault):
    if not isinstance(fault, dict):
        return {'present': fault is not None, 'code': None, 'errorType': None}
    return {'present': True, 'code': label(fault.get('code')), 'errorType': label(fault.get('errorType'))}


def normalized_tokens(directory, result):
    """Apply only a hash-bound, explicitly evidenced zero-request supplement."""
    value = token_buckets(result.get('metrics', {}).get('allSessionTokens'))
    if value is not None and result.get('metrics', {}).get('tokenCoverageComplete') is True:
        return value, None
    path = directory / 'metric-shape-supplement.json'
    if not path.exists():
        return None, None
    supplement = json.loads(path.read_text())
    basis = supplement.get('basis', {})
    valid = (supplement.get('kind') == 'pre-delivery-zero-model-token-supplement'
             and supplement.get('originalResultSha256') == digest(directory / 'result.json')
             and supplement.get('originalResultUnchanged') is True
             and supplement.get('tokenCoverageComplete') is True
             and result.get('started') is False and result.get('delivered') is False
             and result.get('route', {}).get('actualHttpRequests') == 0
             and basis.get('auditBytes') == 0 and basis.get('mainSessionCreated') is False
             and basis.get('startedFileAbsent') is True and basis.get('deliveryIntentAbsent') is True)
    buckets = token_buckets(supplement.get('allSessionTokens'))
    if not valid or buckets is None or any(buckets.values()):
        raise ValueError('Invalid zero-request token supplement')
    return buckets, digest(path)


def details(root, protocol, summary):
    rows = []
    for position in summary['positions']:
        directory = root / 'attempts' / position['id']
        path = directory / 'result.json'
        row = {**position, 'terminalStatus': label(position.get('terminalStatus')),
               'executionVersions': None, 'controlProtocolDeviation': None, 'nativeStop': None,
               'resultSha256': None, 'delivered': None, 'graderStarted': None,
               'tokens': None, 'tokensReported': None, 'tokenSupplementSha256': None,
               'sessionCount': None, 'gradingFault': None, 'reviewFault': None,
               'internalReviewFaults': None, 'independentEvidenceCoverage': None,
               **{key: None for key in COUNTERS}}
        if position['sealed']:
            if not path.is_file():
                raise ValueError('Result sealed in the summary snapshot is missing')
            result = json.loads(path.read_text())
            if any(result.get(k) != position[k] for k in ('id', 'taskId', 'condition', 'repeat')):
                raise ValueError('Sealed result identity differs from the fixed matrix')
            terminal, metrics = result.get('terminal') or {}, result.get('metrics') or {}
            tokens, supplement_sha = normalized_tokens(directory, result)
            findings = metrics.get('independentEvidenceCoverage') or {}
            faults = metrics.get('internalReviewFaults')
            versions = result.get('executionVersions') or {}
            stop = terminal.get('nativeStop') or {}
            safe_stop = {key: label(stop.get(key)) for key in ('kind', 'reason', 'activationObservation')}
            safe_stop.update({key: number(stop.get(key)) for key in ('turn', 'seq', 'nativeStoppedAtUnix', 'planModeSeq', 'taskRevision', 'taskStateSeq')})
            if isinstance(stop.get('taskId'), str):
                safe_stop['taskId'] = stop['taskId']
            safe_stop['planModeActive'] = stop.get('planModeActive') if type(stop.get('planModeActive')) is bool else None
            driver = stop.get('driverSourceSha256')
            safe_stop['driverSourceSha256'] = driver if isinstance(driver, str) and re.fullmatch('[a-f0-9]{64}', driver) else None
            row.update(executionVersions={key: value for key, value in versions.items()
                       if key in ('launchReleaseSha256', 'observerReleaseSha256', 'terminationPolicySha256')
                       and isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value)},
                       controlProtocolDeviation=result.get('controlProtocolDeviation')
                       if type(result.get('controlProtocolDeviation')) is bool else None,
                       nativeStop=safe_stop if stop else None,
                       resultSha256=digest(path), delivered=result.get('delivered'),
                       graderStarted=(directory / 'grade/started.json').is_file(),
                       tokens=tokens, tokensReported=token_buckets(metrics.get('tokensReported'))
                       or token_buckets(metrics.get('allSessionTokens')) or tokens,
                       tokenSupplementSha256=supplement_sha,
                       sessionCount=len(metrics['sessions']) if isinstance(metrics.get('sessions'), list) else None,
                       gradingFault=fault_codes((result.get('grade') or {}).get('fault')),
                       reviewFault=fault_codes(terminal.get('reviewFault')),
                       internalReviewFaults={label(k): v for k, v in faults.items()
                                            if label(k) is not None and type(v) is int and v >= 0}
                       if isinstance(faults, dict) else None,
                       independentEvidenceCoverage={k: number(findings.get(k)) for k in
                                                    ('applicableCriterionFindings', 'readFiles')},
                       **{key: number(metrics.get(key)) for key in COUNTERS})
        rows.append(row)
    full = [row['tokens'] for row in rows if row['tokens'] is not None]
    reported = [row['tokensReported'] for row in rows if row['tokensReported'] is not None]
    totals = lambda values: {key: sum(row[key] for row in values) for key in TOKEN_FIELDS} if values else None
    groups = []
    for task in protocol['tasks']:
        for repeat in range(1, protocol['repeats'] + 1):
            groups.append({'taskId': task['id'], 'repeat': repeat, 'conditions': {
                row['condition']: {'id': row['id'], 'primarySuccess': row['primarySuccess'],
                                   'officialReward': row['officialReward'], 'sealed': row['sealed']}
                for row in rows if row['taskId'] == task['id'] and row['repeat'] == repeat}})
    return {'schemaVersion': 1, 'kind': 'deepswe-posthoc-evidence-details',
            'planned': len(rows), 'sealed': sum(row['sealed'] for row in rows),
            'deliveredInSealedResults': sum(row['delivered'] is True for row in rows),
            'terminalCounts': dict(Counter(row['terminalStatus'] for row in rows if row['sealed'])),
            'gradingStartedPositions': sum(row['graderStarted'] is True for row in rows),
            'gradingFaultPositions': sum(row['gradingFault']['present'] for row in rows
                                         if row['graderStarted'] is True),
            'unstartedGradeFaultPositions': sum(row['gradingFault']['present'] for row in rows
                                               if row['sealed'] and row['graderStarted'] is False),
            'allSessionTokens': totals(full) if len(full) == len(rows) else None,
            'tokensReportedLowerBound': totals(reported), 'tokenUnknownPositions': len(rows) - len(full),
            'counters': {key: {'measuredSum': sum(row[key] for row in rows if row[key] is not None)
                              if any(row[key] is not None for row in rows) else None,
                              'unknownPositions': sum(row[key] is None for row in rows)} for key in COUNTERS},
            'pairedTaskRepeats': groups, 'positions': rows,
            'falsePauseRate': None, 'correctionBenefit': None,
            'limitations': ['The frozen primary definition is unchanged; unverified route positions remain unknown.',
                            'Two tasks and two repeats do not establish superiority or statistical independence.',
                            'Finding/file counts measure recorded coverage, not evidence correctness.',
                            'Raw result files remain unchanged; an applied token supplement has its own hash.']}


def chinese_report(summary, evidence, partial):
    lines = ['# DeepSWE 正式公开题对照评测', '',
             '本报告为部分结果预览。' if partial else '全部计划位置已封口；无法评分项仍保留在完整分母中。', '',
             f"计划 {summary['planned']} 项，封口 {summary['sealed']} 项，其中模型投递 {evidence['deliveredInSealedResults']} 项。", '',
             '## 条件与完整分母', '',
             '| 条件 | 计划 | 封口 | 有效主成功 | 已知失败 | 未知 | 成功率上下界 |',
             '| --- | ---: | ---: | ---: | ---: | ---: | --- |']
    for condition, value in summary['conditions'].items():
        bounds = value['successRateBounds']
        lines.append(f"| {condition} | {value['planned']} | {value['sealed']} | {value['primarySuccesses']} | "
                     f"{value['knownFailures']} | {value['unknownPrimary']} | {bounds[0]:.1%}–{bounds[1]:.1%} |")
    lines += ['', '上下界仅反映未知结果，不是统计置信区间。沿用冻结汇总程序的主成功定义；缺少有效路由证据的基础设施位置保持未知，故障数量另列。', '',
              '## 故障、用量与审查', '',
              f"终止状态计数：{json.dumps(evidence['terminalCounts'], ensure_ascii=False)}。", '',
              f"已启动官方评分流程 {evidence['gradingStartedPositions']} 项，其中评分故障 {evidence['gradingFaultPositions']} 项；"
              f"评分未启动而存在故障记录 {evidence['unstartedGradeFaultPositions']} 项。", '',
              f"完整全部 Session Token：{json.dumps(evidence['allSessionTokens'])}；"
              f"缺少完整用量的位置 {evidence['tokenUnknownPositions']} 项。", '',
              f"已回报 Token 下界：{json.dumps(evidence['tokensReportedLowerBound'])}。", '',
              'JSON 明细按位置保留 Session 数量、审查等待、补交、内部审查故障、检查次数、文件读取与观察记录数量。观察数量不代表证据正确。', '',
              '额外检查 CPU 时间缺失时保留 null；未盲审标注的误暂停率、纠偏收益均为 null。初始授权计入原始人工介入指标，追加救场须另外核对。', '',
              '## 逐题、逐次重复配对', '',
              '| 题目 / 重复 | ' + ' | '.join(summary['conditions']) + ' |',
              '| --- | ' + ' | '.join('---' for _ in summary['conditions']) + ' |']
    for group in evidence['pairedTaskRepeats']:
        cells = []
        for condition in summary['conditions']:
            row = group['conditions'][condition]
            status = '成功' if row['primarySuccess'] is True else '失败' if row['primarySuccess'] is False else '未知'
            reward = row['officialReward'] if row['officialReward'] is not None else '未评分'
            cells.append(f'{status} / reward {reward}')
        lines.append(f"| {group['taskId']} / r{group['repeat']} | " + ' | '.join(cells) + ' |')
    lines += ['', '## 解释范围', '',
              '两道题、两次重复属于工程接入小样本，不能据此声称 Supervisor 优于 Goal、Plan 或 Team。', '',
              '首两个位置的投递前基础设施失败与后续冻结版本偏差须结合正式启动记录解释；它们不能作为 Goal 或 Plan 模型能力的证据。', '',
              '机器明细保留各封口结果哈希、报告导出程序哈希和冻结汇总程序哈希。报告不包含凭据、认证 URL、私有绝对路径或原始模型输出。', '']
    return '\n'.join(lines)


def export(root, protocol, destination, summary_reader, *, partial=False):
    loader = importlib.util.spec_from_file_location('frozen_pilot_summary', summary_reader)
    module = importlib.util.module_from_spec(loader)
    loader.loader.exec_module(module)
    summary = module.summarize(root, protocol)
    for row in summary['positions']:
        reward = row['officialReward']
        if reward is not None and (type(reward) not in (int, float) or reward not in (0, 1)):
            raise ValueError('Invalid official reward in sealed evidence')
        row['terminalStatus'] = label(row['terminalStatus'])
    for condition in summary['conditions'].values():
        cleaned = Counter()
        for key, count in condition['terminalCounts'].items():
            cleaned[label(key) or 'unstructured-redacted'] += count
        condition['terminalCounts'] = dict(cleaned)
    if not partial and summary['sealed'] != summary['planned']:
        raise ValueError('Final export requires every planned position to be sealed')
    evidence = details(root, protocol, summary)
    evidence.update(summaryReaderSha256=digest(summary_reader), exporterSha256=digest(Path(__file__)),
                    sampleSha256=protocol['release']['sampleSha256'], partial=partial)
    destination.mkdir(parents=True, exist_ok=False)
    for name, value in [('summary.json', summary), ('evidence-details.json', evidence)]:
        with (destination / name).open('x') as out:
            json.dump(value, out, ensure_ascii=False, indent=2)
            out.write('\n')
    with (destination / 'report.zh.md').open('x') as out:
        out.write(chinese_report(summary, evidence, partial))
    return {'planned': summary['planned'], 'sealed': summary['sealed'], 'partial': partial}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path)
    parser.add_argument('protocol', type=Path)
    parser.add_argument('destination', type=Path)
    parser.add_argument('--summary-reader', type=Path, required=True, help='The actual frozen summarize_pilot.py')
    parser.add_argument('--partial', action='store_true', help='Explicit incomplete preview, never a final report')
    args = parser.parse_args()
    print(json.dumps(export(args.root, json.loads(args.protocol.read_text()), args.destination,
                            args.summary_reader, partial=args.partial)))


if __name__ == '__main__':
    main()
