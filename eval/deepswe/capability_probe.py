#!/usr/bin/env python3
"""Real keyless tool parity after isolating each condition's native controller."""
import argparse
import hashlib
import json
from pathlib import Path

from control_flow import CONDITIONS, MODEL, exclusive_json
from control_rpc import WebRpc
from launch_host import launch, docker, owned

CONTROLLER_TOOLS = {'create_goal', 'get_goal', 'update_goal', 'exit_plan_mode'}


def run(root, cache, image):
    root, cache = Path(root), Path(cache)
    root.mkdir(mode=0o700)
    rows = []
    expected = None
    for index, condition in enumerate(CONDITIONS):
        case = root / condition; case.mkdir()
        spec = {'id': 'keyless-final-' + condition, 'condition': condition, 'home': str(case / 'home'),
            'runtime': str(cache / 'runtime'), 'template': str(cache / 'templates' / condition),
            'imageDigest': image, 'port': 32311 + index * 2,
            'keylessCapabilityProbe': str(cache / 'runtime/profile-probe.mjs'),
            'extraOverlay': '- insert:\n    - id: deepswe-profile-probe\n      name: /runner/profile-probe.mjs\n      config:\n        output: /evalhome/run/capabilities.json\n'}
        receipt = launch(spec)
        exclusive_json(case / 'launch.json', receipt)
        try:
            rpc = WebRpc(case / 'home/run/host.log', f'http://127.0.0.1:{receipt["port"]}', receipt['internalPort'])
            workspace = rpc.call('workspace/create', {'path': '/app'})['workspace']
            sid = rpc.call('session/create', {'workspaceId': workspace['workspaceId'], 'agentPreset': 'standard'})['sessionId']
            selected = rpc.call('session/selectModel', {'sessionId': sid, **MODEL})['selected']
            result = rpc.command(sid, '/eval-capabilities')['result']
            if result['kind'] != 'success': raise RuntimeError('keyless native tool capture failed')
            observed = json.loads((case / 'home/run/capabilities.json').read_text())
            tools = observed['tools']
            names = {tool['name'] for tool in tools}
            core = [tool for tool in tools if tool['name'] not in CONTROLLER_TOOLS and not tool['name'].startswith('task_')]
            if expected is None: expected = core
            if core != expected: raise RuntimeError('primary tool schemas differ across conditions')
            if condition == 'goal':
                matched = {'create_goal', 'get_goal', 'update_goal'} <= names and 'exit_plan_mode' not in names
            elif condition == 'plan':
                matched = not names.intersection({'create_goal', 'get_goal', 'update_goal'}) and 'exit_plan_mode' in names
            else:
                matched = not names.intersection(CONTROLLER_TOOLS) and 'task_submit_plan' in names
            if not matched: raise RuntimeError('foreign controller tool remains in native Agent')
            rows.append({'condition': condition, 'sessionId': sid, 'cwd': observed['cwd'], 'modelSelection': selected,
                'toolCount': len(tools), 'tools': tools, 'nativeControllerMatched': matched,
                'primaryToolSchemasSha256': hashlib.sha256(json.dumps(core,sort_keys=True).encode()).hexdigest(),
                'controllerOverlaySha256': receipt['controllerOverlaySha256'], 'modelRequests': 0})
        finally:
            owned(receipt['dockerContext'], receipt['container'], receipt['lease'])
            docker(receipt['dockerContext'], 'stop', '-t', '5', receipt['container'])
            if docker(receipt['dockerContext'], 'inspect', '--format', '{{.State.Running}}', receipt['container']) != 'false':
                raise RuntimeError('keyless host did not stop')
            docker(receipt['dockerContext'], 'rm', receipt['container'])
            exclusive_json(case / 'cleanup.json', {'containerStopped': True, 'containerRemoved': True})
    result = {'schemaVersion': 1, 'kind': 'final-controller-profile-capability-gate', 'passed': True,
              'primaryToolParity': True, 'modelRequests': 0, 'positions': rows}
    exclusive_json(root / 'result.json', result)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('root', type=Path); parser.add_argument('cache', type=Path); parser.add_argument('image')
    args = parser.parse_args()
    result = run(args.root, args.cache, args.image)
    print(json.dumps({'passed': result['passed'], 'conditions': [row['condition'] for row in result['positions']]}))
