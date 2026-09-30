"""Authenticated native DSH Web RPC without logging authentication URLs."""
import http.cookiejar
import json
import re
import urllib.error
import urllib.request
import uuid


class WebRpc:
    def __init__(self, startup_log, base_url, startup_port=None, *, command_timeout=30):
        if not isinstance(command_timeout, (int, float)) or not 1 <= command_timeout <= 3600:
            raise ValueError('Command RPC timeout must be between 1 and 3600 seconds')
        self.command_timeout = command_timeout
        self.base_url = base_url.rstrip('/')
        urls = re.findall(r'http://127\.0\.0\.1:\d+/\?token=[^\s\x1b]+', startup_log.read_text())
        startup_base = self.base_url if startup_port is None else f'http://127.0.0.1:{startup_port}'
        urls = [url for url in urls if url.startswith(startup_base + '/?token=')]
        urls = [self.base_url + '/?token=' + url.split('/?token=', 1)[1] for url in urls]
        if not urls:
            raise RuntimeError('missing private Host authentication URL')
        jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
        try:
            self.opener.open(urls[-1], timeout=15).read()
        except urllib.error.HTTPError as error:
            if error.code != 404 or not list(jar):
                raise

    def raw_call(self, method, args, *, timeout=30):
        request = urllib.request.Request(self.base_url + '/api/' + method,
            data=json.dumps({'type': 'client-request', 'rpcId': str(uuid.uuid4()),
                             'method': method, 'payload': {'args': args}}).encode(),
            headers={'Content-Type': 'application/json', 'Origin': self.base_url})
        result = json.load(self.opener.open(request, timeout=timeout))['result']
        if not result['ok']:
            raise RuntimeError(method + ' RPC failed')
        return result['value']

    def call(self, method, request=None):
        return self.raw_call(method, {'_request' if method == 'session/list' else 'request': request or {}})

    def command(self, session_id, line):
        return self.raw_call('commands/execute', {'agentId': session_id, 'line': line, 'submittedAttachments': []},
                             timeout=self.command_timeout)

    def prompt(self, session_id, text, *, request_id=None):
        return self.call('session/prompt', {'requestId': request_id or str(uuid.uuid4()),
            'sessionId': session_id, 'mode': 'queue', 'content': [{'type': 'text', 'text': text}]})
