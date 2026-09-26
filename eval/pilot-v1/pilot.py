#!/usr/bin/env python3
"""Prepare isolated public fixtures and score their artifacts outside the Agent workspace."""

import argparse
import csv
import hashlib
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATASET = json.loads((ROOT / "dataset.json").read_text())
CASES = {case["id"]: case for case in DATASET["cases"]}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def prepare(case_id: str, target: Path) -> None:
    if target.exists():
        raise SystemExit(f"target already exists: {target}")
    shutil.copytree(ROOT / "fixtures" / case_id, target)
    print(json.dumps({"case": case_id, "workspace": str(target), "prompt": CASES[case_id]["prompt"]}))


def check_ledger(workspace: Path) -> dict:
    source = ROOT / "fixtures/ledger-rollup/input.csv"
    assert sha256(workspace / "input.csv") == sha256(source), "input.csv changed"
    program = workspace / "rollup.mjs"
    assert program.is_file(), "rollup.mjs missing"
    first = subprocess.run(["node", str(program)], cwd=workspace, text=True, capture_output=True, timeout=30)
    assert first.returncode == 0, f"first CLI run failed: {first.stderr[:500]}"
    report = workspace / "report.json"
    assert report.is_file(), "report.json missing"
    first_bytes = report.read_bytes()
    second = subprocess.run(["node", str(program)], cwd=workspace, text=True, capture_output=True, timeout=30)
    assert second.returncode == 0, f"second CLI run failed: {second.stderr[:500]}"
    assert report.read_bytes() == first_bytes, "second run changed report bytes"
    rows = list(csv.DictReader(source.open(newline="")))
    active = [row for row in rows if row["status"] != "void"]
    totals = {}
    for row in active:
        sku = row["sku"]
        totals[sku] = totals.get(sku, 0) + int(row["quantity"])
    actual = json.loads(first_bytes)
    expected = {"activeRows": len(active), "grandTotal": sum(totals.values()), "bySku": dict(sorted(totals.items()))}
    assert actual == expected, f"report differs: actual={actual!r}, expected={expected!r}"
    assert list(actual["bySku"]) == sorted(totals), "bySku keys are not lexicographically ordered"
    return {"passed": True, "expected": expected, "reportSha256": hashlib.sha256(first_bytes).hexdigest()}


PRIVATE_SPEC_TEST = r"""
import { strict as assert } from 'node:assert'
import { pathToFileURL } from 'node:url'
const { parseSpec } = await import(pathToFileURL(process.argv[1]).href)
assert.deepEqual(parseSpec('name=alpha\\,beta,count=3'), {name:'alpha,beta', count:'3'})
assert.deepEqual(parseSpec('x\\=y=left\\=right'), {'x=y':'left=right'})
assert.deepEqual(parseSpec(' a = 1 , a = 2 ,, b=ok '), {a:'2', b:'ok'})
assert.deepEqual(parseSpec('path=C:\\\\tmp'), {path:'C:\\tmp'})
assert.throws(() => parseSpec(null), TypeError)
assert.throws(() => parseSpec('missing'))
assert.throws(() => parseSpec('=value'))
"""


def check_parser(workspace: Path) -> dict:
    source = ROOT / "fixtures/spec-parser/public.test.mjs"
    assert sha256(workspace / "public.test.mjs") == sha256(source), "public.test.mjs changed"
    public = subprocess.run(["node", "public.test.mjs"], cwd=workspace, text=True, capture_output=True, timeout=30)
    assert public.returncode == 0, f"public tests failed: {public.stderr[:500]}"
    private = subprocess.run(["node", "--input-type=module", "-e", PRIVATE_SPEC_TEST,
                              str(workspace / "parse.mjs")], cwd=workspace, text=True, capture_output=True, timeout=30)
    assert private.returncode == 0, f"private checks failed: {private.stderr[:500]}"
    cli = subprocess.run(["node", "cli.mjs", r"name=alpha\,beta,count=3"],
                         cwd=workspace, text=True, capture_output=True, timeout=30)
    assert cli.returncode == 0, f"CLI failed: {cli.stderr[:500]}"
    assert json.loads(cli.stdout) == {"name": "alpha,beta", "count": "3"}, "CLI output differs"
    return {"passed": True, "parserSha256": sha256(workspace / "parse.mjs")}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["prepare", "check", "prompt"])
    parser.add_argument("case", choices=CASES)
    parser.add_argument("workspace", nargs="?", type=Path)
    args = parser.parse_args()
    if args.action == "prompt":
        print(CASES[args.case]["prompt"])
        return
    if args.workspace is None:
        parser.error("workspace is required")
    if args.action == "prepare":
        prepare(args.case, args.workspace)
        return
    try:
        result = check_ledger(args.workspace) if args.case == "ledger-rollup" else check_parser(args.workspace)
    except (AssertionError, OSError, subprocess.TimeoutExpired) as error:
        result = {"passed": False, "error": str(error)}
    print(json.dumps({"case": args.case, "workspace": str(args.workspace), **result}, ensure_ascii=False))
    raise SystemExit(0 if result["passed"] else 1)


if __name__ == "__main__":
    main()
