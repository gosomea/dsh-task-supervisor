#!/usr/bin/env python3
"""Run the frozen P2 controls and paired attempts with durable, private artifacts."""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import tomllib

CONTEXT = "colima-dsh-eval-rosetta"
SCRIPTS = Path(__file__).resolve().parents[1] / "swebench-pro-v2"
sys.path.insert(0, str(SCRIPTS))
from sanity import read_trial


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")
    tmp.replace(path)


def announce(event, **data):
    print(json.dumps({"time": int(time.time()), "event": event, **data}), flush=True)


def run(command, log, timeout=None, env=None, check=True):
    log.parent.mkdir(parents=True, exist_ok=True)
    with log.open("a") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT,
                                timeout=timeout, env=env)
    if check and result.returncode:
        raise RuntimeError(f"Command exited {result.returncode}; private log: {log}")
    return result.returncode


def paired_order(protocol):
    rows = []
    for task in protocol["tasks"]:
        for repeat in range(1, protocol["repeats"] + 1):
            group = []
            for condition in protocol["conditions"]:
                rank = hashlib.sha256(f"{protocol['orderSeed']}/{task['id']}/{repeat}/{condition['id']}".encode()).hexdigest()
                group.append({"taskId": task["id"], "repeat": repeat, "condition": condition["id"],
                              "arm": condition["arm"], "rank": rank})
            rows.extend(sorted(group, key=lambda item: item["rank"]))
    return rows


def grade(task, job, root, agent, logs, env):
    if not job.exists():
        try:
            run(["harbor", "run", "-p", str(task), "-a", agent, "-n", "1",
                 "--job-name", job.name, "--jobs-dir", str(job.parent)], logs, timeout=4000, env=env, check=False)
        except subprocess.TimeoutExpired:
            return {"job": str(job), "reward": None, "infrastructureError": "Harbor runner timeout"}
    try:
        score, error = read_trial(job)
        raw = json.loads((job / "result.json").read_text())
        if raw.get("stats", {}).get("n_errored_trials", 0):
            score, error = None, "Harbor reports errored trials"
    except (OSError, ValueError, KeyError) as exc:
        score, error = None, str(exc)
    return {"job": str(job), "reward": score, "infrastructureError": error}


def controls(args, protocol, env):
    result = []
    for index, task in enumerate(protocol["tasks"], 1):
        official = args.dataset / "v2/tasks" / task["id"]
        assert hashlib.sha256((official / "instruction.md").read_bytes()).hexdigest() == task["instructionSha256"]
        image = tomllib.loads((official / "task.toml").read_text())["environment"]["docker_image"]
        evidence = args.root / "controls" / f"t{index}.json"
        if evidence.exists():
            record = json.loads(evidence.read_text())
            assert record["taskId"] == task["id"]
            result.append(record)
            continue
        announce("control-start", taskId=task["id"])
        run(["docker", "--context", CONTEXT, "pull", "--platform", "linux/amd64", image],
            args.root / "controls" / f"t{index}-pull.log", timeout=1800)
        inspected = json.loads(subprocess.check_output(["docker", "--context", CONTEXT, "image", "inspect", image], text=True))[0]
        assert inspected["Architecture"] == "amd64"
        digest = inspected["RepoDigests"][0]
        trials = {}
        for agent in ("nop", "oracle"):
            job = args.root / "harbor-jobs" / f"p2-control-t{index}-{agent}"
            row = grade(official, job, args.root, agent, args.root / "controls" / f"t{index}-{agent}.log", env)
            trials[agent] = row
            announce("control-result", taskId=task["id"], agent=agent, reward=row["reward"], error=row["infrastructureError"])
        eligible = (trials["nop"]["reward"] == 0 and trials["oracle"]["reward"] == 1
                    and all(row["infrastructureError"] is None for row in trials.values()))
        record = {"taskId": task["id"], "instructionSha256": task["instructionSha256"],
                  "image": digest, "imageId": inspected["Id"], "eligible": eligible, "controls": trials}
        save(evidence, record)
        result.append(record)
    save(args.root / "controls.json", result)
    return result


