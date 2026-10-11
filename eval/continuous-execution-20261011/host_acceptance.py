#!/usr/bin/env python3
"""Real-provider development fixtures via public DSH APIs; private logs stay outside Git."""
import argparse, collections, datetime, hashlib, http.cookiejar, json, pathlib, re, subprocess, tempfile, time, urllib.request, uuid


class Host:
    def __init__(self, log):
        url = re.search(r'dsh web: (http://\S+)', pathlib.Path(log).read_text()).group(1)
        self.base = url.split('/?')[0]
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.op.open(url, timeout=30).read()

    def rpc(self, method, args):
        body = {'type': 'client-request', 'rpcId': str(uuid.uuid4()), 'method': method, 'payload': {'args': args}}
        request = urllib.request.Request(self.base + '/api/' + method, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'Origin': self.base})
        response = json.load(self.op.open(request, timeout=45))['result']
        if not response['ok']:
            raise RuntimeError(str(response))
        return response['value']

    def status(self, sid):
        return json.load(self.op.open(self.base + '/api/task-supervisor?sessionId=' + sid, timeout=30))

    def item(self, sid):
        return next(item for item in self.rpc('session/list', {'_request': {}})['items'] if item['sessionId'] == sid)

    def events(self, sid, parent=None):
        through = self.item(sid)['projections']['asOfSeq']
        records, before = [], None
        while True:
            address = {'kind': 'subagent', 'parentSessionId': parent, 'childSessionId': sid, 'mode': 'unknown'} if parent else {'kind': 'session', 'sessionId': sid}
            request = {'address': address, 'throughSeq': through, 'maxMessages': 1000}
            if before is not None:
                request['beforeSeq'] = before
            page = self.rpc('session/page', {'request': request})
            records.extend(record['event'] for record in page['records'] if record['type'] == 'event')
            if not page['hasMore']:
                return sorted({event['seq']: event for event in records}.values(), key=lambda event: event['seq'])
            before = min(record['event']['seq'] for record in page['records'] if record['type'] == 'event')


def exclusive(path, value):
    with path.open('x') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)


def collect_capability_rejection(args):
    """Collect the original admission refusal, without replaying an Agent or approval."""
    out = pathlib.Path(args.output).resolve()
    freeze = json.loads((out / 'started.json').read_text())
    receipt = json.loads((out / 'capability-approval.json').read_text())
    assert receipt['result']['kind'] == 'error' and 'CAPABILITY_UNAVAILABLE' in receipt['result']['text']
    host = Host(args.log)
    sid = freeze['sessionId']
    state = host.status(sid)
    task = state['task']
    assert task['phase'] == 'awaiting-approval' and not state['reviewing'] and not host.item(sid)['running']
    jobs = [job for job in state['reviewJobs'] if job['taskId'] == task['id']]
    assert jobs and all(job['status'] == 'applied' and job['kind'] == 'plan' for job in jobs)
    assert any('visual' in (job.get('decision') or {}).get('requiredCapabilities', []) for job in jobs)
    manifest = json.loads((out / 'capability-inputs.json').read_text())
    workspace = pathlib.Path(freeze['workspace'])
    unchanged = sorted(path.name for path in workspace.iterdir()) == manifest['paths'] and all(
        hashlib.sha256((workspace / name).read_bytes()).hexdigest() == value for name, value in manifest['sha256'].items())
    assert unchanged
    root = host.events(sid)
    exclusive(out / 'capability-root.private.json', root)
    exclusive(out / 'capability-final-state.private.json', state)
    tokens = {sid: host.item(sid)['projections']['values'].get('tokenUsage')}
    details = []
    for job in jobs:
        assert not host.item(job['reviewerSessionId'])['running']
        events = host.events(job['reviewerSessionId'], sid)
        exclusive(out / (job['id'] + '.private.json'), events)
        tokens[job['reviewerSessionId']] = host.item(job['reviewerSessionId'])['projections']['values'].get('tokenUsage')
        details.append({key: job.get(key) for key in ('id', 'kind', 'status', 'attempt', 'budget', 'startedAt', 'finishedAt', 'cleanupHistory', 'confirmation')})
        details[-1].update(verdict=job['decision']['verdict'], requiredCapabilities=job['decision']['requiredCapabilities'], toolCalls=sum(event['type'] == 'tool/call' for event in events))
    exclusive(out / 'capability-result.json', {
        'case': 'capability', **freeze, 'taskId': task['id'], 'terminal': 'capability-unavailable',
        'controllerPhase': task['phase'], 'reward': 1, 'artifactOracle': unchanged,
        'initialApprovals': 0, 'approvalAttempts': 1, 'jobs': details, 'tokens': tokens,
        'oracle': 'Required visual capability explicitly rejected before implementation; no log fallback or Task completion.',
        'collectorCorrection': 'The original driver assumed approval success and stopped after persisting the refusal. This read-only collector seals that original Session as a permitted preparation fault. No redelivery or second approval.',
        'tokenScope': 'Cumulative per unique Session.', 'grading': 'Development capability admission, not public reward',
        'falseAcceptance': None, 'falsePause': None})
    print(json.dumps({'event': 'sealed', 'case': 'capability', 'terminal': 'capability-unavailable', 'reward': 1}))


