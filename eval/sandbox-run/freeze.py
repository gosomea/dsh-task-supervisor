#!/usr/bin/env python3
"""Freeze the admitted four-task matrix without model delivery or secret export."""
import argparse
import hashlib
import ipaddress
import json
from pathlib import Path
import subprocess
import sys

from records import exclusive_json

CONDITIONS = ('goal', 'plan', 'supervisor-independent')
SEED = 'dsh-opensandbox-long-horizon-v1'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def require(value, message):
    if not value: raise ValueError(message)


def matrix(tasks, *, development=False):
    require(len(tasks) == 4 and len(set(tasks)) == 4, 'four distinct admitted tasks required')
    rows = []
    for task in tasks:
        for condition in (('supervisor-independent',) if development else CONDITIONS):
            for repeat in (1, 2):
                rank = hashlib.sha256(f'{SEED}|{task}|{condition}|{repeat}'.encode()).hexdigest()
                rows.append({'taskId': task, 'condition': condition, 'repeat': repeat, 'rank': rank})
    rows.sort(key=lambda row: row['rank'])
    for index, row in enumerate(rows, 1):
        row['id'] = f'lh-{index:02}-{row["taskId"]}-{row["condition"]}-r{row["repeat"]}'
    return {'schemaVersion': 1, 'seed': SEED, 'scope': 'exposed-supervisor-development' if development else 'public-heldout-comparison', 'positions': rows}


def development_gate(value, tarball_sha256):
    require(value.get('step') == 4 and value.get('status') == 'validated', 'current Step 4 gate missing')
    require(value.get('candidate7', {}).get('tarballSha256') == tarball_sha256, 'development gate package differs')
    cases = {row.get('case'): row for row in value.get('cases', [])}
    require(set(cases) == {'delivery', 'negative', 'capability'} and all(row.get('reward') == 1 and row.get('artifactOracle') is True for row in cases.values()), 'cross-product development gate failed')
    require(cases['delivery']['terminal'] == 'complete' and cases['negative']['terminal'] == 'paused'
        and cases['capability']['terminal'] == 'capability-unavailable', 'development oracle terminal differs')
    require(all(job.get('status') == 'applied' and job.get('confirmation', {}).get('appliedAt')
        and job.get('cleanupHistory') and all(item.get('confirmed') is True for item in job['cleanupHistory'])
        for row in cases.values() for job in row['jobs']), 'development applications or cleanup unconfirmed')


def development_amendment_gate(value, tarball_sha256, previous, previous_sha256, source_commit, changed_sources):
    """A narrow budget correction preserves, rather than relabels, the prior model gate."""
    require(value.get('schemaVersion') == 1 and value.get('kind') == 'review-budget-reserve-correction',
            'unsupported development amendment')
    require(value.get('previousReleaseSha256') == previous_sha256
        and value.get('previousPluginSourceCommit') == previous['pluginSourceCommit']
        and value.get('previousTarballSha256') == previous['tarballSha256'], 'development amendment parent differs')
    require(value.get('pluginSourceCommit') == source_commit and value.get('tarballSha256') == tarball_sha256,
            'development amendment current package/source differs')
    require(changed_sources == ['src/review-budget.ts'] and value.get('changedSources') == changed_sources,
            'development amendment exceeds the validated budget-only source change')
    checks = value.get('checks', {})
    require(all(checks.get(key) is True for key in ('preFixRegressionFailed', 'lightReserveNativeHostPassed',
        'absoluteTaskCutoffPassed', 'lateDecisionRejected', 'sameJobAndEvidencePreserved',
        'hostClientStrictPassed', 'buildPassed', 'cleanInstallBytesMatched'))
        and checks.get('kernelExitCode') == 0 and type(checks.get('kernelPassed')) is int
        and checks['kernelPassed'] > 0, 'development amendment validation incomplete')
    require(value.get('priorModelEvidenceReused') is True and value.get('priorModelEvidenceRelabeled') is False,
            'development amendment must retain the original model evidence identity')


def amended_package_gate(value, tarball_sha256, amended):
    if amended:
        require(value.get('tarballSha256') == tarball_sha256,
                'amended package requires current-package route and gateway evidence')


