import { expect, it } from 'vitest'
import { appendCheckPlan, checkResultsAsEvidence, type ReviewCheck } from '../../src/review-check-plan.ts'
import { appendCheckResult, currentCheckResults, criterionSummary } from '../../src/review-findings.ts'
import { reusableChecks } from '../../src/review-reuse.ts'
import { independentRequirementResults } from '../../src/review-results.ts'
import { validateFindings } from '../../src/verification.ts'
import type { VerificationState } from '../../src/verification-schema.ts'
import type { ReviewJob } from '../../src/review-schema.ts'
import { newTask } from '../../src/state.ts'

const check: ReviewCheck = { id: 'read-title', criterionId: 'c', source: { kind: 'objective', reference: 'objective' }, fact: 'Required title',
  method: 'read', expected: 'Title', coverage: 'Complete document', basis: 'explicit' }
function state(): VerificationState {
  const value: VerificationState = { snapshot: { id: '00000000-0000-4000-8000-000000000001', workspace: '/source', digest: 'bound', root: '/e', baseline: '/e/b', check: '/e/c', excluded: ['.git'], entries: [] },
    phase: 'independent', observations: [], checks: [], readFiles: [{ path: 'brief.md', total: 5, ranges: [[0, 5]] }], readChecks: [] }
  appendCheckPlan(value, [check, { ...check, id: 'optional', basis: 'derived' }], ['c'], 'now')
  return value
}
it('retains incremental amendments and explicit unfinished gaps without treating a new receipt as coverage', () => {
  const value = state(), first = { checkId: check.id, status: 'satisfied' as const, finding: 'Title verified', coverage: check.coverage, limitations: '', evidenceIds: ['file:brief.md'] }
  appendCheckResult(value, first, { sessionId: 'review', callId: 'one', callSeq: 8 })
  appendCheckResult(value, { ...first, finding: 'Title and case verified' }, { sessionId: 'review', callId: 'two', callSeq: 12 })
  expect(value.checkHistory?.map(entry => entry.revision)).toEqual([1, 2])
  const results = currentCheckResults(value)
  expect(results[0]?.finding).toBe('Title and case verified'); expect(results[1]?.status).toBe('unverified')
  value.checkFindings = results
  expect(criterionSummary(value, results, ['c'])[0]?.status).toBe('satisfied')
  expect(() => validateFindings(value, ['c'], criterionSummary(value, results, ['c']), true)).not.toThrow()
  expect(() => appendCheckResult(value, first, { sessionId: 'review', callId: 'one', callSeq: 8 })).toThrow('receipt')
  value.phase = 'comparison'
  const sealed = structuredClone(value.checkFindings)
  appendCheckResult(value, { ...first, finding: 'Comparison confirmed title' }, { sessionId: 'review', callId: 'three', callSeq: 20 })
  expect(value.checkFindings).toEqual(sealed)
  expect(value.checkHistory?.at(-1)?.phase).toBe('comparison')
  expect(currentCheckResults(value)[0]?.finding).toBe('Comparison confirmed title')
})
it('never turns an unfinished explicit check into pass, while optional preferences remain nonblocking', () => {
  const value = state(), results = currentCheckResults(value)
  expect(criterionSummary(value, results, ['c'])[0]?.status).toBe('unverified')
  expect(() => checkResultsAsEvidence(value, results, true)).toThrow('cannot pass')
  expect(() => appendCheckResult(value, { ...results[0]!, checkId: 'unknown' }, { sessionId: 'review', callId: 'one', callSeq: 1 })).toThrow('bound check plan')
})
it('rejects incompatible delivery methods before sealing so a valid ordering check can be corrected', () => {
  const value = state()
  const ordering = { ...check, id: 'ordering', method: 'log' as const }
  expect(() => appendCheckPlan(value, [{ ...ordering, delivery: 'artifact' }], ['c'], 'now')).toThrow('Omit delivery for ordering')
  expect(value.checkPlan).toHaveLength(1)
  expect(() => appendCheckPlan(value, [ordering], ['c'], 'corrected')).not.toThrow()
  expect(() => appendCheckPlan(value, [{ ...check, id: 'commit', delivery: 'action' }], ['c'], 'later')).toThrow('paired native operation')
  expect(() => appendCheckPlan(value, [{ ...ordering, id: 'commit', delivery: 'action' }], ['c'], 'corrected')).not.toThrow()
})
function jobs() {
  const input = newTask('Compute required value'); input.planVersion = 1
  input.stages = [{ id: 'a', title: 'Compute', criterionIds: ['c'] }, { id: 'b', title: 'Integrate', criterionIds: ['c'], dependsOn: ['a'] }]
  input.nodeRuns = [{ id: 'a', status: 'passed', attempt: 1 }, { id: 'b', status: 'pending', attempt: 1 }]
  const source: ReviewJob = { id: '00000000-0000-4000-8000-000000000002', revision: 1, mainSessionId: 'main', taskId: input.id, taskRevision: input.revision,
    planVersion: 1, stageId: 'a', nodeAttempt: 1, kind: 'stage', cutoff: 5, reviewerSessionId: 'old', model: null, runtimeId: '00000000-0000-4000-8000-000000000003',
    status: 'applied', attempt: 1, repairLimit: 1, startedAt: '', finishedAt: '', trigger: 'stage', input, evidence: '', fault: null,
    decision: { verdict: 'pass', finding: 'SECRET OLD VERDICT', evidenceSeqs: [0], imageSeqs: [], decisionSeq: 7, checks: [] }, verification: state() }
  const planned = { ...check, id: 'compute', method: 'run' as const }
  source.verification!.checkPlan![0]!.checks = [planned]
  source.verification!.checks = [{ id: '00000000-0000-4000-8000-000000000004', snapshotId: source.verification!.snapshot.id, argv: ['node', 'check.mjs'], cwd: 'tree',
    startedAt: '', finishedAt: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputIncomplete: false, changed: [],
    runtime: { kind: 'docker', context: 'test', image: 'frozen', containerName: 'original' } }]
  source.decision!.checks = [{ checkId: planned.id, status: 'satisfied', finding: 'SECRET OLD FINDING', coverage: planned.coverage, limitations: '', evidenceIds: [source.verification!.checks[0]!.id] }]
  const current: ReviewJob = { ...structuredClone(source), id: '00000000-0000-4000-8000-000000000005', status: 'started', stageId: 'b', decision: null, verification: state() }
  current.verification!.snapshot.id = '00000000-0000-4000-8000-000000000006'
  current.verification!.checkPlan![0]!.checks = [planned]
  return { source, current, planned }
}
it('matches the whole execution identity and dependency attempt before offering cached commands', () => {
  const { source, current, planned } = jobs()
  expect(reusableChecks(current, [source], planned, 'frozen')).toHaveLength(1)
  expect(reusableChecks(current, [source], { ...planned, coverage: 'More than original' }, 'frozen')).toEqual([])
  expect(reusableChecks(current, [source], planned, 'different-runtime')).toEqual([])
  current.input.nodeRuns![0]!.attempt++
  expect(reusableChecks(current, [source], planned, 'frozen')).toEqual([])
  current.input.nodeRuns![0]!.attempt--; current.verification!.snapshot.digest = 'changed'
  expect(reusableChecks(current, [source], planned, 'frozen')).toEqual([])
})
it('retains original snapshot identity and requires fresh output reads before reuse supports a finding', () => {
  const { source, current, planned } = jobs(), state = current.verification!, executed = source.verification!.checks[0]!
  state.checks = [executed]
  state.reusedChecks = [{ checkId: executed.id, plannedCheckId: planned.id, sourceJobId: source.id, sourceSessionId: 'old', sourceNodeId: 'a', sourceAttempt: 1,
    sourceSnapshotId: executed.snapshotId, sourceRoot: '/e', digest: state.snapshot.digest, importedAt: 'now', method: 'run', scope: planned.coverage }]
  const result = { checkId: planned.id, status: 'satisfied' as const, finding: 'Rechecked actual output', coverage: planned.coverage, limitations: 'Exact unchanged execution world', evidenceIds: [executed.id] }
  const facts = checkResultsAsEvidence(state, [result], true)
  expect(() => validateFindings(state, [planned.id], facts, true)).toThrow('complete check')
  state.readChecks = ['stdout', 'stderr'].map(stream => ({ id: executed.id, stream: stream as 'stdout' | 'stderr', total: 0, ranges: [[0, 0]] }))
  expect(() => validateFindings(state, [planned.id], facts, true)).not.toThrow()
  const evidence = independentRequirementResults(current, [result])[0]!.evidence[0]
  expect(evidence).toMatchObject({ snapshotId: executed.snapshotId, reusedForSnapshotId: state.snapshot.id, sourceJobId: source.id })
  state.reusedChecks[0]!.scope = 'narrower'
  expect(() => checkResultsAsEvidence(state, [result], true)).toThrow('scope')
})

