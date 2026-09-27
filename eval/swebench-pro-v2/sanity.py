#!/usr/bin/env python3
"""Gate public tasks on Harbor's empty-patch and reference-solution controls."""

import argparse
import json
from pathlib import Path


def read_trial(job_dir: Path) -> tuple[float | None, str | None]:
    result = json.loads((job_dir / "result.json").read_text())
    trials = list(job_dir.glob("*/result.json"))
    if result["n_total_trials"] != 1 or len(trials) != 1:
        raise ValueError(f"Expected one trial in {job_dir}")
    trial = json.loads(trials[0].read_text())
    error = trial.get("exception_info")
    if error:
        return None, f"{error['exception_type']}: {error['exception_message']}"
    verifier = trial.get("verifier_result")
    if verifier is None:
        return None, "verifier result missing"
    reward = verifier.get("rewards", {}).get("reward")
    if reward not in (0, 0.0, 1, 1.0):
        return None, f"unexpected reward: {reward!r}"
    return float(reward), None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nop", type=Path, required=True)
    parser.add_argument("--oracle", type=Path, required=True)
    args = parser.parse_args()
    scores = {name: read_trial(path) for name, path in (("nop", args.nop), ("oracle", args.oracle))}
    eligible = scores["nop"] == (0.0, None) and scores["oracle"] == (1.0, None)
    print(json.dumps({"eligible": eligible, "controls": {
        name: {"reward": score, "infrastructureError": error}
        for name, (score, error) in scores.items()
    }}, ensure_ascii=False, indent=2))
    return 0 if eligible else 1


if __name__ == "__main__":
    raise SystemExit(main())
