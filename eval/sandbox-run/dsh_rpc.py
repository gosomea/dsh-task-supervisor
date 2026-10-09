"""HTTP client for the DSH web host.

DSH 0.1.0-rc.6 serves unary methods at `/api/<method>` with a dotted method
name (`session.list`). Slash commands go to `/api/commands/execute`. Loopback
accepts an Origin that matches the Host; this client does not log the URL.
"""

import http.cookiejar
import json
import re
import urllib.error
import urllib.parse
import urllib.request
import uuid


class DshRpcError(RuntimeError):
    pass


def token_from_log(text: str) -> str | None:
    match = re.search(r"\?token=([^\s\x1b]+)", text)
    return match.group(1) if match else None


class DshRpc:
    def __init__(self, base_url: str, *, dialect: str = "dotted", timeout: float = 30,
                 send_origin: bool = True) -> None:
        if dialect not in {"dotted", "slash"}:
            raise ValueError("dialect must be dotted or slash")
        self.base_url = base_url.rstrip("/")
        self.dialect = dialect
        self.timeout = timeout
        parts = urllib.parse.urlsplit(self.base_url)
        self.origin = f"{parts.scheme}://{parts.netloc}" if send_origin else None
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def _headers(self, extra: dict[str, str] | None = None) -> dict[str, str]:
        headers = dict(extra or {})
        if self.origin is not None:
            headers["Origin"] = self.origin
        return headers

    def authorize(self, token: str) -> None:
        request = urllib.request.Request(
            self.base_url + "/?token=" + token,
            headers=self._headers(),
        )
        try:
            self.opener.open(request, timeout=self.timeout).read()
        except urllib.error.HTTPError as error:
            if error.code != 404 or not list(self.jar):
                raise DshRpcError(f"host token was rejected ({error.code})") from error

    def list_sessions(self):
        if self.dialect == "slash":
            return self.call("session/list", {"_request": {}})
        return self.call("session.list", {})

    def create_workspace(self, path: str):
        if self.dialect == "slash":
            return self.call("workspace/create", {"request": {"path": path}})
        return self.call("workspace.create", {"path": path})

    def create_session(self, workspace_id: str, agent_preset: str = "standard"):
        request = {"workspaceId": workspace_id, "agentPreset": agent_preset}
        if self.dialect == "slash":
            return self.call("session/create", {"request": request})
        return self.call("session.create", request)

    def call(self, method: str, args: dict, *, timeout: float | None = None):
        body = {
            "type": "client-request",
            "rpcId": str(uuid.uuid4()),
            "method": method,
            "payload": {"args": args},
        }
        request = urllib.request.Request(
            self.base_url + "/api/" + method,
            data=json.dumps(body).encode(),
            headers=self._headers({"Content-Type": "application/json"}),
        )
        try:
            with self.opener.open(request, timeout=timeout or self.timeout) as response:
                payload = json.load(response)
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace")[:300]
            raise DshRpcError(f"{method} HTTP {error.code}: {detail}") from error
        except urllib.error.URLError as error:
            raise DshRpcError(f"{method} unreachable: {error.reason}") from error
        result = payload.get("result")
        if not isinstance(result, dict) or not result.get("ok"):
            error = result.get("error") if isinstance(result, dict) else None
            code = error.get("code") if isinstance(error, dict) else ""
            message = error.get("message") if isinstance(error, dict) else ""
            raise DshRpcError(f"{method} failed: {code} {message}".strip()[:400])
        return result.get("value")

    def command(self, session_id: str, line: str, *, timeout: float | None = None):
        value = self.call(
            "commands/execute",
            {"agentId": session_id, "line": line, "submittedAttachments": []},
            timeout=timeout,
        )
        outcome = value.get("result") if isinstance(value, dict) else None
        if isinstance(outcome, dict) and outcome.get("kind") == "error":
            raise DshRpcError("command failed: " + str(outcome.get("text") or "")[:300])
        return value