it('resolves a sealed coverage gap only through method-qualified evidence while retaining the original observations', () => {
  const { current, source, planned } = jobs(), value = current.verification!
  value.checks = [{ ...source.verification!.checks[0]!, snapshotId: value.snapshot.id }]
  value.checkPlan![0]!.checks = [planned]
  value.phase = 'independent'
  const gap = { checkId: planned.id, status: 'unverified' as const, finding: 'Not executed yet', coverage: planned.coverage, limitations: 'Missing independent run', evidenceIds: [] }
  appendCheckResult(value, gap, { sessionId: 'review', callId: 'gap', callSeq: 1 })
  value.checkFindings = currentCheckResults(value)
  value.observations = criterionSummary(value, value.checkFindings, ['c'])
  value.phase = 'comparison'
  const sealed = structuredClone({ checks: value.checkFindings, observations: value.observations })
  const resolved = { ...gap, status: 'satisfied' as const, finding: 'Independent reproduction confirmed', limitations: '', evidenceIds: [value.checks[0]!.id] }
  const { checkPlan: _plan, checkFindings: _findings, ...basic } = value
  const facts = checkResultsAsEvidence(value, [resolved], false)
  expect(() => validateFindings(basic, [planned.id], [{ ...facts[0]!, evidenceIds: ['seq:4'] }], false, new Map([[4, { total: 1, ranges: [[0, 1]], truncated: false }]]))).toThrow()
  expect(() => validateFindings(basic, [planned.id], facts, false)).toThrow('complete check')
  value.readChecks = ['stdout', 'stderr'].map(stream => ({ id: value.checks[0]!.id, stream: stream as 'stdout' | 'stderr', total: 0, ranges: [[0, 0]] }))
  expect(() => validateFindings({ ...basic, readChecks: value.readChecks }, [planned.id], facts, false)).not.toThrow()
  appendCheckResult(value, resolved, { sessionId: 'review', callId: 'resolution', callSeq: 12 })
  expect({ checks: value.checkFindings, observations: value.observations }).toEqual(sealed)
  const restored = JSON.parse(JSON.stringify(value)) as VerificationState
  const results = currentCheckResults(restored)
  expect(results[0]?.status).toBe('satisfied')
  expect(() => checkResultsAsEvidence(restored, results, true)).not.toThrow()
  expect(criterionSummary(restored, results, ['c'])[0]?.status).toBe('satisfied')
  restored.checks[0]!.snapshotId = '00000000-0000-4000-8000-000000000099'
  expect(() => validateFindings({ ...restored, checkPlan: undefined, checkFindings: undefined }, [planned.id], facts, true)).toThrow('foreign')
})

