#!/usr/bin/env python3
"""Launch the OpenSandbox evaluation framework.

probe and baseline talk to a running OpenSandbox service and deny egress.
decide applies the closed intervention rules to one observation and does not
start a sandbox. launch restores a baseline snapshot, starts the worker DSH
inside it, and starts a plugin-free supervising DSH on this machine.
"""

import argparse
import json
import os
import secrets
from pathlib import Path

from dsh_rpc import DshRpcError
from launch import LaunchError, launch_from_receipts
from opensandbox_runtime import SDK_VERSION, OpenSandboxRuntime
from policy import Observation, decide
from probe import prepare_baseline, probe_snapshot


def _write_receipt(path: Path, payload: dict) -> None:
    if path.exists():
        raise SystemExit(f"refusing to overwrite {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def _runtime(args: argparse.Namespace) -> OpenSandboxRuntime:
    domain = args.domain or os.environ.get("OPEN_SANDBOX_DOMAIN") or "localhost:8080"
    api_key = os.environ.get("OPEN_SANDBOX_API_KEY")
    return OpenSandboxRuntime(domain=domain, api_key=api_key, protocol=args.protocol,
                              use_server_proxy=not args.direct)


def _probe(args: argparse.Namespace) -> None:
    runtime = _runtime(args)
    try:
        receipt = probe_snapshot(runtime, image=args.image, marker=secrets.token_bytes(32),
                                 name=args.name, timeout_s=args.timeout)
    finally:
        runtime.close()
    receipt["sdk"] = SDK_VERSION
    _write_receipt(args.out, receipt)
    print(json.dumps({"snapshotId": receipt["snapshotId"], "out": str(args.out)}))


def _baseline(args: argparse.Namespace) -> None:
    runtime = _runtime(args)
    try:
        receipt = prepare_baseline(runtime, case=args.case, image=args.image,
                                   name=args.name, timeout_s=args.timeout)
    finally:
        runtime.close()
    receipt["sdk"] = SDK_VERSION
    _write_receipt(args.out, receipt)
    print(json.dumps({"snapshotId": receipt["snapshotId"], "case": args.case, "out": str(args.out)}))


def _launch(args: argparse.Namespace) -> None:
    runtime = _runtime(args)
    try:
        receipt = launch_from_receipts(
            runtime=runtime, baseline_path=args.baseline, dataset=args.dataset,
            credentials_path=args.credentials, model_patch_path=args.model_patch,
            supervisor_home=args.supervisor_home, out=args.out,
        )
    except (LaunchError, DshRpcError) as error:
        raise SystemExit(str(error)) from error
    finally:
        runtime.close()
    print(json.dumps({
        "sandboxId": receipt["sandboxId"], "phase": receipt["phase"],
        "decision": receipt["decision"]["action"], "out": str(args.out),
    }))


def _decide(args: argparse.Namespace) -> None:
    raw = json.loads(Path(args.observation).read_text() if args.observation != "-" else __import__("sys").stdin.read())
    observation = Observation(
        phase=raw.get("phase"),
        pause_reason=raw.get("pauseReason"),
        plan_review_passed=bool(raw.get("planReviewPassed")),
        review_fault_retryable=bool(raw.get("reviewFaultRetryable")),
        approvals=int(raw.get("approvals", 0)),
        recovery_resumes=int(raw.get("recoveryResumes", 0)),
        restart_resumes=int(raw.get("restartResumes", 0)),
        review_retries=int(raw.get("reviewRetries", 0)),
        sandbox_path=raw.get("sandboxPath"),
        workspace_root=raw.get("workspaceRoot", "/workspace"),
    )
    print(json.dumps(decide(observation).as_dict(), ensure_ascii=False))


def main() -> None:
    parser = argparse.ArgumentParser(description="OpenSandbox evaluation runner for dsh-task-supervisor")
    parser.add_argument("--domain", help="OpenSandbox host:port. Defaults to OPEN_SANDBOX_DOMAIN or localhost:8080")
    parser.add_argument("--protocol", default="http", choices=["http", "https"])
    parser.add_argument("--direct", action="store_true",
                        help="Reach sandbox endpoints directly. Omit this when the client cannot route to container IPs.")
    sub = parser.add_subparsers(dest="command", required=True)

    probe = sub.add_parser("probe", help="create, snapshot, restore, and destroy without a model")
    probe.add_argument("--image", required=True)
    probe.add_argument("--name", default="sandbox-run-probe")
    probe.add_argument("--timeout", type=float, default=120)
    probe.add_argument("--out", type=Path, required=True)
    probe.set_defaults(func=_probe)

    baseline = sub.add_parser("baseline", help="snapshot revision-and-evidence before any model runs")
    baseline.add_argument("--case", default="revision-and-evidence")
    baseline.add_argument("--image", required=True)
    baseline.add_argument("--name", default="revision-and-evidence-baseline")
    baseline.add_argument("--timeout", type=float, default=120)
    baseline.add_argument("--out", type=Path, required=True)
    baseline.set_defaults(func=_baseline)

    launch = sub.add_parser("launch", help="restore a baseline and connect the worker and supervising DSH")
    launch.add_argument("--baseline", type=Path, required=True)
    launch.add_argument("--dataset", type=Path,
                        default=Path(__file__).resolve().parents[1] / "long-horizon-dev-v1" / "dataset.json")
    launch.add_argument("--credentials", type=Path, default=Path.home() / ".dsh" / ".credentials.yaml")
    launch.add_argument("--model-patch", type=Path, default=Path.home() / ".dsh" / "profiles" / "web-rc2" / "cordis.patch.yml")
    launch.add_argument("--supervisor-home", type=Path, default=Path("/tmp/sandbox-run-supervisor"))
    launch.add_argument("--out", type=Path, required=True)
    launch.set_defaults(func=_launch)

    decision = sub.add_parser("decide", help="print the closed action for one observation JSON")
    decision.add_argument("--observation", default="-", help="path to observation JSON, or - for stdin")
    decision.set_defaults(func=_decide)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
