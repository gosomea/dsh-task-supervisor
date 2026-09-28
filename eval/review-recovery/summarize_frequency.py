#!/usr/bin/env python3
"""Read P2 artifacts without running models; preserve unknown outcomes and denominators."""
import argparse
from collections import Counter
import itertools
import json
from pathlib import Path
import random
import statistics


def cluster_interval(rates):
    if len(rates) < 2:
        return None
    rng = random.Random(20260928)
    samples = sorted(statistics.mean(rng.choices(rates, k=len(rates))) for _ in range(10000))
    return [samples[249], samples[9749]]


def summarize(root, protocol):
    results = [json.loads(p.read_text()) for p in sorted((root / "attempts").glob("*/result.json"))]
    keys = [(r["taskId"], r["repeat"], r["condition"]) for r in results]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate paired attempt identity")
    gates = json.loads((root / "controls.json").read_text())
    eligible = {g["taskId"] for g in gates if g["eligible"]}
    conditions = {}
    for c in protocol["conditions"]:
        rows = [r for r in results if r["condition"] == c["id"]]
        admitted = [r for r in rows if r.get("admitted")]
        known = [r for r in admitted if isinstance(r["primarySuccess"], bool)]
        successes = sum(r["primarySuccess"] is True for r in known)
        unknown = len(admitted) - len(known)
        measured_tokens, audit_rows, elapsed = [], [], []
        for r in admitted:
            folder = root / "attempts" / r["name"]
            evidence = folder / "native-evidence.json"
            if evidence.exists():
                tokens = json.loads(evidence.read_text()).get("allSessionTokens")
                if tokens:
                    measured_tokens.append(tokens)
            audit = folder / "review-audit.json"
            if audit.exists():
                audit_rows.append(json.loads(audit.read_text()))
            terminal = r.get("terminal", {})
            if terminal.get("status") == "time-limit":
                elapsed.append(terminal["limitSec"])
            elif terminal.get("elapsedSec") is not None:
                elapsed.append(terminal["elapsedSec"])
        per_task = {}
        for task in protocol["tasks"]:
            task_rows = [r for r in known if r["taskId"] == task["id"]]
            per_task[task["id"]] = {"known": len(task_rows), "successes": sum(r["primarySuccess"] for r in task_rows)}
        full_rates = [row["successes"] / row["known"] for task_id, row in per_task.items()
                      if task_id in eligible and row["known"] == protocol["repeats"]]
        complete = all(per_task[t]["known"] == protocol["repeats"] for t in eligible) and bool(eligible)
        tokens = ({k: sum(row[k] for row in measured_tokens) for k in measured_tokens[0]}
                  if measured_tokens else None)
        conditions[c["id"]] = {
            "planned": len(protocol["tasks"]) * protocol["repeats"],
            "eligibleSlots": len(eligible) * protocol["repeats"],
            "finishedRecords": len(rows), "admitted": len(admitted), "knownPrimary": len(known),
            "unknownPrimary": unknown, "successes": successes, "knownFailures": len(known) - successes,
            "statusCounts": dict(Counter(r["status"] for r in rows)),
            "primarySuccessRate": successes / len(admitted) if admitted and not unknown else None,
            "admittedSuccessRateBounds": [successes / len(admitted), (successes + unknown) / len(admitted)] if admitted else None,
            "perTask": per_task,
            "exploratoryTaskClusterBootstrap95": cluster_interval(full_rates) if complete else None,
            "medianElapsedAllMeasuredSec": statistics.median(elapsed) if elapsed else None,
            "elapsedMeasuredRuns": len(elapsed), "allSessionTokenSumMeasured": tokens,
            "tokenMeasuredRuns": len(measured_tokens), "tokenMissingRuns": len(admitted) - len(measured_tokens),
            "reviewAuditMeasuredRuns": len(audit_rows),
            "reviewCounts": {k: sum(a.get(k, 0) for a in audit_rows) for k in ["jobs", "protocolMissingJobs", "repairTurns", "jobsRecoveredAfterRepair", "jobsExhaustedAfterRepair", "faultPauseJobs", "effectiveNeedsUserJobs"]},
            "reviewWaitMsMeasured": sum(a["reviewWaitMs"] for a in audit_rows if a.get("reviewWaitMs") is not None)
                if any(a.get("reviewWaitMs") is not None for a in audit_rows) else None,
            "unfinishedOrUnmeasuredReviewWindows": sum(a.get("unmeasuredOrUnfinishedWindows", 0) for a in audit_rows),
            "falsePauseRate": None, "correctionBenefit": None,
        }
    paired = []
    table = {(r["taskId"], r["repeat"], r["condition"]): r for r in results}
    for left, right in itertools.combinations(conditions, 2):
        counts = Counter()
        differences = []
        for task in eligible:
            for repeat in range(1, protocol["repeats"] + 1):
                a, b = table.get((task, repeat, left)), table.get((task, repeat, right))
                if not a or not b or not isinstance(a["primarySuccess"], bool) or not isinstance(b["primarySuccess"], bool):
                    counts["unavailable"] += 1
                    continue
                delta = int(a["primarySuccess"]) - int(b["primarySuccess"])
                counts["leftWin" if delta > 0 else "rightWin" if delta < 0 else "tie"] += 1
                differences.append(delta)
        paired.append({"left": left, "right": right, **dict(counts),
                       "knownPairs": len(differences), "meanSuccessDifferenceKnownPairs": statistics.mean(differences) if differences else None})
    return {"schemaVersion": 1, "kind": "p2-paired-summary", "planned": protocol["plannedAttempts"],
            "finishedRecords": len(results), "eligibleTasks": len(eligible), "conditions": conditions, "paired": paired,
            "limitations": ["Four repositories with three repeats are correlated; exploratory cluster bootstrap is not proof of superiority.",
                            "Missing blind annotations leave false pauses, missed drift and correction benefit unknown.",
                            "Report ineligible slots, infrastructure errors, admitted attempts and unscoreable completions separately."]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    protocol = json.loads(Path(__file__).with_name("frequency-p2-protocol.json").read_text())
    result = summarize(args.root, protocol)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"finished": result["finishedRecords"], "planned": result["planned"]}))


if __name__ == "__main__":
    main()
