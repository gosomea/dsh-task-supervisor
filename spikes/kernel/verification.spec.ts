/** Pure acceptance admission uses independently inspected, complete and bound evidence. */
import { afterEach, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { CheckInputError } from '../../src/check-errors.ts'
import * as ReviewCheck from '../../src/review-check.ts'
import * as Records from '../../src/review-records.ts'
import { newTask } from '../../src/state.ts'
import { complete, validateFindings, verificationPolicy, installVerification } from '../../src/verification.ts'
import type { VerificationState, CriterionFinding } from '../../src/verification-schema.ts'
import { appendCheckPlan, type CheckFinding } from '../../src/review-check-plan.ts'

function state(): VerificationState {
  return { snapshot: { id: '00000000-0000-4000-8000-000000000001', workspace: '/source', digest: 'digest', root: '/evidence', baseline: '/evidence/baseline', check: '/evidence/check', excluded: [], entries: [] },
    phase: 'independent', observations: [], checks: [], readFiles: [{ path: 'code.js', ranges: [[0, 10]], total: 10 }], readChecks: [] }
}
const read: CriterionFinding = { criterionId: 'c', status: 'satisfied', method: 'read', finding: '实现与约束一致', evidenceIds: ['file:code.js'] }
it('requires complete contiguous pages and exactly one finding per applicable criterion', () => {
  expect(complete([[5, 10]], 10)).toBe(false)
  expect(complete([[5, 10], [0, 6]], 10)).toBe(true)
  expect(() => validateFindings(state(), ['c'], [read], true)).not.toThrow()
  expect(() => validateFindings(state(), ['c', 'd'], [read], true)).toThrow('exactly once')
  expect(() => validateFindings(state(), ['c'], [read, read], true)).toThrow('exactly once')
  const partial = state(); partial.readFiles[0]!.ranges = [[5, 10]]
  expect(() => validateFindings(partial, ['c'], [read], true)).toThrow('fully inspected')
})
it('retains limitations but cannot promote an unverified criterion to pass', () => {
  const unverified: CriterionFinding = { ...read, status: 'unverified', evidenceIds: [] }
  expect(() => validateFindings(state(), ['c'], [unverified], false)).not.toThrow()
  expect(() => validateFindings(state(), ['c'], [unverified], true)).toThrow('cannot pass')
  expect(() => validateFindings(state(), ['c'], [{ ...read, evidenceIds: [] }], true)).toThrow('independent evidence')
  expect(() => validateFindings(state(), ['c'], [{ ...read, method: 'run' }], true)).toThrow('independent check')
  expect(() => validateFindings(state(), ['c'], [{ ...read, method: 'visual' }], true)).toThrow('not available')
})
it('rejects foreign, modified, incomplete, failed or timed-out execution as acceptance evidence', () => {
  const value = state(), id = '00000000-0000-4000-8000-000000000002'
  value.checks.push({ id, snapshotId: value.snapshot.id, argv: ['node'], cwd: 'tree', startedAt: '', finishedAt: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, outputIncomplete: false, changed: [] })
  const finding: CriterionFinding = { ...read, method: 'run', evidenceIds: [id] }
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('complete check')
  value.readChecks = [{ id, stream: 'stdout', ranges: [[0, 0]], total: 0 }, { id, stream: 'stderr', ranges: [[0, 0]], total: 0 }]
  expect(() => validateFindings(value, ['c'], [finding], true)).not.toThrow()
  const check = value.checks[0]!
  check.isolation = 'fresh-copy'; check.generated = ['report.json']
  expect(() => validateFindings(value, ['c'], [finding], true)).not.toThrow()
  check.exitCode = 1
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('failed check')
  check.exitCode = 0; check.changed = ['code.js']
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('modified')
  check.changed = []; check.timedOut = true
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('timed out')
  check.timedOut = false; check.outputIncomplete = true
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('incomplete')
  check.outputIncomplete = false; check.snapshotId = 'other'
  expect(() => validateFindings(value, ['c'], [finding], true)).toThrow('foreign')
})
it('bounds trusted deployment configuration before model tools become available', () => {
  const container = { context: 'test', image: 'sha256:' + 'a'.repeat(64), cpus: 1, memoryMiB: 512, pids: 64 }
  expect(() => verificationPolicy({ storageRoot: '/private/evidence', container: { ...container, image: 'node:latest' } })).toThrow('immutable')
  expect(() => verificationPolicy({ storageRoot: '/private/evidence', container, deadlineMs: Infinity })).toThrow('deadlineMs')
  expect(verificationPolicy({ storageRoot: '/private/evidence', container }).deadlineMs).toBe(1800000)
})

afterEach(() => vi.restoreAllMocks())

/** Execute the registered tool body while mocking only native execution and the durable record boundary. */
function verificationTool() {
  type Tool = { name: string; execute(args: object, exec: { concludeTurn(): void }): Promise<unknown> }
  const tools = new Map<string, Tool>()
  const ctx = { tools: { register: (tool: Tool) => { tools.set(tool.name, tool) } } } as unknown as Context
  const main = {} as Agent, controller = new AbortController()
  const input = newTask('repair a greeting'); input.criteria = [{ id: 'c', text: 'greeting works', provenance: { kind: 'user', reference: 'objective' } }]
  input.stages = [{ id: 's', title: 'fix', criterionIds: ['c'], dependsOn: [], writePaths: [] }]
  const job: Records.ReviewJob = { id: '00000000-0000-4000-8000-000000000003', revision: 1,
    mainSessionId: 'main', taskId: input.id, taskRevision: 1, planVersion: 0, stageId: 's', nodeAttempt: 1,
    kind: 'stage', cutoff: 5, reviewerSessionId: 'review', model: null,
    runtimeId: '00000000-0000-4000-8000-000000000004', status: 'started', attempt: 1, repairLimit: 1,
    startedAt: new Date().toISOString(), finishedAt: null, deadlineAt: new Date(Date.now() + 60000).toISOString(),
    trigger: 'stage', input, evidence: 'main evidence', fault: null, decision: null, verification: state() }
  const persisted: Records.ReviewJob[] = []
  const record = vi.spyOn(Records, 'recordReview').mockImplementation(async (_owner, _main, value) => {
    Records.reviewJobSchema.parse(value)
    persisted.push(structuredClone(value))
  })
  const container = { context: 'test', image: 'sha256:' + 'a'.repeat(64), cpus: 1, memoryMiB: 512, pids: 64 }
  installVerification(ctx, ctx, main, job, SessionId('review'), verificationPolicy({ storageRoot: '/private/evidence', container }), controller.signal)
  const tool = tools.get('run_review_check')!, concludeTurn = vi.fn()
  return { job, persisted, record, controller, concludeTurn, invoke: () => tool.execute({ argv: ['node'], cwd: 'tree' }, { concludeTurn }),
    observe: (findings: CriterionFinding[], checks: CheckFinding[]) => tools.get('task_review_observations')!.execute({ findings, checks }, { concludeTurn }) }
}

it('explains check associations and leaves rejected observations uncommitted before a valid same-job retry', async () => {
  const f = verificationTool(), value = f.job.verification!
  f.job.checkProtocol = 1
  const item = { id: 'title', criterionId: 'c', source: { kind: 'objective' as const, reference: 'objective' }, fact: 'required title', method: 'read' as const, expected: 'agreed title', coverage: 'whole text', basis: 'explicit' as const }
  appendCheckPlan(value, [item, { ...item, id: 'omitted', criterionId: null }], ['c'], 'now')
  const checks: CheckFinding[] = ['title', 'omitted'].map(checkId => ({ checkId, status: 'satisfied', finding: 'read actual content', coverage: 'whole text', limitations: '', evidenceIds: ['file:code.js'] }))
  const finding = { ...read, coverage: 'whole text', limitations: '', checkIds: ['title', 'omitted'] }
  await expect(f.observe([finding], checks)).rejects.toThrow('expected checkIds=["title"]')
  expect(value.checkFindings).toBeUndefined()
  expect(value.phase).toBe('independent')
  expect(f.record).not.toHaveBeenCalled()
  await expect(f.observe([{ ...finding, checkIds: ['title'] }], checks)).resolves.toMatchObject({ phase: 'comparison' })
  expect(value.checkFindings).toEqual(checks)
  expect(f.persisted).toHaveLength(1)
})
function successfulCheck(): ReviewCheck.CheckResult {
  return { id: '00000000-0000-4000-8000-000000000005', snapshotId: state().snapshot.id, argv: ['node'], cwd: 'tree',
    startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), exitCode: 0, signal: null,
    timedOut: false, cancelled: false, stdout: 'ok', stderr: '', outputIncomplete: false, changed: [] }
}
it('does not persist or conclude on correctable input, then durably records a successful retry', async () => {
  const f = verificationTool(), native = vi.spyOn(ReviewCheck, 'runCheck')
    .mockRejectedValueOnce(new CheckInputError('cwd missing')).mockResolvedValueOnce(successfulCheck())
  await expect(f.invoke()).rejects.toBeInstanceOf(CheckInputError)
  expect(f.job.fault).toBeNull(); expect(f.job.revision).toBe(1)
  expect(f.record).not.toHaveBeenCalled(); expect(f.concludeTurn).not.toHaveBeenCalled()
  await expect(f.invoke()).resolves.toMatchObject({ exitCode: 0, stdoutChars: 2 })
  expect(native).toHaveBeenCalledTimes(2)
  expect(f.persisted).toHaveLength(1); expect(f.persisted[0]!.revision).toBe(2)
  expect(f.persisted[0]!.verification!.checks).toHaveLength(1)
  expect(f.persisted[0]!.fault).toBeNull(); expect(f.concludeTurn).not.toHaveBeenCalled()
})
it('retains a real infrastructure fault after a later successful check', async () => {
  const f = verificationTool()
  vi.spyOn(ReviewCheck, 'runCheck').mockRejectedValueOnce(new Error('CHECK_INFRASTRUCTURE: ownership mismatch')).mockResolvedValueOnce(successfulCheck())
  await expect(f.invoke()).rejects.toBeInstanceOf(Records.ReviewFailure)
  expect(f.job.fault?.code).toBe('check-infrastructure'); expect(f.concludeTurn).toHaveBeenCalledOnce()
  expect(f.persisted[0]!.fault?.code).toBe('check-infrastructure')
  await f.invoke()
  expect(f.persisted).toHaveLength(2)
  expect(f.persisted[1]!.fault?.code).toBe('check-infrastructure')
})
it('records cancellation as sticky even when the underlying error has the input type', async () => {
  const f = verificationTool()
  vi.spyOn(ReviewCheck, 'runCheck').mockImplementation(async () => {
    f.controller.abort(new Error('review cancelled'))
    throw new CheckInputError('interrupted validation')
  })
  await expect(f.invoke()).rejects.toBeInstanceOf(Records.ReviewFailure)
  expect(f.job.fault?.code).toBe('cancelled')
  expect(f.persisted[0]!.fault?.code).toBe('cancelled')
  expect(f.concludeTurn).toHaveBeenCalledOnce()
})
it('keeps a recorded exit-127 command from supporting a satisfied criterion', () => {
  const value = state(), check = successfulCheck(); check.exitCode = 127
  const { stdout: _stdout, stderr: _stderr, ...summary } = check
  value.checks = [summary]
  value.readChecks = [{ id: check.id, stream: 'stdout', ranges: [[0, 0]], total: 0 }, { id: check.id, stream: 'stderr', ranges: [[0, 0]], total: 0 }]
  expect(() => validateFindings(value, ['c'], [{ ...read, method: 'run', evidenceIds: [check.id] }], true)).toThrow('failed check')
})

