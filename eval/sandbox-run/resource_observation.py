"""Bounded storage sampling while independent checks create and remove files."""
import re
import subprocess
from pathlib import PurePosixPath


class StorageObservationError(RuntimeError):
    pass


def _roots_identity(prefix, admin_id, roots, run):
    result = run([*prefix, 'exec', admin_id, 'env', 'LC_ALL=C', 'stat', '-Lc',
                  '%d:%i:%F', '--', *roots], capture_output=True, text=True, timeout=30)
    lines = result.stdout.splitlines()
    if result.returncode or result.stderr or len(lines) != len(roots) or any(
            not re.fullmatch(r'\d+:\d+:directory', line) for line in lines):
        raise StorageObservationError('private storage root identity unavailable')
    return tuple(lines)


def _missing_descendants(stderr, roots):
    lines = stderr.splitlines()
    if not lines:
        return None
    for line in lines:
        match = re.fullmatch(r"du: cannot access '(.+)': No such file or directory", line)
        if not match:
            return None
        path = PurePosixPath(match[1])
        if '..' in path.parts or not any(path != root and path.is_relative_to(root) for root in roots):
            return None
    return len(lines)


def _complete_total(stdout, roots):
    rows = stdout.splitlines()
    values = {}
    for row in rows:
        size, separator, path = row.partition('\t')
        if not separator or not size.isascii() or not size.isdigit() or path not in roots or path in values:
            raise StorageObservationError('private storage sample is incomplete or malformed')
        values[path] = int(size)
    if set(values) != set(roots):
        raise StorageObservationError('private storage sample lacks an expected root')
    return sum(values.values())


def sample_private_storage(prefix, admin_id, roots, *, run=subprocess.run):
    """Keep du apparent-byte semantics; retry only one disappearing-child sample.

    Partial totals never count. Both volume roots must remain the same directories.
    Missing roots, access denial, unknown stderr and a second race remain faults.
    """
    roots = tuple(roots)
    paths = tuple(PurePosixPath(root) for root in roots)
    if not roots or len(set(roots)) != len(roots) or any(
            not path.is_absolute() or path == PurePosixPath('/') or '..' in path.parts
            or str(path) != root for path, root in zip(paths, roots)):
        raise ValueError('distinct absolute storage roots required')
    identity = _roots_identity(prefix, admin_id, roots, run)
    missing = 0
    for attempt in range(2):
        result = run([*prefix, 'exec', admin_id, 'env', 'LC_ALL=C', 'du', '-sb', '--', *roots],
                     capture_output=True, text=True, timeout=30)
        if _roots_identity(prefix, admin_id, roots, run) != identity:
            raise StorageObservationError('private storage roots changed during observation')
        if result.returncode == 0:
            if result.stderr:
                raise StorageObservationError('private storage sample has unexpected stderr')
            return {'bytes': _complete_total(result.stdout, roots), 'resamples': attempt,
                    'transientMissingEntries': missing}
        disappeared = _missing_descendants(result.stderr, paths)
        if result.returncode != 1 or disappeared is None:
            raise StorageObservationError('private storage command failed without an admissible child race')
        missing += disappeared
    raise StorageObservationError('private storage changed during both bounded samples')