def freeze(config, out):
    source = Path(config['source']).resolve()
    require(not out.exists(), 'release directory already exists; no replacement')
    selection = read(config['selection'])
    require(selection['seed'] == SEED, 'selection seed differs')
    tasks = selection['selectedTaskIds']
    development = config.get('developmentRegression') is True
    amendment_path = config.get('developmentAmendment') if development else None
    registry = config.get('bootstrapRegistryIpv4', [])
    if registry:
        registry = [str(ipaddress.IPv4Address(value)) for value in registry]
    candidates = {row['id']: row for rows in selection['candidates'].values() for row in rows}
    require([candidates[task]['language'] for task in tasks].count('go') == 2
        and [candidates[task]['language'] for task in tasks].count('typescript') == 2, 'two Go and two TypeScript tasks required')
    if not development:
        require(not set(tasks) & set(selection['excludedTaskIds']), 'an exposed task was selected')
    else:
        original = read(config['originalExposedOrder'])
        exposed = {row['taskId'] for row in original['positions'] if row['condition'] == 'supervisor-independent'}
        require(set(tasks) == exposed and len(exposed) == 4, 'development tasks must be the original four exposed Supervisor tasks')
    template = read(config['templateSpec'])
    for key in ('protocolControls', 'routeAudit', 'modelPatch'):
        require(digest(template[key]) == template[key + 'Sha256'], 'template runtime bytes changed')
    gates = []
    def gate(path):
        gates.append({'sha256': digest(path), 'privateSource': str(Path(path).resolve())})
        return read(path)
    if development:
        gate(config['originalExposedOrder'])
        if amendment_path:
            previous = gate(config['previousRelease'])
            require(previous.get('scope') == 'exposed-supervisor-development'
                and previous.get('planned') == 8, 'amendment requires an original eight-position development release')
            prior_gate_path = Path(config['developmentGate']).resolve()
            require(any(Path(row['privateSource']).resolve() == prior_gate_path
                and row['sha256'] == digest(prior_gate_path) for row in previous['gates']),
                'original development gate is not bound to the previous release')
            development_gate(gate(prior_gate_path), previous['tarballSha256'])
            changed = subprocess.check_output(['git', '-C', str(source), 'diff', '--name-only',
                previous['pluginSourceCommit'], config['pluginSourceCommit'], '--', 'src'], text=True).splitlines()
            development_amendment_gate(gate(amendment_path), digest(config['tarball']), previous,
                digest(config['previousRelease']), config['pluginSourceCommit'], changed)
        else:
            development_gate(gate(config['developmentGate']), digest(config['tarball']))
    else:
        require(gate(config['revisionResult'])['strictSuccess'] is True, 'revision gate failed')
        fault = gate(config['faultResult'])
        checks = fault['officialGrade']['checks']
        require(fault['strictSuccess'] is True and all(checks.get(key) is True for key in
            ('sameJobAndSession', 'sameCutoffAndSnapshot', 'nodeAppliedOnce', 'preRetryReadQualificationsPreserved'))
            and checks['retryCount'] == 1, 'strict artifact recovery gate failed')
    route = gate(config['routeEvidence'])
    amended_package_gate(route, digest(config['tarball']), bool(amendment_path))
    require(route['routesMatched'] is True and route['main']['successfulRequestAndDurableAnswer'] is True
        and any(row.get('successfulRequestAndDurableAnswer') is True for row in route['reviewers']), 'actual main/reviewer route evidence missing')
    baselines = {}
    official_images = {}
    for task in tasks:
        baseline = gate(config['baselines'][task])
        amended_package_gate(baseline, digest(config['tarball']), bool(amendment_path))
        require(baseline.get('passed') is True and baseline['taskId'] == task and baseline['modelRequests'] == 0
            and baseline['sourceUnchanged'] is True and baseline['dockerSocketMounted'] is False
            and baseline['baselineHasGatewayMounts'] is False and baseline['baselineHasCredentials'] is False,
            'candidate snapshot/check admission failed')
        native = gate(config['nativeAdmissions'][task])
        require(native.get('passed') is True and native['tarballSha256'] == digest(config['tarball'])
            and native['image'] == baseline['image'], 'frozen package/native image admission differs')
        require(baseline['baseCommit'] == candidates[task]['baseCommit'], 'candidate base commit differs')
        baselines[task] = baseline
        for agent, expected in (('nop', 0), ('oracle', 1)):
            control = gate(config['officialControls'][task][agent])
            require(control['passed'] is True and control['taskId'] == task and control['reward'] == expected and control['modelRequests'] == 0,
                'official empty/reference control failed')
            previous = official_images.setdefault(task, control['imageDigest'])
            require(previous == control['imageDigest'], 'official control image differs')
    dataset = Path(config['dataset'])
    require(subprocess.check_output(['git', '-C', str(dataset), 'rev-parse', 'HEAD'], text=True).strip()
        == selection['datasetCommit'], 'dataset commit differs')
    require(not subprocess.check_output(['git', '-C', str(dataset), 'status', '--porcelain']).strip(), 'dataset is dirty')
    for task in tasks:
        original = dataset / 'tasks' / task
        require(digest(original / 'instruction.md') == candidates[task]['instructionSha256']
            and digest(original / 'task.toml') == candidates[task]['taskMetadataSha256'], 'official task bytes differ')
    out.mkdir(parents=True, mode=0o700)
    def copy(path, relative):
        target = out / relative; target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream: stream.write(Path(path).read_bytes())
        return str(target.resolve())
    artifacts = {}
    for key, filename in (('tarball', 'plugin.tgz'), ('protocolControls', 'protocol-controls.mjs'),
                          ('routeAudit', 'route-audit.mjs'), ('modelPatch', 'model.patch.yml')):
        path = config['tarball'] if key == 'tarball' else template[key]
        artifacts[key] = copy(path, 'artifacts/' + filename)
    for directory in ('sandbox-run', 'deepswe'):
        for path in sorted((source / 'eval' / directory).glob('*.py')):
            copy(path, 'runner/' + directory + '/' + path.name)
    copy(source / 'eval/session_records.py', 'runner/session_records.py')
    order = matrix(tasks, development=development); exclusive_json(out / 'order.json', order)
    specs = {}
    for position in order['positions']:
        task = position['taskId']; candidate = candidates[task]; baseline = baselines[task]
        instruction = (dataset / 'tasks' / task / 'instruction.md').read_text()
        require(hashlib.sha256(instruction.encode()).hexdigest() == candidate['instructionSha256'], 'literal UTF-8 instruction differs')
        spec = {key: template[key] for key in ('schemaVersion', 'cwd', 'adminImage', 'adminPlatform',
            'dockerContext', 'credential', 'hostGateway')}
        spec.update(**position, formal=True, developmentRegression=development, dataset=str(dataset.resolve()), pierBin=config['pierBin'],
            deadlineSec=candidate['agentTimeoutSec'], mainCpus=candidate['mainCpus'],
            mainMemoryMiB=candidate['mainMemoryMiB'], reviewDeadlineMs=600000,
            image=baseline['image'], checkImage=baseline['checkImage'], platform='linux/amd64',
            snapshotId=baseline['snapshotId'], baseCommit=candidate['baseCommit'],
            instruction=instruction, instructionSha256=candidate['instructionSha256'],
            officialImageDigest=official_images[task], **artifacts,
            nativePresetSha256=config['nativePresetSha256'],
            storageLimitBytes=candidate['storageMiB'] * 1024 * 1024,
            checkStorageLimitBytes=4 * 1024 ** 3)
        if development:
            spec.update(progressReviewMode='anomaly', reviewBudget={'minMs': 120000,
                'maxMs': 600000, 'lightMs': 120000, 'regularMs': 300000, 'complexMs': 600000})
        if registry: spec['bootstrapRegistryIpv4'] = registry
        if position['condition'] != 'supervisor-independent':
            spec['nativeControllerSha256'] = config['nativeControllerSha256'][position['condition']]
        for key in artifacts: spec[key + 'Sha256'] = digest(artifacts[key])
        path = out / 'specs' / (position['id'] + '.json'); exclusive_json(path, spec)
        specs[position['id']] = digest(path)
    runtime_files = {str(Path(path).resolve()): digest(path) for path in config['runtimeFiles']}
    for task in tasks:
        for path in sorted((dataset / 'tasks' / task).rglob('*')):
            if path.is_file(): runtime_files[str(path.resolve())] = digest(path)
    release = {'schemaVersion': 1, 'modelAdmitted': True, 'planned': len(order['positions']), 'scope': order['scope'], 'datasetCommit': selection['datasetCommit'],
        'runnerCommit': subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip(),
        'pluginSourceCommit': config['pluginSourceCommit'], 'tarballSha256': digest(config['tarball']),
        'orderSha256': digest(out / 'order.json'), 'specsSha256': specs,
        'runnerFilesSha256': {str(path.relative_to(out)): digest(path) for path in sorted((out / 'runner').rglob('*.py'))},
        'runtimeFilesSha256': runtime_files, 'gates': gates, 'capacity': config['capacity'],
        'runtimeInventory': config['runtimeInventory'], 'storageEnforcement': '60-second-sampled-stop-not-hard-quota',
        'noRescue': True, 'initialApprovalMaximum': 1, 'formalRevisionMaximum': 0,
        'independentResources': {'cpus': 2, 'memoryMiB': 8192}, 'administratorResources': {'cpus': 1, 'memoryMiB': 1024},
        'collectionResources': {'cpus': 1, 'memoryMiB': 256, 'runsAfterExecutionStopped': True}}
    exclusive_json(out / 'release.json', release)
    return release


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    result = freeze(read(args.config), args.out)
    print(json.dumps({'planned': result['planned'], 'modelAdmitted': result['modelAdmitted'],
        'orderSha256': result['orderSha256']}))