it('permits artifact-only verification without a command runner and rejects unavailable capabilities before dispatch', async () => {
  const { reviewCapabilities, prepareCapabilities } = await import('../../src/review-capabilities.ts')
  const policy = verificationPolicy({ storageRoot: '/private/evidence' })
  expect(policy.checks).toBeUndefined()
  expect(reviewCapabilities(policy).map(item => [item.id, item.configured])).toEqual([['read', true], ['run', false], ['visual', false]])
  // Unavailable capabilities are detected before accessing any Host or Agent state.
  await expect(prepareCapabilities({} as Context, {} as Agent, policy, { capabilities: ['run'] }, new AbortController().signal)).rejects.toThrow('CAPABILITY_UNAVAILABLE')
  await expect(prepareCapabilities({} as Context, {} as Agent, policy, { capabilities: ['visual'] }, new AbortController().signal)).rejects.toThrow('no log fallback')
  await expect(prepareCapabilities({} as Context, {} as Agent, undefined, { capabilities: [] }, new AbortController().signal)).resolves.toBeUndefined()
})

it('retains appended check plans, rejects missing coverage and keeps hypotheses separate from requirements', async () => {
  const { appendCheckPlan, checkResultsAsEvidence } = await import('../../src/review-check-plan.ts')
  const value = state()
  const item = { id: 'static', criterionId: 'c', source: { kind: 'objective' as const, reference: 'objective' }, fact: 'static declaration', method: 'read' as const, expected: 'agreed value', coverage: 'declared content', basis: 'explicit' as const }
  expect(() => appendCheckPlan(value, [item], ['c', 'd'], 'now')).toThrow('cover every')
  appendCheckPlan(value, [item], ['c'], 'first')
  appendCheckPlan(value, [{ ...item, id: 'hypothesis', basis: 'derived' }], ['c'], 'second')
  expect(value.checkPlan!.map(entry => entry.revision)).toEqual([1, 2])
  expect(() => appendCheckPlan(value, [item], ['c'], 'third')).toThrow('unique')
  const findings = [{ checkId: 'static', status: 'satisfied' as const, finding: 'actual content', coverage: 'content', limitations: '', evidenceIds: ['file:code.js'] },
    { checkId: 'hypothesis', status: 'failed' as const, finding: 'optional preference absent', coverage: 'optional property', limitations: 'not a user requirement', evidenceIds: ['file:code.js'] }]
  expect(() => checkResultsAsEvidence(value, findings, true)).not.toThrow()
  expect(() => checkResultsAsEvidence(value, findings.slice(1), true)).toThrow('every planned')
  expect(() => checkResultsAsEvidence(value, [{ ...findings[0]!, status: 'unverified' }, findings[1]!], true)).toThrow('cannot pass')
})