def run(args):
    out = pathlib.Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    host = Host(args.log)
    if (out / 'started.json').exists():
        raise RuntimeError('This case already started. Observe/collect the original Session; never redeliver.')
    workspace = pathlib.Path(tempfile.mkdtemp(prefix='dsh-continuous-host-')).resolve()
    (workspace / 'input.json').write_text(json.dumps({'items': [{'qty': 3, 'price': 4}, {'qty': 2, 'price': 5}]}))
    (workspace / 'memo.md').write_text('# 决议\n\n日期：2026-10-11\n参与者：甲、乙\n下周三提交初稿。\n')
    (workspace / 'calc.mjs').write_text('export const clamp = (n) => n < 0 ? 0 : n > 10 ? 9 : n;\n')
    (workspace / 'calc.test.mjs').write_text("import {strict as assert} from 'node:assert'; import {clamp} from './calc.mjs'; assert.equal(clamp(5),5); assert.equal(clamp(-1),0);\n")
    (workspace / 'report.md').write_text('作者声称 clamp 在全部边界均正确，已有测试全绿。此声明未经独立验证。\n')
    registered = host.rpc('workspace/create', {'request': {'path': str(workspace)}})['workspace']
    sid = host.rpc('session/create', {'request': {'workspaceId': registered['workspaceId'], 'agentPreset': 'standard'}})['sessionId']
    assert host.item(sid)['cwd'] == str(workspace)
    subprocess.run(['python3', '/Users/yuqixian/forever-skills/skills/dsh-plugin-isolated-test/scripts/environments.py', 'bind', args.environment, '--case', out.name, '--workspace', str(workspace), '--session', sid, '--purpose', 'Real-model multi-node artifact delivery and same-Session negative behavior check'], check=True, capture_output=True)
    freeze = {'sessionId': sid, 'workspace': str(workspace), 'deadlineSeconds': args.deadline, 'tarballSha256': hashlib.sha256(pathlib.Path(args.tarball).read_bytes()).hexdigest(), 'approval': 'once-per-task', 'rescue': False}
    exclusive(out / 'started.json', freeze)
    print(json.dumps({'event': 'bound', 'sessionId': sid, 'workspace': str(workspace)}), flush=True)
    prompts = [
        ('delivery', '交付两个文件，规划为两个串行节点：第一节点读取 memo.md，生成 summary.md，必须准确保留日期、参与者与决议；第二节点读取 input.json，计算 items 每项 qty×price 的总和，生成 result.json，sum 必须等于合计。只允许写 summary.md 和 result.json，不修改输入或其他文件。两项交付都是必需的，整体关系也要验收。先提交 DAG，等一次初始批准后执行；每个节点与整体验收均走督导。'),
        ('negative', '新建一个独立只读验收 Task：验收现有交付物 calc.mjs 的 clamp(n)。本 Task 的通过与完成条件是被测产物满足全部原始规格：输入小于 0 返回 0，0–10 保持输入，大于 10 返回 10。完成检查或出具不合格报告本身不能把本 Task 判为通过或完成。calc.test.mjs 和 report.md 的声明可能覆盖不足，不应作为正确性的充分证明。检查实际行为，禁止改动任何文件。若不符合要求，明确说明真实结果和缺口，等待用户决定；不能宣布通过。用一个节点先规划。'),
        ('capability', '建立一个只读验收任务，先规划一个节点：必须由独立审查者实际打开交付网页并点击按钮，观察交互后页面变化。静态文件、主 Agent 截图或主 Agent 汇报都不能替代独立浏览器交互。当前产物是 memo.md 所述决议；禁止修改任何文件。必要独立能力不可用时明确说明未验证并等待用户，不得降级成日志审查或宣布通过。'),
    ]
    prompts = [item for item in prompts if item[0] in ('delivery', 'negative')] if args.case == 'all' else [item for item in prompts if item[0] == args.case]
    for name, prompt in prompts:
        case_hashes = {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in workspace.iterdir() if path.is_file()}
        case_paths = sorted(path.name for path in workspace.iterdir())
        exclusive(out / (name + '-inputs.json'), {'sha256': case_hashes, 'paths': case_paths})
        start = time.time()
        response = host.rpc('commands/execute', {'agentId': sid, 'line': '/task ' + prompt, 'submittedAttachments': []})
        assert response['result']['kind'] == 'success', response
        approved, terminal, jobs, previous = False, None, [], None
        while time.time() - start < args.deadline:
            state = host.status(sid)
            (out / 'state.private.json').write_text(json.dumps(state, ensure_ascii=False))
            task = state.get('task') or {}
            jobs = [job for job in state.get('reviewJobs', []) if job['taskId'] == task.get('id')]
            if task.get('phase') == 'awaiting-approval' and not approved and not host.item(sid)['running']:
                receipt = host.rpc('commands/execute', {'agentId': sid, 'line': '/task approve', 'submittedAttachments': []})
                exclusive(out / (name + '-approval.json'), receipt)
                assert receipt['result']['kind'] == 'success', receipt
                approved = True
            status = (task.get('phase'), [(job['kind'], job['status'], job['attempt'], (job.get('budget') or {}).get('phase')) for job in jobs])
            if status != previous:
                print(json.dumps({'event': 'state', 'case': name, 'status': status}, ensure_ascii=False), flush=True)
                previous = status
            if task.get('phase') in ('complete', 'paused') and not state.get('reviewing'):
                terminal = task['phase']
                break
            time.sleep(2)
        if terminal is None:
            terminal = 'deadline'
            host.rpc('commands/execute', {'agentId': sid, 'line': '/task pause', 'submittedAttachments': []})
        settle = time.time() + 60
        while host.item(sid)['running'] and time.time() < settle:
            time.sleep(.2)
        events = host.events(sid)
        (out / (name + '-root.private.json')).write_text(json.dumps(events, ensure_ascii=False))
        details, tokens = [], {sid: host.item(sid)['projections']['values'].get('tokenUsage')}
        for job in jobs:
            log = host.events(job['reviewerSessionId'], sid)
            (out / (job['id'] + '.private.json')).write_text(json.dumps(log, ensure_ascii=False))
            calls = [event for event in log if event['type'] == 'tool/call']
            reads = [(event['data']['name'], json.dumps(event['data']['arguments'], sort_keys=True, ensure_ascii=False)) for event in calls if event['data']['name'].startswith(('read_', 'inspect_', 'list_'))]
            tokens[job['reviewerSessionId']] = host.item(job['reviewerSessionId'])['projections']['values'].get('tokenUsage')
            details.append({key: job.get(key) for key in ('id', 'kind', 'status', 'attempt', 'budget', 'startedAt', 'finishedAt', 'cleanupHistory', 'confirmation', 'fault', 'recovery', 'sessionChain')})
            details[-1].update({'verdict': (job.get('decision') or {}).get('verdict'), 'requirements': (job.get('decision') or {}).get('requirements'), 'incrementalFindings': len((job.get('verification') or {}).get('checkHistory', [])), 'checks': len((job.get('verification') or {}).get('checks', [])), 'toolCalls': len(calls), 'repeatedReads': sum(count - 1 for count in collections.Counter(reads).values()), 'requestConfig': [event['data'].get('header', {}).get('config') for event in log if event['type'] == 'request/header']})
        input_ok = all((workspace / name).is_file() and hashlib.sha256((workspace / name).read_bytes()).hexdigest() == digest for name, digest in case_hashes.items())
        expected_paths = sorted(set(case_paths) | ({'summary.md', 'result.json'} if name == 'delivery' else set()))
        input_ok = input_ok and sorted(path.name for path in workspace.iterdir()) == expected_paths
        artifact_ok = input_ok and (workspace / 'result.json').exists() and (workspace / 'summary.md').exists() and json.loads((workspace / 'result.json').read_text()).get('sum') == 22 and all(text in (workspace / 'summary.md').read_text() for text in ('2026-10-11', '甲', '乙', '初稿')) if name == 'delivery' else input_ok
        success = terminal == 'complete' and artifact_ok if name == 'delivery' else terminal == 'paused' and artifact_ok and any((job.get('decision') or {}).get('verdict') == 'needs-user' for job in jobs)
        result = {'case': name, **freeze, 'taskId': task.get('id'), 'terminal': terminal, 'pauseReason': task.get('pauseReason'), 'elapsedSeconds': round(time.time() - start, 3), 'initialApprovals': int(approved), 'reward': int(success), 'artifactOracle': artifact_ok, 'jobs': details, 'tokens': tokens, 'tokenScope': 'Cumulative projections per unique Session; do not add repeated root projections across Tasks.', 'mainRequestConfig': [event['data'].get('header', {}).get('config') for event in events if event['type'] == 'request/header'], 'repairBudget': task.get('repairBudget'), 'grading': 'Deterministic development fixture, not public benchmark', 'falseAcceptance': None, 'falsePause': None}
        exclusive(out / (name + '-result.json'), result)
        print(json.dumps({'event': 'sealed', 'case': name, 'terminal': terminal, 'reward': int(success)}), flush=True)
        if name == 'delivery' and not success:
            return


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--log', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--tarball', required=True)
    parser.add_argument('--environment', required=True)
    parser.add_argument('--deadline', type=int, default=900)
    parser.add_argument('--case', choices=('all', 'delivery', 'negative', 'capability'), default='all')
    parser.add_argument('--collect-capability-rejection', action='store_true')
    args = parser.parse_args()
    collect_capability_rejection(args) if args.collect_capability_rejection else run(args)
