"""Bind each executed DeepSWE input to the parent's frozen runtime inventory."""
from pathlib import Path
import re
import shutil

POSITION_ROOTS = frozenset({'runner', 'runtime', 'plugin', 'profile', 'node', 'docker',
    'pier', 'dataset', 'pierRuntime', 'hostNode', 'hostDocker', 'playwright',
    'playwrightRuntime', 'chrome', 'chromeRuntime', 'reviewAudit'})


def inside(path, root):
    return path == root or root in path.parents


def assert_position_inputs(spec, protocol, executing_file):
    """Reject unfrozen datasets, installed graders, Plan tools, audit code and mutable helpers."""
    given = spec['release']['roots']
    if not POSITION_ROOTS.issubset(given):
        raise ValueError('The position lacks actual executed runtime inputs')
    roots = {name: Path(value).resolve(strict=True) for name, value in given.items()}
    executing = Path(executing_file).resolve(strict=True)
    if not inside(executing, roots['runner']) or Path(spec['runner']).resolve(strict=True) != executing.parent:
        raise ValueError('Executing position adapter differs from the frozen runner')
    if Path(spec['dataset']).resolve(strict=True) != roots['dataset']:
        raise ValueError('Scoring dataset differs from the frozen official checkout')
    pier_bin = Path(spec['pierBin']).resolve(strict=True)
    if not pier_bin.is_file() or not inside(pier_bin, roots['pierRuntime']):
        raise ValueError('Actual installed grader is outside its frozen environment')
    if not roots['reviewAudit'].is_file():
        raise ValueError('Review audit must be a separately frozen source file')
    if 'reviewAudit' in spec and Path(spec['reviewAudit']).resolve(strict=True) != roots['reviewAudit']:
        raise ValueError('Selected review audit differs from its frozen file')
    if 'hostNode' in spec and Path(spec['hostNode']).resolve(strict=True) != roots['hostNode']:
        raise ValueError('Actual Host Node alias points to another binary')
    if not roots['hostNode'].is_file() or not roots['chrome'].is_file():
        raise ValueError('Host Node and Chrome roots must freeze actual binaries')
    actual_docker = shutil.which('docker')
    if not actual_docker or not roots['hostDocker'].is_file() or Path(actual_docker).resolve(strict=True) != roots['hostDocker']:
        raise ValueError('Actual PATH Docker differs from the frozen Host CLI')
    if not roots['chromeRuntime'].is_dir() or not inside(roots['chrome'], roots['chromeRuntime']):
        raise ValueError('Chrome binary must belong to its frozen application runtime')
    if not roots['playwrightRuntime'].is_dir() or not inside(roots['playwright'], roots['playwrightRuntime']):
        raise ValueError('Playwright package must belong to its frozen dependency runtime')
    if spec['condition'] == 'plan':
        if 'hostNode' not in spec:
            raise ValueError('Native Plan client requires its frozen Host Node')
        plan = spec['planClient']
        entry = Path(plan['playwrightEntry']).resolve(strict=True)
        if not entry.is_file() or not inside(entry, roots['playwright']):
            raise ValueError('Actual Plan client imports unfrozen Playwright code')
        core = (roots['playwright'].parent / 'playwright-core').resolve(strict=True)
        if not core.is_dir() or not inside(core, roots['playwrightRuntime']):
            raise ValueError('Playwright core dependency is outside the frozen runtime')
        if Path(plan['chromePath']).resolve(strict=True) != roots['chrome']:
            raise ValueError('Actual Plan client launches another Chrome binary')
    if spec['condition'] == 'supervisor-independent':
        if (Path(spec['runtime']) / 'docker-static-amd64').resolve(strict=True) != roots['docker']:
            raise ValueError('Administrator gateway launches an unfrozen Linux Docker CLI')
        if not isinstance(spec.get('independentChecks'), dict):
            raise ValueError('Independent gateway settings must be frozen before launch')
        if not isinstance(spec.get('supervisorConfig'), dict):
            raise ValueError('Gateway patch must restate the full frozen Supervisor configuration')
    if not re.fullmatch(r'(?:[^\s]+@)?sha256:[a-f0-9]{64}', spec.get('netctlImage', '')):
        raise ValueError('The network control helper needs an immutable image digest')
    task = next((task for task in protocol['tasks'] if task['id'] == spec['taskId']), None)
    if task is None or task['storageMiB'] != 20480 or spec.get('storageMiB') != task['storageMiB']:
        raise ValueError('Official task storage metadata differs from the selected sample')
    if spec.get('storageEnforcement') != 'official-docker-metadata-only' or 'storageBoundBytes' in spec:
        raise ValueError('Storage must reflect official Docker metadata without an added hard quota')
