#!/usr/bin/env python3
"""Exercise the plugin's actual native snapshot/check code without sending model tasks."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import uuid


def compatible(result):
    return (result.get('modelRequests') == 0 and result.get('dockerSocketMounted') is False
            and result.get('snapshot', {}).get('captured') is True
            and result.get('check', {}).get('executed') is True
            and result['check'].get('exitCode') == 0
            and result['check'].get('timedOut') is False
            and result['check'].get('changed') == [])


def probe(context, image, runtime, node, bundle, max_files, max_bytes, deadline_ms, workspace):
    prefix = ['docker', '--context', context]
    ownership = str(uuid.uuid4())
    name = 'independent-preflight-' + ownership
    cid = None
    result = {'imageId': image, 'scope': 'representative-topology-only', 'modelRequests': 0}
    try:
        # No credentials, grading materials, other homes or Docker socket are mounted.
        cid = subprocess.check_output(prefix + ['create', '--name', name, '--label', 'dsh.eval.probe=' + ownership,
            '--pull', 'never', '--platform', 'linux/amd64', '--network', 'none', '--cpus', '1', '--memory', '4g',
            '--mount', f'type=bind,source={runtime},target=/dsh,readonly',
            '--mount', f'type=bind,source={node},target=/eval/node24,readonly',
            '--mount', f'type=bind,source={bundle},target=/eval/probe.mjs,readonly',
            '--workdir', '/dsh', '--entrypoint', '/eval/node24', image, '/eval/probe.mjs', image,
            str(max_files), str(max_bytes), str(deadline_ms), workspace], text=True).strip()
        ran = subprocess.run(prefix + ['start', '-a', cid], capture_output=True, text=True, timeout=deadline_ms / 1000 + 30)
        result['containerExitCode'] = ran.returncode
        parsed = [json.loads(line) for line in ran.stdout.splitlines() if line.startswith('{')]
        if parsed:
            result['nativeProbe'] = parsed[-1]
        else:
            result['infrastructureError'] = 'Native probe produced no JSON; see private output'
        # Raw stderr stays in the local cache, not the published result.
        private = bundle.parent / (name + '.log')
        with private.open('x') as log:
            log.write(ran.stdout + '\n' + ran.stderr)
        private.chmod(0o600)
    except subprocess.TimeoutExpired:
        result['infrastructureError'] = 'Native probe deadline exceeded'
    finally:
        if cid:
            data = json.loads(subprocess.check_output(prefix + ['inspect', cid], text=True))[0]
            if data['Id'] != cid or data['Config']['Labels'].get('dsh.eval.probe') != ownership:
                raise RuntimeError('Probe ownership mismatch; refusing cleanup')
            subprocess.run(prefix + ['rm', '-f', cid], check=True, stdout=subprocess.DEVNULL, timeout=30)
            remaining = subprocess.check_output(prefix + ['container', 'ls', '-aq', '--filter', 'id=' + cid], text=True).strip()
            if remaining:
                raise RuntimeError('Probe container cleanup did not settle')
            result['ownedContainerRemoved'] = True
    result['runtimeTopologyCompatible'] = result.get('containerExitCode') == 0 and compatible(result.get('nativeProbe', {}))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--context', required=True)
    parser.add_argument('--runtime', type=Path, required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--image', action='append', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--max-files', type=int, default=10000)
    parser.add_argument('--max-bytes', type=int, default=256 * 1024 * 1024)
    parser.add_argument('--deadline-ms', type=int, default=45000)
    parser.add_argument('--workspace', default='/app', help='Execution-world snapshot root; subtree probes do not prove full-task compatibility')
    args = parser.parse_args()
    if args.output.exists():
        parser.error('Refusing to overwrite evidence')
    if args.max_files < 1 or args.max_bytes < 1 or not 1 <= args.deadline_ms <= 3600000:
        parser.error('Snapshot limits must be positive; deadline must be 1..3600000 ms')
    rows = [probe(args.context, image, args.runtime.resolve(), args.node.resolve(), args.bundle.resolve(), args.max_files, args.max_bytes, args.deadline_ms, args.workspace) for image in args.image]
    result = {'schemaVersion': 1, 'kind': 'representative-official-image-topology-preflight',
              'probeSha256': hashlib.sha256(args.bundle.read_bytes()).hexdigest(), 'modelRequests': 0,
              'rows': rows, 'runtimeTopologyCompatible': all(r['runtimeTopologyCompatible'] for r in rows),
              'modelAdmitted': False,
              'limitations': ['Representative images are not the two new selected tasks or their official controls.',
                              'Runtime/config freezing, model parity and task-specific controls remain required.',
                              'No model, approval, benchmark solution or hidden tests were used.']}
    with args.output.open('x') as output:
        json.dump(result, output, ensure_ascii=False, indent=2)
        output.write('\n')
    print(json.dumps({'topologyCompatible': result['runtimeTopologyCompatible'], 'modelAdmitted': False, 'modelRequests': 0}))


if __name__ == '__main__':
    main()
