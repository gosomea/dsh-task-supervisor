#!/usr/bin/env python3
"""Start an isolated DSH Host inside a pre-pulled SWE-bench Pro task image."""

import argparse
import ipaddress
import os
import shutil
import subprocess
import time
from pathlib import Path


def docker(context: str, *args: str, capture: bool = False) -> str:
    command = ["docker", "--context", context, *args]
    if capture:
        return subprocess.check_output(command, text=True).strip()
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL)
    return ""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("arm", choices=("goal", "plan", "supervisor"))
    parser.add_argument("name")
    parser.add_argument("image", help="Pre-pulled linux/amd64 image tag or immutable digest")
    parser.add_argument("home", type=Path, help="New, nonexistent per-attempt DSH home")
    parser.add_argument("template_home", type=Path, help="Configured clean baseline or Supervisor profile")
    parser.add_argument("cache_root", type=Path, help="Frozen Linux DSH, plugin and Node 24 snapshots")
    parser.add_argument("--host-port", type=int, required=True)
    parser.add_argument("--browser-port", type=int, help="Host-local Web proxy, needed for native Plan approval")
    parser.add_argument("--docker-context", default="colima-dsh-eval-rosetta")
    parser.add_argument("--netctl-image", default="dsh-eval-netctl:1")
    parser.add_argument("--model-proxy-port", type=int, default=15721)
    args = parser.parse_args()
    if args.arm == "plan" and not args.browser_port:
        parser.error("Plan requires --browser-port for native review")
    if args.arm != "plan" and args.browser_port:
        parser.error("Only Plan uses the Web approval proxy")
    if args.home.exists():
        parser.error(f"Refusing to reuse attempt home: {args.home}")
    if not args.template_home.is_dir():
        parser.error("Template DSH home is missing")
    if args.host_port == args.browser_port:
        parser.error("Host and browser ports must differ")

    profile = "supervisor-eval" if args.arm == "supervisor" else "eval-baseline"
    source_profile = args.template_home / "profiles" / profile
    if not source_profile.is_dir():
        parser.error(f"Template profile is missing: {source_profile}")
    credentials = args.template_home / ".credentials.yaml"
    if not credentials.is_file():
        parser.error("Template credentials are missing")
    required = [args.cache_root / "node24-linux-amd64", args.cache_root / "dsh-source"]
    if args.arm == "supervisor":
        required.append(args.cache_root / "plugin-source")
    if any(not path.exists() for path in required):
        parser.error("Frozen runtime snapshot is missing")

    args.home.mkdir(parents=True)
    (args.home / "run").mkdir()
    shutil.copytree(source_profile, args.home / "profiles" / profile, symlinks=True)
    shutil.copy2(credentials, args.home / credentials.name)
    os.chmod(args.home / credentials.name, 0o600)
    log = args.home / "run/host.log"
    log.touch(mode=0o600)
    if args.arm == "plan":
        (args.home / "run/proxy.log").touch(mode=0o600)

    runner = Path(__file__).resolve().parent
    command = [
        "run", "-d", "--name", args.name, "--platform", "linux/amd64",
        "--cpus", "1", "--memory", "4g", "--workdir", "/dsh", "-e", "DSH_HOME=/evalhome",
        "-v", f"{runner}:/runner:ro",
        "-v", f"{args.cache_root / 'node24-linux-amd64'}:/eval/node24:ro",
        "-v", f"{args.cache_root / 'dsh-source'}:/dsh:ro",
        "-v", f"{args.home}:/evalhome",
    ]
    if args.arm == "supervisor":
        command += ["-v", f"{args.cache_root / 'plugin-source'}:/plugin:ro"]
    if args.browser_port:
        command += ["-p", f"127.0.0.1:{args.browser_port}:{args.browser_port}"]
    host_command = (
        f"exec /eval/node24 --import tsx/esm /dsh/apps/cli/src/bin.ts "
        f"--profile {profile} --no-open --host 127.0.0.1 "
    )
    if args.browser_port:
        proxy = (
            f"/eval/node24 /runner/tcp_proxy.mjs {args.browser_port} {args.host_port} "
            "> /evalhome/run/proxy.log 2>&1 & "
        )
        host_command = proxy + host_command + f"--trusted-host 127.0.0.1:{args.browser_port} "
    host_command += f"--port {args.host_port} >> /evalhome/run/host.log 2>&1"
    command += ["--entrypoint", "bash", args.image, "-lc", host_command]
    docker(args.docker_context, *command)

    # The Agent has not received a task yet. Seal this fresh network namespace
    # before creating its Session; keep only the model gateway reachable.
    gateway = docker(args.docker_context, "exec", args.name, "getent", "ahostsv4", "host.docker.internal", capture=True)
    gateway_ip = str(ipaddress.IPv4Address(gateway.split()[0]))
    subprocess.run(
        ["docker", "--context", args.docker_context, "exec", "-i", args.name, "tee", "-a", "/etc/hosts"],
        input=f"{gateway_ip} host.docker.internal\n", text=True, check=True, stdout=subprocess.DEVNULL,
    )
    rules = (
        "iptables -A OUTPUT -o lo -j ACCEPT; "
        "iptables -A OUTPUT -m conntrack --ctstate RELATED,ESTABLISHED -j ACCEPT; "
        f"iptables -A OUTPUT -d {gateway_ip}/32 -p tcp --dport {args.model_proxy_port} -j ACCEPT; "
        "iptables -P OUTPUT DROP"
    )
    docker(args.docker_context, "run", "--rm", "--platform", "linux/amd64",
           "--network", f"container:{args.name}", "--cap-add", "NET_ADMIN",
           args.netctl_image, "/bin/sh", "-ec", rules)
    for _ in range(90):
        if "?token=" in log.read_text():
            break
        running = docker(args.docker_context, "inspect", args.name,
                         "--format", "{{.State.Running}}", capture=True)
        if running != "true":
            raise RuntimeError(f"DSH Host exited during startup; inspect {log} privately")
        time.sleep(1)
    else:
        raise TimeoutError(f"DSH Host did not publish a startup URL; inspect {log} privately")
    print(f"Ready: {args.name}, profile={profile}, home={args.home}, gateway={gateway_ip}")


if __name__ == "__main__":
    main()
