"""Small authenticated DSH Web RPC client for isolated benchmark runs.

The startup token is read from a private local log and never written to run
artifacts. A fresh client authenticates before each independent process run.
"""

import http.cookiejar
import json
import re
import urllib.error
import urllib.request
import uuid
from pathlib import Path


class WebRpc:
    def __init__(self, startup_log: Path, base_url: str):
        self.base_url = base_url.rstrip("/")
        urls = re.findall(r"http://127\.0\.0\.1:\d+/\?token=[^\s\x1b]+", startup_log.read_text())
        urls = [url for url in urls if url.startswith(self.base_url + "/?token=")]
        if not urls:
            raise RuntimeError("No startup authentication URL for this Host")
        cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cookie_jar))
        try:
            self.opener.open(urls[-1], timeout=15).read()
        except urllib.error.HTTPError as error:
            # A headless Host can authenticate and then redirect to a UI path
            # whose static build is absent. The cookie is still valid for RPC.
            if error.code != 404 or not list(cookie_jar):
                raise

    def raw_call(self, method: str, args: dict) -> dict:
        data = {
            "type": "client-request",
            "rpcId": str(uuid.uuid4()),
            "method": method,
            "payload": {"args": args},
        }
        req = urllib.request.Request(
            f"{self.base_url}/api/{method}",
            data=json.dumps(data).encode(),
            headers={"Content-Type": "application/json", "Origin": self.base_url},
        )
        result = json.load(self.opener.open(req, timeout=60))["result"]
        if not result["ok"]:
            raise RuntimeError(f"{method} failed: {result['error']}")
        return result["value"]

    def call(self, method: str, request: dict | None = None) -> dict:
        args = {"_request": request or {}} if method == "session/list" else {"request": request or {}}
        return self.raw_call(method, args)

    def command(self, session_id: str, line: str) -> dict:
        return self.raw_call("commands/execute", {
            "agentId": session_id,
            "line": line,
            "submittedAttachments": [],
        })

    def page(self, session_id: str, through_seq: int, max_messages: int = 100) -> dict:
        return self.call("session/page", {
            "address": {"kind": "session", "sessionId": session_id},
            "throughSeq": through_seq,
            "maxMessages": max_messages,
        })

    def prompt(self, session_id: str, text: str) -> dict:
        return self.call("session/prompt", {
            "requestId": str(uuid.uuid4()),
            "sessionId": session_id,
            "mode": "queue",
            "content": [{"type": "text", "text": text}],
        })