it('does not wash a sealed explicit failure into satisfaction using the same runtime evidence or new log claims', () => {
  const { current, source, planned } = jobs(), value = current.verification!
  value.checks = [{ ...source.verification!.checks[0]!, snapshotId: value.snapshot.id }]
  const failed = { checkId: planned.id, status: 'failed' as const, finding: 'Observed value contradicts original expectation', coverage: planned.coverage, limitations: '', evidenceIds: [value.checks[0]!.id] }
  appendCheckResult(value, failed, { sessionId: 'review', callId: 'original-failure', callSeq: 10 })
  value.checkFindings = currentCheckResults(value); value.phase = 'comparison'
  const candidate = { ...failed, status: 'satisfied' as const, finding: 'The checking activity is done' }
  expect(() => appendCheckResult(value, candidate, { sessionId: 'review', callId: 'same-failure', callSeq: 20 })).toThrow('FAILED_CHECK_UNRESOLVED')
  expect(() => appendCheckResult(value, { ...candidate, evidenceIds: [...failed.evidenceIds, 'seq:5', 'file:brief.md'] }, { sessionId: 'review', callId: 'main-claim', callSeq: 21 })).toThrow('additional acquired evidence of method run')
  expect(value.checkHistory).toHaveLength(1)
  const other = { ...value.checks[0]!, id: '00000000-0000-4000-8000-000000000010' }
  value.checks.push(other)
  appendCheckResult(value, { ...candidate, evidenceIds: [other.id], finding: 'Additional independent reproduction resolves the original observation' }, { sessionId: 'review', callId: 'additional', callSeq: 22 })
  expect(currentCheckResults(value)[0]?.status).toBe('satisfied')
  expect(value.checkFindings[0]?.status).toBe('failed')
  expect(value.checkHistory).toHaveLength(2)
})