def docker(*parts):
    return ["docker", "--context", CONTEXT, *parts]


def parse_monitor(path):
    rows = []
    for line in path.read_text().splitlines():
        try:
            row = json.loads(line)
            if "status" in row:
                rows.append(row)
        except ValueError:
            pass
    return rows[-1] if rows else {"status": "monitor-error"}


def primary_success(completed, grade):
    if not completed:
        return False
    if grade["infrastructureError"] is not None:
        return None
    return grade["reward"] == 1


def native_evidence(home, state, output):
    """All per-attempt Sessions are isolated; retain raw logs privately, export safe metrics."""
    sessions, tokens, model_requests = [], {}, []
    token_fields = ("uncachedInputTokens", "cacheReadTokens", "outputTokens", "cacheWriteTokens")
    main_events = None
    logs = {}
    for log in (home / "sessions").glob("**/session.v*.jsonl.zstd"):
        generation = int(log.name.split(".v")[1].split(".")[0])
        if log.parent not in logs or generation > logs[log.parent][0]:
            logs[log.parent] = (generation, log)
    for _, log in sorted(logs.values(), key=lambda row: str(row[1])):
        text = subprocess.check_output(["zstd", "-d", "-c", str(log)], text=True)
        events = [json.loads(line) for line in text.splitlines() if line.strip()]
        sid = log.parent.name
        if sid == state["sessionId"]:
            main_events = events
        projections = home / "storages/session_projcache/sessions" / f"{sid}.json"
        rows = json.loads(projections.read_text())["record"]["rows"] if projections.exists() else {}
        usage = rows.get("tokenUsage", {}).get("val", {}).get("totals")
        sessions.append({"sessionId": sid, "logSha256": hashlib.sha256(log.read_bytes()).hexdigest(), "tokens": usage})
        for e in events:
            if e["type"] == "request/header":
                # Export only model selection; never the request body, keys or provider config.
                selected = e["data"]["header"]["config"]
                model_requests.append({"sessionId": sid, "seq": e["seq"], "model": {
                    k: selected[k] for k in ("provider", "model") if k in selected}})
    if sessions and all(isinstance(s["tokens"], dict) and all(k in s["tokens"] for k in token_fields) for s in sessions):
        tokens = {k: sum(s["tokens"][k] for s in sessions) for k in token_fields}
    else:
        tokens = None
    if main_events is not None and state["arm"] == "supervisor":
        from summary import summarize
        save(output / "review-audit.json", summarize(main_events))
    save(output / "native-evidence.json", {"sessions": sessions, "allSessionTokens": tokens, "modelRequests": model_requests})
    expected = {"provider": "deepseek-codebuddy", "model": "deepseek-v4.1-flash"}
    if not model_requests or any(row["model"] != expected for row in model_requests):
        raise RuntimeError("Actual request model parity failed; retain raw evidence and exclude from protocol comparison")


