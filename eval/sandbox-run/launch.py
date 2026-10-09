"""Restore the baseline snapshot and connect the worker and supervising DSH.

The worker runs inside the restored sandbox with this plugin. The supervising
DSH runs on the host, in its own home, without the plugin. Intervention is
`policy.decide`; this module does not invent a wider action.
"""

import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

from policy import Observation, decide


WORKER_HOME = "/opt/sandbox-run/worker"
WORKER_PORT = 8787
PLUGIN_PACKAGE = "dsh-task-supervisor"
DSH_VERSION = "0.2.0-rc.2"
HOST_NODE = Path(os.environ.get("SANDBOX_RUN_NODE", "/opt/homebrew/opt/node@24/bin/node"))
HOST_DSH = Path(os.environ.get("SANDBOX_RUN_DSH", "/tmp/dsh-020/node_modules/.bin/dsh"))
MODEL_PATCH_IDS = {"llm-pi-ai", "agent-default-model", "permission", "llm-deepseek", "locale"}
LOOPBACK_PROXY = "http://127.0.0.1:15721"
SANDBOX_PROXY = "http://host.docker.internal:15721"
SLASH_COMMANDS = {
    "approve": "/task approve",
    "resume": "/task resume",
    "retry-review": "/task retry-review",
}


class LaunchError(RuntimeError):
    pass


def _say(message: str) -> None:
    print(message, file=sys.stderr, flush=True)


def split_patch(text: str) -> list[str]:
    blocks: list[str] = []
    current: list[str] = []
    for line in text.splitlines(keepends=True):
        if line.startswith("- ") and current:
            blocks.append("".join(current))
            current = [line]
        else:
            current.append(line)
    if current:
        blocks.append("".join(current))
    return blocks


def _block_id(block: str) -> str | None:
    for line in block.splitlines():
        stripped = line.strip()
        if stripped.startswith("id:"):
            return stripped.split(":", 1)[1].strip().strip("'\"")
        if stripped.startswith("- id:"):
            return stripped.split(":", 1)[1].strip().strip("'\"")
    return None


def select_model_patch(text: str, *, rewrite_proxy: bool, workspace_write: bool) -> str:
    """Keep the model, locale, and permission entries from a profile patch."""
    kept: list[str] = []
    for block in split_patch(text):
        if _block_id(block) not in MODEL_PATCH_IDS:
            continue
        if workspace_write and _block_id(block) == "permission":
            block = block.replace("defaultPreset: danger-full-access", "defaultPreset: workspace-write")
        if rewrite_proxy:
            block = block.replace(LOOPBACK_PROXY, SANDBOX_PROXY)
        kept.append(block if block.endswith("\n") else block + "\n")
    if not any(_block_id(block) == "agent-default-model" for block in kept):
        raise LaunchError("model patch has no agent-default-model entry")
    kept.append(
        "- id: session-persistence-jsonl\n"
        "  name: '@deepseek-ai/dsh-session-persistence-jsonl'\n"
        "  config:\n"
        "    root: !!js dshHomePath('sessions')\n"
        "    compression: none\n"
    )
    return "".join(kept)


def command_for(action: str) -> str | None:
    return SLASH_COMMANDS.get(action)


def plan_review_passed(task: dict | None, jobs: list) -> bool:
    if not task or task.get("phase") != "awaiting-approval":
        return False
    for job in jobs:
        if job.get("kind") != "plan" or job.get("stageId") != "plan":
            continue
        if job.get("status") not in {"submitted", "applied"} or job.get("fault"):
            continue
        decision = job.get("decision") or {}
        reviewed = job.get("input") or {}
        if decision.get("verdict") != "pass":
            continue
        if job.get("planVersion") != reviewed.get("planVersion"):
            continue
        if task.get("planVersion") != reviewed.get("planVersion", -1) + 1:
            continue
        return True
    return False


def observation_from_task(task: dict | None, jobs: list, *, approvals: int = 0,
                          recovery_resumes: int = 0, restart_resumes: int = 0,
                          review_retries: int = 0, sandbox_path: str | None = None) -> Observation:
    fault = (task or {}).get("reviewFault") or {}
    return Observation(
        phase=None if task is None else task.get("phase"),
        pause_reason=None if task is None else task.get("pauseReason"),
        plan_review_passed=plan_review_passed(task, jobs),
        review_fault_retryable=bool(fault.get("retryable")),
        approvals=approvals,
        recovery_resumes=recovery_resumes,
        restart_resumes=restart_resumes,
        review_retries=review_retries,
        sandbox_path=sandbox_path,
    )