it('defers Session-only facts until comparison and never upgrades them to independent execution', () => {
  const value = state(), evidence = new Map([[7, { total: 10, ranges: [[0, 10]] as [number, number][], truncated: false }]])
  const log: CriterionFinding = { ...read, method: 'log', evidenceIds: ['seq:7'] }
  expect(() => validateFindings(value, ['c'], [{ ...log, status: 'unverified', evidenceIds: [] }], false)).not.toThrow()
  expect(() => validateFindings(value, ['c'], [log], true, evidence)).toThrow('until independent observations')
  value.phase = 'comparison'
  expect(() => validateFindings(value, ['c'], [log], true, evidence)).not.toThrow()
  expect(() => validateFindings(value, ['c'], [log], true, new Map())).toThrow('not a fully read original')
  expect(() => validateFindings(value, ['c'], [log], true, new Map([[7, { ...evidence.get(7)!, truncated: true }]]))).toThrow('not a fully read original')
  expect(() => validateFindings(value, ['c'], [log], true, new Map([[7, { total: 10, ranges: [[0, 5]], truncated: false }]]))).toThrow('not a fully read original')
  expect(() => validateFindings(value, ['c'], [{ ...log, evidenceIds: ['file:code.js'] }], true, evidence)).toThrow('not a fully read original')
  expect(() => validateFindings(value, ['c'], [{ ...log, method: 'run' }], true, evidence)).toThrow('check evidence')
  expect(() => validateFindings(value, ['c'], [{ ...log, method: 'read' }], true, evidence)).toThrow('check evidence')
})