def attempt(args, protocol, row, gate, env):
    index = protocol["tasks"].index(next(t for t in protocol["tasks"] if t["id"] == row["taskId"])) + 1
    name = f"p2-t{index}-r{row['repeat']}-{row['condition']}"
    out = args.root / "attempts" / name
    result_path = out / "result.json"
    if result_path.exists():
        return json.loads(result_path.read_text())
    out.mkdir(parents=True, exist_ok=True)
    if not gate["eligible"]:
        result = {**row, "status": "ineligible", "primarySuccess": None, "reason": "control-gate", "controls": gate}
        save(result_path, result)
        return result
    # An interrupted attempt must be reconciled; never silently run a second Agent.
    if (out / "started.json").exists():
        raise RuntimeError(f"Unfinished attempt requires reconciliation, not replay: {out}")
    save(out / "started.json", {**row, "startedAt": int(time.time())})
    announce("attempt-start", name=name, **row)
    home = args.root / "homes" / name
    state_path, receipt = home / "state.json", home / "approval.json"
    arm = row["arm"]
    template = args.root / "templates" / row["condition"]
    official = args.dataset / "v2/tasks" / row["taskId"]
    host_port, browser_port = 42190, 42191
    approval = None
    admitted = False
    result = None
    try:
        launch = [sys.executable, str(SCRIPTS / "launch_container.py"), arm, name, gate["image"], str(home),
                  str(template), str(args.root / "runtime"), "--host-port", str(host_port)]
        if arm == "plan":
            launch += ["--browser-port", str(browser_port)]
        run(launch, out / "launch.log", timeout=180)
        if args.registry:
            release = json.loads((args.root / "release.json").read_text())
            run([sys.executable, str(args.registry), "register", name, "--project", release["project"],
                 "--home", str(home), "--source", str(args.root / "runtime/dsh-source"),
                 "--plugin", str(args.root / "runtime/plugin-source"),
                 "--profile", "supervisor-eval" if arm == "supervisor" else "eval-baseline",
                 "--purpose", f"P2 paired public benchmark {row['condition']} repeat {row['repeat']}",
                 "--reason", "Frozen protocol requires a fresh official-image container and Home for each attempt",
                 "--log", str(home / "run/host.log"), "--state", "active",
                 "--note", f"Docker {CONTEXT} container {name}; immutable release {release['pluginCommit']}"], out / "registry.log")
        run(docker("cp", str(official / "instruction.md"), f"{name}:/runner-instruction.md"), out / "start.log", timeout=60)
        run(docker("exec", name, "python3", "/runner/start_arm.py", arm, row["taskId"],
                   f"/runner-instruction.md", "/evalhome/state.json", "--port", str(host_port)), out / "start.log", timeout=180)
        state = json.loads(state_path.read_text())
        admitted = True
        if arm == "supervisor":
            command = docker("exec", name, "python3", "/runner/approve_supervisor.py", "/evalhome/state.json",
                             "/evalhome/approval.json", "--port", str(host_port))
        elif arm == "plan":
            command = [args.node, str(SCRIPTS / "approve_plan.mjs"), str(home / "run/host.log"), str(browser_port),
                       f"Eval plan {row['taskId'].split('__')[-1][:12]}", str(receipt)]
        else:
            command = None
        if command:
            approval_file = (out / "approval.log").open("a")
            approval = subprocess.Popen(command, stdout=approval_file, stderr=subprocess.STDOUT, env=env)
            approval_file.close()
        monitor = [sys.executable, str(SCRIPTS / "wait_arm.py"), str(state_path), str(home), name]
        if arm != "goal":
            monitor += ["--approval-receipt", str(receipt)]
        run(monitor, out / "monitor.log", timeout=protocol["timeLimitSec"] + 90, check=False)
        terminal = parse_monitor(out / "monitor.log")
        patch = home / "run/agent.patch"
        if terminal["status"] == "time-limit":
            timeout_patch = home / "run/state-timeout.patch"
            if not timeout_patch.exists():
                raise RuntimeError("No cutoff patch captured; retain attempt as failed with infrastructure diagnostic")
            patch.write_bytes(timeout_patch.read_bytes())
        else:
            run(docker("exec", name, "python3", "/runner/extract_patch.py", "/evalhome/state.json",
                       "/evalhome/run/agent.patch"), out / "patch.log", timeout=90)
        try:
            run(docker("stop", name), out / "stop.log", timeout=60, check=False)
        except subprocess.TimeoutExpired:
            run(docker("kill", name), out / "stop.log", timeout=30, check=False)
        staged = args.root / "staged" / name
        run([sys.executable, str(SCRIPTS / "prepare_grade.py"), str(official), str(patch), str(staged)], out / "stage.log")
        graded = grade(staged, args.root / "harbor-jobs" / f"{name}-grade", args.root, "oracle", out / "grade.log", env)
        projection = home / "storages/session_projcache/sessions" / f"{state['sessionId']}.json"
        rows = json.loads(projection.read_text())["record"]["rows"]
        native_phase = (rows.get("taskSupervisor", {}).get("val", {}).get("current") or {}).get("phase") if arm == "supervisor" else None
        if arm == "goal":
            native_phase = ((rows.get("goal", {}).get("val", {}).get("current") or {}).get("goal") or {}).get("phase")
        on_time = terminal["status"] == "finished" and terminal.get("elapsedSec", protocol["timeLimitSec"] + 1) <= protocol["timeLimitSec"]
        completed = on_time and (arm == "plan" or native_phase == "complete")
        result = {**row, "name": name, "status": "scored" if graded["infrastructureError"] is None else "grading-infrastructure-error",
                  "admitted": True, "terminal": terminal, "nativePhase": native_phase, "home": str(home),
                  "sessionId": state["sessionId"], "approval": json.loads(receipt.read_text()) if receipt.exists() else None,
                  "grade": graded, "primarySuccess": primary_success(completed, graded),
                  "patchSha256": hashlib.sha256(patch.read_bytes()).hexdigest(), "patchBytes": patch.stat().st_size,
                  "mainSessionStats": rows.get("sessionStats", {}).get("val"),
                  "responseLanguage": "en", "falsePauseRate": None, "correctionBenefit": None}
        native_evidence(home, state, out)
    except Exception as exc:
        admitted = admitted or state_path.exists()
        result = {**(result or row), "name": name, "status": "attempt-error", "admitted": admitted,
                  "primarySuccess": False if admitted else None, "error": str(exc), "home": str(home)}
        announce("attempt-error", name=name, admitted=admitted, error=str(exc))
    finally:
        if approval is not None and approval.poll() is None:
            approval.terminate()
            try:
                approval.wait(timeout=10)
            except subprocess.TimeoutExpired:
                approval.kill()
                approval.wait()
        try:
            run(docker("stop", name), out / "stop.log", timeout=60, check=False)
        except subprocess.TimeoutExpired:
            run(docker("kill", name), out / "stop.log", timeout=30, check=False)
    save(result_path, result)
    if args.registry and home.exists():
        run([sys.executable, str(args.registry), "update", name, "--state", "retained",
             "--note", f"Container stopped; {result['status']}; primarySuccess={result['primarySuccess']}. Artifacts: {out}"],
            out / "registry.log", check=False)
    announce("attempt-end", name=name, status=result["status"], primarySuccess=result["primarySuccess"])
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("phase", choices=("controls", "attempts"))
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--dataset", type=Path, required=True)
    parser.add_argument("--protocol", type=Path, default=Path(__file__).with_name("frequency-p2-protocol.json"))
    parser.add_argument("--node", default="/opt/homebrew/opt/node@24/bin/node")
    parser.add_argument("--registry", type=Path, help="Optional isolated-test skill inventory script")
    args = parser.parse_args()
    args.root = args.root.resolve()
    args.dataset = args.dataset.resolve()
    protocol = json.loads(args.protocol.read_text())
    args.root.mkdir(parents=True, exist_ok=True)
    # A second process may inspect the inventory, but may not launch overlapping runs.
    lock = (args.root / "batch.lock").open("a")
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    env = os.environ.copy()
    env["DOCKER_CONTEXT"] = CONTEXT
    env.pop("DOCKER_DEFAULT_PLATFORM", None)
    if args.phase == "controls":
        controls(args, protocol, env)
        return
    release = json.loads((args.root / "release.json").read_text())
    assert release["protocolSha256"] == hashlib.sha256(args.protocol.read_bytes()).hexdigest()
    if not env.get("PLAYWRIGHT_ENTRY") or not env.get("CHROME_PATH"):
        raise RuntimeError("Plan approval requires PLAYWRIGHT_ENTRY and CHROME_PATH before any model attempt")
    gates = {row["taskId"]: row for row in json.loads((args.root / "controls.json").read_text())}
    order = paired_order(protocol)
    assert len(order) == protocol["plannedAttempts"]
    save(args.root / "order.json", order)
    results = []
    for row in order:
        results.append(attempt(args, protocol, row, gates[row["taskId"]], env))
        save(args.root / "results.json", results)
    announce("batch-end", planned=len(order), scoreable=sum(r["status"] == "scored" for r in results),
             successes=sum(r["primarySuccess"] is True for r in results))


if __name__ == "__main__":
    main()
