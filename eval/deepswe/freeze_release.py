#!/usr/bin/env python3
"""Bind private runtime bytes and actual gate evidence to an unadmitted release candidate."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess

from select_sample import require_admission, sample_sha256

GATE_CHECKS = {
    'model-route-gate': ('mainSuccessfulRequest', 'reviewerSuccessfulRequest', 'dailyEffectiveRouteMatched',
                         'supervisorBothModes', 'actualHttpEndpointMatched', 'durableLineageMatched',
                         'independentReviewerCheckExecuted'),
    'control-flow-gate': ('singleController', 'initialApprovalOnce', 'deadlineEnforced',
                         'noRescueAfterPause', 'exclusiveSeal'),
    'grading-gate': ('committedPatchOnly', 'officialMaterialsUnchanged', 'separateVerifierObserved',
                     'dirtyExcluded', 'cleanupConfirmed'),
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def hash_file(path):
    h = hashlib.sha256()
    with path.open('rb') as data:
        for block in iter(lambda: data.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def fingerprint(root, exclusions=()):
    """Record loaded files and literal symlinks; credentials are explicit exclusions."""
    root = Path(root)
    if root.is_symlink():
        raise ValueError('Frozen root must use its resolved real path, not a symlink')
    if not root.exists():
        raise ValueError('Frozen runtime input is missing')
    exclusions = tuple(exclusions)
    def excluded(rel):
        return rel.parts[0] == '.git' or any(rel == Path(x) or Path(x) in rel.parents for x in exclusions)
    rows = []
    if root.is_file() and not root.is_symlink():
        info = root.stat()
        rows.append({'path': '.', 'type': 'file', 'bytes': info.st_size,
                     'mode': stat.S_IMODE(info.st_mode), 'sha256': hash_file(root)})
    for directory, dirs, files in os.walk(root, followlinks=False):
        here = Path(directory)
        dirs[:] = sorted(d for d in dirs if not excluded((here / d).relative_to(root)))
        for name in sorted(set(dirs + files)):
            path = here / name
            rel = path.relative_to(root)
            if excluded(rel):
                continue
            if path.name in ('.credentials.yaml', '.credentials.json', '.env'):
                raise ValueError('Credential input must be explicitly excluded: ' + str(rel))
            info = path.lstat()
            if stat.S_ISLNK(info.st_mode):
                rows.append({'path': str(rel), 'type': 'symlink', 'target': os.readlink(path)})
            elif stat.S_ISREG(info.st_mode):
                rows.append({'path': str(rel), 'type': 'file', 'bytes': info.st_size,
                             'mode': stat.S_IMODE(info.st_mode), 'sha256': hash_file(path)})
            elif stat.S_ISDIR(info.st_mode):
                rows.append({'path': str(rel), 'type': 'directory', 'mode': stat.S_IMODE(info.st_mode)})
            else:
                raise ValueError('Unsupported runtime entry: ' + str(rel))
    rows.sort(key=lambda row: row['path'])
    return {'sha256': hashlib.sha256(canonical(rows)).hexdigest(), 'entries': rows,
            'exclusions': ['.git', *exclusions]}


def validate_links(root, record, roots, guest_mapping):
    """Resolve every dependency symlink against frozen host roots or guest mappings."""
    allowed = [Path(value).resolve() for value in roots.values()]
    for row in record['entries']:
        if row['type'] != 'symlink':
            continue
        target = Path(row['target'])
        if target.is_absolute():
            mapped = next((Path(host) / target.relative_to(guest) for guest, host in guest_mapping.items()
                           if target == Path(guest) or Path(guest) in target.parents), None)
            actual = mapped if mapped is not None else target
        else:
            parent = Path(root).parent if row['path'] == '.' else Path(root) / Path(row['path']).parent
            actual = parent / target
        try:
            actual = actual.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise ValueError('Unresolved frozen dependency: ' + row['path']) from error
        if not any(actual == base or base in actual.parents for base in allowed):
            raise ValueError('Dependency is outside frozen roots: ' + row['path'])


def validate_gate(gate_path, evidence_root):
    """Verify successful check fields and the referenced bytes, without inventing evidence."""
    gate_path, evidence_root = Path(gate_path), Path(evidence_root).resolve()
    gate = json.loads(gate_path.read_text())
    checks = GATE_CHECKS.get(gate.get('kind'))
    if checks is None or gate.get('schemaVersion') != 1 or gate.get('passed') is not True:
        raise ValueError('Gate is not a successful known gate')
    if any(gate.get('checks', {}).get(key) is not True for key in checks):
        raise ValueError('Gate lacks a successful required check')
    evidence = gate.get('evidence')
    if not isinstance(evidence, list) or not evidence:
        raise ValueError('Actual gate evidence is required')
    verified = []
    for row in evidence:
        relative = Path(row['relativePath'])
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Evidence must remain inside its private root')
        path = (evidence_root / relative).resolve(strict=True)
        if evidence_root not in path.parents or hash_file(path) != row['sha256']:
            raise ValueError('Gate evidence bytes differ')
        verified.append({'relativePath': str(relative), 'sha256': row['sha256']})
    return {'kind': gate['kind'], 'sourceFile': str(gate_path.resolve()), 'sha256': hash_file(gate_path), 'checks': {k: True for k in checks},
            'evidence': verified}


def candidate(sample, roots, evidence_root, gate_paths, exclusions=None, guest_mapping=None):
    """Prepare hashes only; the parent must review semantics and perform final admission."""
    if sample.get('modelAdmitted') is not False or sample.get('release') is not None:
        raise ValueError('Candidate preparation requires the original unadmitted sample')
    exclusions, guest_mapping = exclusions or {}, guest_mapping or {}
    required = {'runner', 'runtime', 'plugin', 'profile', 'node', 'docker', 'pier', 'dataset'}
    if not required.issubset(roots):
        raise ValueError('Every executed runtime component must be frozen')
    records = {name: fingerprint(path, exclusions.get(name, ())) for name, path in roots.items()}
    for name, record in records.items():
        validate_links(roots[name], record, roots, guest_mapping)
    gates = [validate_gate(path, evidence_root) for path in gate_paths]
    present = {g['kind'] for g in gates}
    return {'schemaVersion': 1, 'kind': 'deepswe-release-candidate', 'modelAdmitted': False,
            'sampleSha256': sample_sha256(sample),
            'orderSha256': hashlib.sha256(canonical(sample['order'])).hexdigest(),
            'fingerprints': records, 'gates': gates,
            'missingGates': sorted(set(GATE_CHECKS) - present),
            'resources': {t['id']: {k: t[k] for k in ('mainCpus', 'mainMemoryMiB', 'storageMiB', 'agentTimeoutSec', 'verifierTimeoutSec')} for t in sample['tasks']},
            'finalAdmissionRequired': True}


def validate_official_materials(sample, dataset, pier):
    """Check task bytes, resources and fixed checkouts before constructing release hashes."""
    dataset, pier = Path(dataset), Path(pier)
    for root, expected in ((dataset, sample['datasetCommit']), (pier, '0c802fc067a425345b24d1c69411aa98acf61a1d')):
        head = subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD'], timeout=30).decode().strip()
        dirty = subprocess.check_output(['git', '-C', str(root), 'status', '--porcelain'], timeout=30).strip()
        if head != expected or dirty:
            raise ValueError('Official checkout differs from its immutable revision')
    for task in sample['tasks']:
        root = dataset / 'tasks' / task['id']
        if hash_file(root / 'instruction.md') != task['instructionSha256'] or hash_file(root / 'task.toml') != task['taskMetadataSha256']:
            raise ValueError('Official task material differs from the selected sample')
    return True


def verify_candidate(record, roots, evidence_root, guest_mapping=None):
    required = {'runner', 'runtime', 'plugin', 'profile', 'node', 'docker', 'pier', 'dataset'}
    if set(record['fingerprints']) != set(roots) or not required.issubset(roots):
        raise ValueError('Frozen roots differ from the complete runtime inventory')
    for name, frozen in record['fingerprints'].items():
        current = fingerprint(roots[name], frozen['exclusions'][1:])
        if current != frozen:
            raise ValueError('Frozen input changed: ' + name)
        validate_links(roots[name], current, roots, guest_mapping or {})
    actual = [validate_gate(gate['sourceFile'], evidence_root) for gate in record['gates']]
    if actual != record['gates']:
        raise ValueError('Gate assertion or evidence changed')
    present = [g['kind'] for g in actual]
    if set(present) != set(GATE_CHECKS) or len(present) != len(GATE_CHECKS):
        raise ValueError('Release candidate still lacks real gate evidence')
    return True


def require_frozen_release(release):
    """Verify the parent's admitted protocol and every currently executed frozen input."""
    protocol = json.loads(Path(release['protocol']).read_text())
    frozen = json.loads(Path(release['candidate']).read_text())
    roots = release['roots']
    runner = Path(roots['runner']).resolve()
    module = Path(__file__).resolve()
    if runner != module.parent and runner not in module.parents:
        raise ValueError('The executing runner is outside the frozen runner inventory')
    reference = json.loads(module.with_name('sample-20260928.json').read_text())
    expected = sample_sha256(reference)
    if release['expectedSampleSha256'] != expected or frozen['sampleSha256'] != expected:
        raise ValueError('Release differs from the runner original paired sample')
    if frozen['orderSha256'] != hashlib.sha256(canonical(protocol['order'])).hexdigest():
        raise ValueError('Release order changed')
    require_admission(protocol, expected)
    verify_candidate(frozen, roots, release['evidenceRoot'], release.get('guestMapping'))
    for name in ('runner', 'runtime', 'plugin', 'profile'):
        if protocol['release'][name + 'Sha256'] != frozen['fingerprints'][name]['sha256']:
            raise ValueError('Admitted protocol does not bind the frozen ' + name)
    evidence_root = Path(release['evidenceRoot']).resolve()
    admissions = protocol['release'].get('admissionEvidence', {})
    for requirement in protocol['admissionRequirements']:
        evidence = admissions.get(requirement)
        if not isinstance(evidence, list) or not evidence:
            raise ValueError('Admission requirement lacks actual evidence bytes')
        for row in evidence:
            relative = Path(row['relativePath'])
            if relative.is_absolute() or '..' in relative.parts:
                raise ValueError('Admission evidence must stay inside its private root')
            path = (evidence_root / relative).resolve(strict=True)
            if evidence_root not in path.parents or hash_file(path) != row['sha256']:
                raise ValueError('Admission evidence changed')
    return protocol


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('sample', type=Path)
    parser.add_argument('spec', type=Path, help='Private roots/exclusions/guestMapping/evidenceRoot/gatePaths JSON')
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    spec = json.loads(args.spec.read_text())
    sample = json.loads(args.sample.read_text())
    validate_official_materials(sample, spec['roots']['dataset'], spec['roots']['pier'])
    record = candidate(sample, spec['roots'], spec['evidenceRoot'],
                       spec.get('gatePaths', []), spec.get('exclusions'), spec.get('guestMapping'))
    with args.output.open('x') as out:
        json.dump(record, out, indent=2)
        out.write('\n')
    print(json.dumps({'modelAdmitted': False, 'missingGates': record['missingGates'],
                      'rootHashes': {k: v['sha256'] for k, v in record['fingerprints'].items()}}))


if __name__ == '__main__':
    main()
