"""Patch selection, task-log reading, and the DSH RPC dialects."""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from dsh_rpc import DshRpc
from launch import command_for, node_version_from_index, observation_from_task, read_task_log, select_model_patch
from policy import decide


PATCH = """- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    baseURL: http://127.0.0.1:15721/tencent/v1
- id: agent-default-model
  name: '@deepseek-ai/dsh-agent-default-model'
  config:
    provider: deepseek-codebuddy
    model: deepseek-v4.1-flash
- id: permission
  name: '@deepseek-ai/dsh-permission-presets'
  config:
    defaultPreset: danger-full-access
- id: computer-use
  name: '@deepseek-ai/dsh-computer-use'
- id: llm-deepseek
  name: '@deepseek-ai/dsh-llm-deepseek'
  config:
    baseURL: http://127.0.0.1:15721/v1
"""


class PatchTests(unittest.TestCase):
    def test_worker_patch_rewrites_proxy_and_drops_other_plugins(self) -> None:
        text = select_model_patch(PATCH, rewrite_proxy=True, workspace_write=True)
        self.assertIn("http://host.docker.internal:15721/tencent/v1", text)
        self.assertIn("http://host.docker.internal:15721/v1", text)
        self.assertNotIn("127.0.0.1:15721", text)
        self.assertNotIn("computer-use", text)
        self.assertIn("defaultPreset: workspace-write", text)
        self.assertIn("compression: none", text)

    def test_supervisor_patch_keeps_the_host_proxy(self) -> None:
        text = select_model_patch(PATCH, rewrite_proxy=False, workspace_write=True)
        self.assertIn("http://127.0.0.1:15721/v1", text)
        self.assertNotIn("host.docker.internal", text)


class TaskLogTests(unittest.TestCase):
    def test_latest_state_and_plan_review_drive_one_approval(self) -> None:
        task = {"phase": "awaiting-approval", "planVersion": 2, "pauseReason": None}
        job = {
            "kind": "plan", "stageId": "plan", "status": "applied", "fault": None,
            "planVersion": 1, "input": {"planVersion": 1},
            "decision": {"verdict": "pass"},
        }
        log = "\n".join([
            json.dumps({"type": "extension/record", "data": {
                "namespace": "dsh-task-supervisor", "kind": "state",
                "payload": {"phase": "planning", "planVersion": 0},
            }}),
            json.dumps({"type": "extension/record", "data": {
                "namespace": "dsh-task-supervisor-review", "kind": "job", "payload": job,
            }}),
            json.dumps({"type": "extension/record", "data": {
                "namespace": "dsh-task-supervisor", "kind": "state", "payload": task,
            }}),
        ])
        found, jobs = read_task_log(log)
        observation = observation_from_task(found, jobs)
        self.assertEqual(decide(observation).action, "approve")
        self.assertEqual(command_for("approve"), "/task approve")
        self.assertIsNone(command_for("seal"))
        self.assertIsNone(command_for("none"))

    def test_v4_inbox_record_is_the_task_state(self) -> None:
        state = {
            "namespace": "dsh-task-supervisor", "kind": "state",
            "payload": {"phase": "planning", "planVersion": 0, "pauseReason": None},
        }
        job = {
            "namespace": "dsh-task-supervisor-review", "kind": "job",
            "payload": {"kind": "plan", "stageId": "plan", "status": "started", "fault": None},
        }
        log = "\n".join([
            json.dumps({"type": "agent/inbox/spliced", "data": {
                "inserted": [{"source": {"record": state}}],
            }}),
            json.dumps({"type": "agent/inbox/spliced", "data": {
                "inserted": [{"source": {"record": job}}],
            }}),
        ])
        found, jobs = read_task_log(log)
        observation = observation_from_task(found, jobs)
        self.assertEqual(found["phase"], "planning")
        self.assertEqual(len(jobs), 1)
        self.assertEqual(decide(observation).action, "none")

    def test_node_index_selects_the_newest_24(self) -> None:
        chosen = node_version_from_index([
            {"version": "v22.21.0"}, {"version": "v24.1.0"}, {"version": "v24.10.0"},
        ])
        self.assertEqual(chosen, "v24.10.0")


class RpcTests(unittest.TestCase):
    def test_slash_dialect_wraps_the_request_field(self) -> None:
        seen = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = json.loads(self.rfile.read(length))
                seen["path"] = self.path
                seen["args"] = body["payload"]["args"]
                payload = {"type": "server-response", "rpcId": body["rpcId"],
                           "result": {"ok": True, "value": {"workspace": {"workspaceId": "ws"}}}}
                raw = json.dumps(payload).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)

            def log_message(self, _format, *_args):
                return

        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            value = DshRpc(f"http://127.0.0.1:{port}", dialect="slash").create_workspace("/workspace")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)
        self.assertEqual(seen["path"], "/api/workspace/create")
        self.assertEqual(seen["args"], {"request": {"path": "/workspace"}})
        self.assertEqual(value["workspace"]["workspaceId"], "ws")
