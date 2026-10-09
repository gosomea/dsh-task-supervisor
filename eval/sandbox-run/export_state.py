"""Sandbox-local read-only Session evidence export. Never starts an Agent."""
import json
from pathlib import Path
import re
import sys


def selected_log(home, session_id):
    if not re.fullmatch(r'(?:session|task-review)-[a-f0-9-]{36}', session_id):
        raise ValueError('invalid Session identity')
    candidates = {}
    for path in (home / 'sessions').rglob('session*.jsonl'):
        if path.parent.name != session_id:
            continue
        match = re.fullmatch(r'session(?:\.v(\d+))?\.jsonl', path.name)
        if not match:
            continue
        generation = int(match[1] or 0)
        if generation in candidates:
            raise ValueError('ambiguous Session log generation')
        candidates[generation] = path
    return candidates[max(candidates)] if candidates else None


def main(session_id, destination):
    home = Path('/opt/eval/home')
    selected = selected_log(home, session_id)
    projection = home / 'storages/session_projcache/sessions' / (session_id + '.json')
    raw = selected.read_bytes() if selected else b''
    # The private outer observer receives native events, not credentials/home.
    Path(destination).write_text(json.dumps({'events': raw.decode(),
        'projection': json.loads(projection.read_text()) if projection.exists() else None,
        'hostExited': Path('/opt/eval/host.exited').exists()}))


if __name__ == '__main__': main(*sys.argv[1:])