def _walk_records(value):
    if isinstance(value, dict):
        if value.get("type") == "extension/record":
            yield value
        record = value.get("record")
        if isinstance(record, dict) and {"namespace", "kind", "payload"} <= record.keys():
            yield {"type": "extension/record", "data": record}
        for child in value.values():
            yield from _walk_records(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk_records(child)


def read_task_log(text: str) -> tuple[dict | None, list]:
    task = None
    jobs: list = []
    for line in text.splitlines():
        line = line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        for record in _walk_records(parsed):
            data = record.get("data") or {}
            payload = data.get("payload")
            if not isinstance(payload, dict):
                continue
            if data.get("namespace") == "dsh-task-supervisor" and data.get("kind") == "state" and "phase" in payload:
                task = payload
            elif data.get("namespace") == "dsh-task-supervisor-review" and data.get("kind") == "job":
                jobs.append(payload)
    return task, jobs


def node_version_from_index(releases: list) -> str:
    """Pick the newest Node 24. DSH 0.2 starts only when import.meta.main exists."""
    versions = []
    for item in releases:
        version = item.get("version", "")
        if not version.startswith("v24."):
            continue
        versions.append((tuple(int(piece) for piece in version[1:].split(".")), version))
    if not versions:
        raise LaunchError("nodejs.org index has no Node 24 release")
    return max(versions)[1]


def _tail(text: str, limit: int = 2000) -> str:
    lines = [line for line in text.splitlines() if "npm error" in line.lower() or "ERR!" in line]
    chosen = "\n".join(lines) if lines else text.strip()
    return chosen if len(chosen) <= limit else chosen[-limit:]


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def _http_base(endpoint: str) -> str:
    if endpoint.startswith("http://") or endpoint.startswith("https://"):
        return endpoint.rstrip("/")
    return "http://" + endpoint.rstrip("/")


def _run_checked(runtime, sandbox, command: str, *, timeout_s: int, what: str) -> str:
    code, stdout, stderr = runtime.exec(sandbox, command, timeout_s=timeout_s)
    if code != 0:
        raise LaunchError(f"{what} failed ({code}): {_tail(stdout + chr(10) + stderr)}")
    return stdout


def _wait_rpc(base_url: str, *, dialect: str, token: str | None = None, attempts: int = 30,
              send_origin: bool = True):
    from dsh_rpc import DshRpc, DshRpcError

    rpc = DshRpc(base_url, dialect=dialect, timeout=5, send_origin=send_origin)
    if token:
        rpc.authorize(token)
    last = "not started"
    for _ in range(attempts):
        try:
            rpc.list_sessions()
            return rpc
        except DshRpcError as error:
            last = str(error)
            time.sleep(1)
    raise LaunchError(f"DSH did not answer session list: {last}")


def _plugin_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _pack_plugin(destination: Path) -> Path:
    destination.mkdir(parents=True, exist_ok=True)
    completed = subprocess.run(
        ["npm", "pack", "--pack-destination", str(destination), "--silent"],
        cwd=_plugin_root(), check=False, capture_output=True, text=True,
    )
    if completed.returncode != 0:
        raise LaunchError("npm pack failed: " + _tail(completed.stderr or completed.stdout))
    name = completed.stdout.strip().splitlines()[-1].strip()
    packed = destination / name
    if not packed.is_file():
        raise LaunchError("npm pack did not write a tarball")
    return packed


def _materialize_host(home: Path, port: int) -> subprocess.Popen:
    if not HOST_NODE.is_file() or not HOST_DSH.is_file():
        raise LaunchError("supervising DSH needs Node 24 and the dsh 0.2.0-rc.2 binary")
    env = os.environ.copy()
    env["DSH_HOME"] = str(home)
    env["DSH_TELEMETRY_DISABLED"] = "1"
    env["PATH"] = str(HOST_NODE.parent) + os.pathsep + env.get("PATH", "")
    log = open(home / "boot.log", "ab")
    return subprocess.Popen(
        [str(HOST_DSH), "web", "--host", "127.0.0.1", "--port", str(port), "--no-open"],
        env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
    )


def _stop(process: subprocess.Popen | None) -> None:
    if process is None or process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()


def _prepare_host_home(home: Path, patch: str, credentials: bytes) -> None:
    profile = home / "profiles" / "web"
    profile.mkdir(parents=True)
    credentials_path = home / ".credentials.yaml"
    credentials_path.write_bytes(credentials)
    credentials_path.chmod(0o600)
    process = _materialize_host(home, _free_port())
    try:
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            if (profile / "package.json").is_file():
                break
            if process.poll() is not None:
                raise LaunchError("supervising DSH exited before creating a profile")
            time.sleep(0.2)
        else:
            raise LaunchError("supervising DSH did not create a profile")
    finally:
        _stop(process)
    (profile / "cordis.patch.yml").write_text(patch)
    manifest = json.loads((profile / "package.json").read_text())
    bundles = manifest.get("dsh", {}).get("profile", {}).get("bundles", [])
    if PLUGIN_PACKAGE in bundles or PLUGIN_PACKAGE in manifest.get("dependencies", {}):
        raise LaunchError("supervising profile already contains the supervisor plugin")


def _boot_hint(home: Path) -> str:
    log = home / "boot.log"
    if not log.is_file():
        return "no boot log"
    for line in log.read_text(errors="replace").splitlines():
        if line.startswith("Error:"):
            return line[:300]
    return "process exited without an Error line"


def _start_supervisor(home: Path, port: int) -> tuple[subprocess.Popen, object]:
    process = _materialize_host(home, port)
    try:
        last = "not started"
        from dsh_rpc import DshRpc, DshRpcError, token_from_log

        rpc = DshRpc(f"http://127.0.0.1:{port}", dialect="slash", timeout=5)
        authorized = False
        for _ in range(30):
            if process.poll() is not None:
                raise LaunchError("supervising DSH exited: " + _boot_hint(home))
            if not authorized:
                token = token_from_log((home / "boot.log").read_text(errors="replace"))
                if token is None:
                    time.sleep(0.5)
                    continue
                rpc.authorize(token)
                authorized = True
            try:
                rpc.list_sessions()
                return process, rpc
            except DshRpcError as error:
                last = str(error)
                time.sleep(1)
        raise LaunchError(f"supervising DSH did not answer session list: {last}")
    except Exception:
        _stop(process)
        raise


def _redact(text: str) -> str:
    text = re.sub(r"token=[^\s&]+", "token=redacted", text)
    return re.sub(r"(?i)(api[_-]?key|authorization|bearer)\s*[:=]\s*\S+", r"\1=redacted", text)


def _worker_boot_report(runtime, sandbox) -> str:
    _code, stdout, stderr = runtime.exec(
        sandbox,
        f"echo bytes=$(wc -c < {WORKER_HOME}/boot.log 2>/dev/null || echo missing); "
        "echo '---log---'; "
        f"tail -c 1200 {WORKER_HOME}/boot.log 2>/dev/null || true; "
        "echo; echo '---proc---'; ps -ef | awk '/[d]sh web/'; "
        "echo '---port---'; (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null || true) | awk '$4 ~ /:8787$/'",
        timeout_s=20,
    )
    return (stdout or stderr).strip()[-1500:]


def _bwrap_status(runtime, sandbox) -> str:
    code, stdout, _stderr = runtime.exec(
        sandbox,
        "command -v bwrap >/dev/null && bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp -- true",
        timeout_s=30,
    )
    return "usable" if code == 0 else "unusable"


def _find_session_log(runtime, sandbox, session_id: str) -> str | None:
    _code, stdout, _stderr = runtime.exec(
        sandbox,
        f"find {WORKER_HOME}/sessions -type f "
        f"\\( -name 'session.jsonl' -o -name 'session.v4.jsonl' \\) -path '*/{session_id}/*' "
        "2>/dev/null || true",
        timeout_s=20,
    )
    paths = [line for line in stdout.splitlines() if line.strip()]
    if len(paths) > 1:
        raise LaunchError(f"expected one session log, found {len(paths)}")
    return paths[0] if paths else None


def docker_host_gateway() -> str:
    """IP the OpenSandbox server uses for host.docker.internal. Worker containers do not get that alias."""
    completed = subprocess.run(
        ["docker", "exec", "opensandbox-eval-server", "getent", "hosts", "host.docker.internal"],
        env={**os.environ, "DOCKER_HOST": os.environ.get(
            "DOCKER_HOST", "unix:///Users/yuqixian/.colima/dsh-eval-rosetta/docker.sock")},
        capture_output=True, text=True, check=False,
    )
    parts = completed.stdout.split()
    if completed.returncode != 0 or not parts or parts[0].count(".") != 3:
        raise LaunchError("could not resolve host.docker.internal from the OpenSandbox server")
    return parts[0]


def _node_version(runtime, sandbox) -> str:
    code, stdout, stderr = runtime.exec(
        sandbox, "curl -fsSL https://nodejs.org/dist/index.json", timeout_s=60,
    )
    if code != 0:
        raise LaunchError("could not read the Node release index: " + _tail(stderr or stdout))
    return node_version_from_index(json.loads(stdout))


def connect(runtime, *, baseline: dict, credentials: bytes, model_patch: str,
            supervisor_home: Path, supervisor_port: int, plugin_tarball: Path) -> dict:
    """Start both DSHs from a baseline receipt. The snapshot is not destroyed."""
    if supervisor_home.exists():
        raise LaunchError(f"refusing to reuse {supervisor_home}")
    snapshot_id = baseline["snapshotId"]
    expected = baseline["files"]
    sandbox = runtime.create(
        image=None, snapshot_id=snapshot_id, metadata={"role": "sandbox-run-worker"},
        network_policy="allow", timeout_minutes=60, cpu="2", memory="4Gi",
    )
    supervisor = None
    try:
        for name, digest in expected.items():
            actual = hashlib.sha256(runtime.read(sandbox, f"/workspace/{name}")).hexdigest()
            if actual != digest:
                raise LaunchError(f"restored {name} does not match the baseline")
        _say("baseline files match; starting the supervising DSH")
        _prepare_host_home(supervisor_home, select_model_patch(model_patch, rewrite_proxy=False,
                                                                workspace_write=True), credentials)
        supervisor, supervisor_rpc = _start_supervisor(supervisor_home, supervisor_port)
        listed = supervisor_rpc.list_sessions()
        if listed.get("items"):
            raise LaunchError("supervising DSH already has sessions")

        _say("supervising DSH is up; installing the worker")
        runtime.exec(sandbox, "mkdir -p /opt/sandbox-run", timeout_s=20)
        _run_checked(
            runtime, sandbox,
            "export DEBIAN_FRONTEND=noninteractive; apt-get update && apt-get install -y ca-certificates curl",
            timeout_s=300, what="worker package index",
        )
        node_version = _node_version(runtime, sandbox)
        _say(f"worker Node {node_version}")
        gateway = docker_host_gateway()
        runtime.write(sandbox, "/opt/sandbox-run/credentials.yaml", credentials, mode=600)
        runtime.write(sandbox, "/opt/sandbox-run/plugin.tgz", plugin_tarball.read_bytes())
        runtime.write(sandbox, "/opt/sandbox-run/worker-patch.yml",
                      select_model_patch(model_patch, rewrite_proxy=True, workspace_write=True).encode())
        install = "\n".join([
            "set -eu",
            "export DEBIAN_FRONTEND=noninteractive",
            "apt-get install -y xz-utils bubblewrap python3 make g++",
            "arch=$(uname -m | sed 's/aarch64/arm64/;s/x86_64/x64/')",
            f'curl -fsSL "https://nodejs.org/dist/{node_version}/node-{node_version}-linux-$arch.tar.xz" -o /tmp/node.tar.xz',
            "tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1",
            "npm install -g pnpm@11.7.0",
            "npm install -g --allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs "
            f"@deepseek-ai/dsh@{DSH_VERSION}",
            "node -v",
            "echo 'if (import.meta.main !== true) process.exit(1)' > /tmp/maincheck.mjs",
            "node /tmp/maincheck.mjs",
            "dsh --version",
            f"grep -q '[[:space:]]host.docker.internal$' /etc/hosts || echo '{gateway} host.docker.internal' >> /etc/hosts",
            "getent hosts host.docker.internal",
        ])
        _run_checked(runtime, sandbox, install, timeout_s=600, what="worker install")
        code, body, _stderr = runtime.exec(
            sandbox, "curl -sS -o /dev/null -w '%{http_code}' http://host.docker.internal:15721/v1/models",
            timeout_s=20,
        )
        proxy_status = body.strip() if code == 0 else "unreachable"
        _say(f"model proxy HTTP {proxy_status}")
        _run_checked(
            runtime, sandbox,
            f"install -d -m 700 {WORKER_HOME} && cp /opt/sandbox-run/credentials.yaml {WORKER_HOME}/.credentials.yaml && "
            f"chmod 600 {WORKER_HOME}/.credentials.yaml && "
            f"DSH_HOME={WORKER_HOME} DSH_TELEMETRY_DISABLED=1 dsh plugin --profile web add "
            f"--config.strict-peer-dependencies=false /opt/sandbox-run/plugin.tgz",
            timeout_s=300, what="worker plugin install",
        )
        _run_checked(
            runtime, sandbox,
            f"cp /opt/sandbox-run/worker-patch.yml {WORKER_HOME}/profiles/web/cordis.patch.yml && "
            f"node -e \"const m=require('{WORKER_HOME}/profiles/web/package.json'); "
            f"if (!m.dsh.profile.bundles.includes('dsh-task-supervisor')) process.exit(1)\"",
            timeout_s=20, what="worker plugin registration",
        )
        bwrap = _bwrap_status(runtime, sandbox)
        runtime.exec(
            sandbox,
            f"DSH_HOME={WORKER_HOME} DSH_TELEMETRY_DISABLED=1 dsh web --host 127.0.0.1 --port {WORKER_PORT} --no-open "
            f"--trusted-host host.docker.internal "
            f"> {WORKER_HOME}/boot.log 2>&1",
            timeout_s=None, background=True,
        )
        _say("worker DSH is starting")
        endpoint = runtime.endpoint(sandbox, WORKER_PORT)
        from dsh_rpc import token_from_log
        worker_token = None
        report = ""
        for attempt in range(90):
            try:
                worker_token = token_from_log(
                    runtime.read(sandbox, f"{WORKER_HOME}/boot.log").decode("utf-8", "replace"))
            except Exception:
                worker_token = None
            if worker_token:
                break
            if attempt in {8, 25, 50}:
                report = _worker_boot_report(runtime, sandbox)
                worker_token = token_from_log(report)
                if worker_token:
                    break
                running = "dsh web" in report.split("---proc---", 1)[-1]
                if not running:
                    raise LaunchError("worker DSH exited before printing a token: " + _redact(report))
                _say("worker still starting")
            time.sleep(1)
        if not worker_token:
            if not report:
                report = _worker_boot_report(runtime, sandbox)
            raise LaunchError("worker boot log has no host token: " + _redact(report))
        worker_rpc = _wait_rpc(
            _http_base(endpoint), dialect="slash", token=worker_token, attempts=40, send_origin=False,
        )
        created = worker_rpc.create_workspace("/workspace")
        workspace_id = created["workspace"]["workspaceId"]
        session = worker_rpc.create_session(workspace_id)
        session_id = session["sessionId"]
        prompt = baseline["initialPrompt"]
        worker_rpc.command(session_id, f"/task new {prompt}", timeout=60)
        task = None
        jobs: list = []
        for _ in range(30):
            log_path = _find_session_log(runtime, sandbox, session_id)
            if log_path is not None:
                task, jobs = read_task_log(runtime.read(sandbox, log_path).decode("utf-8", "replace"))
                if task is not None:
                    break
            time.sleep(1)
        observation = observation_from_task(task, jobs)
        decision = decide(observation)
        issued = command_for(decision.action)
        if issued is not None:
            worker_rpc.command(session_id, issued, timeout=60)
        runtime.detach(sandbox)
        return {
            "kind": "opensandbox-launch",
            "snapshotId": snapshot_id,
            "sandboxId": sandbox.id,
            "egress": "allow",
            "node": node_version,
            "dsh": DSH_VERSION,
            "plugin": PLUGIN_PACKAGE,
            "workspaceWrite": bwrap,
            "proxyStatus": proxy_status,
            "workerEndpoint": endpoint,
            "workerSessionId": session_id,
            "supervisorHome": str(supervisor_home),
            "supervisorPort": supervisor_port,
            "supervisorPid": supervisor.pid,
            "phase": observation.phase,
            "decision": decision.as_dict(),
            "issued": issued,
        }
    except Exception:
        _stop(supervisor)
        runtime.destroy(sandbox)
        shutil.rmtree(supervisor_home, ignore_errors=True)
        raise


def load_case_prompt(dataset: Path, case_id: str) -> str:
    payload = json.loads(dataset.read_text())
    for case in payload["cases"]:
        if case["id"] == case_id:
            prompt = case["initialPrompt"]
            if "\n" in prompt:
                raise LaunchError("initial prompt must be one line for /task new")
            return prompt
    raise LaunchError(f"dataset has no case {case_id}")


def launch_from_receipts(*, runtime, baseline_path: Path, dataset: Path, credentials_path: Path,
                         model_patch_path: Path, supervisor_home: Path, out: Path) -> dict:
    if out.exists():
        raise LaunchError(f"refusing to overwrite {out}")
    baseline = json.loads(baseline_path.read_text())
    if baseline.get("kind") != "opensandbox-baseline":
        raise LaunchError("baseline receipt is not an opensandbox baseline")
    baseline["initialPrompt"] = load_case_prompt(dataset, baseline["case"])
    credentials = credentials_path.read_bytes()
    if not credentials:
        raise LaunchError("credentials file is empty")
    packed = _pack_plugin(Path("/tmp/sandbox-run-pack"))
    try:
        receipt = connect(
            runtime, baseline=baseline, credentials=credentials,
            model_patch=model_patch_path.read_text(), supervisor_home=supervisor_home,
            supervisor_port=_free_port(), plugin_tarball=packed,
        )
    finally:
        packed.unlink(missing_ok=True)
    out.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
    return receipt
