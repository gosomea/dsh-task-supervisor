"""Call the public DSH API from inside the sandbox, retaining its authentication.

OpenSandbox's server proxy intentionally filters application cookies. No DSH
authentication material is returned to the monitor or written to its logs.
"""
import json
from pathlib import Path
import sys
import urllib.request

from dsh_rpc import DshRpc, token_from_log


def main(request_path: str, response_path: str) -> None:
    request = json.loads(Path(request_path).read_text())
    rpc = DshRpc('http://127.0.0.1:3080', dialect='slash', timeout=request['timeout'])
    token = token_from_log(Path('/opt/eval/host.log').read_text())
    if not token:
        raise RuntimeError('DSH authentication bootstrap is not ready')
    rpc.authorize(token)
    if 'httpPath' in request:
        body = request.get('body')
        req = urllib.request.Request(rpc.base_url + request['httpPath'],
            data=None if body is None else json.dumps(body).encode(), method=request['verb'],
            headers=rpc._headers({'Content-Type': 'application/json'}))
        with rpc.opener.open(req, timeout=request['timeout']) as response:
            value = json.load(response)
    else:
        value = rpc.call(request['method'], request['args'])
    Path(response_path).write_text(json.dumps(value))


if __name__ == '__main__':
    main(*sys.argv[1:])
