"""Verify an immutable step snapshot with the registered isolated DSH source."""
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile

root = Path(__file__).resolve().parents[3]
source = Path(os.environ.get('DSH_SOURCE', root.parent.parent / 'deepseek-harness-supervisor-seam'))
with tempfile.TemporaryDirectory(prefix='supervisor-step-check-') as directory:
    project = Path(directory)
    with tarfile.open(sys.argv[1]) as archive:
        archive.extractall(project, filter='data')
    (project / 'node_modules').symlink_to(root / 'node_modules', target_is_directory=True)
    env = dict(os.environ, DSH_SOURCE=str(source))
    for command in [['node', 'spikes/kernel/run.mjs', '--reporter=dot'], ['node', 'spikes/kernel/typecheck.mjs'], ['pnpm', 'run', 'build']]:
        result = subprocess.run(command, cwd=project, env=env)
        if result.returncode:
            raise SystemExit(result.returncode)
