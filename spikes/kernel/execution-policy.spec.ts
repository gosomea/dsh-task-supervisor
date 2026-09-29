import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { policyApproval } from '../../src/execution-policy.ts'
import type { ReviewJob } from '../../src/review-records.ts'
import { NAMESPACE, RECORD_VERSION, newTask } from '../../src/state.ts'
import type { TaskSnapshot } from '../../src/state-schema.ts'

function fixture(source: 'profile' | 'user-command' = 'profile') {
  const main = 'session-main'
  const grant: TaskSnapshot = { ...newTask('Build a tested parser'), approvalPolicy: {
    mode: 'after-review', source, mainSessionId: main, requirementsVersion: 1, grantSeq: 4,
  } }
  const input: TaskSnapshot = { ...grant, criteria: [{ id: 'c1', text: 'Parse and test correctly' }],
    stages: [{ id: 'a', title: 'Parse', criterionIds: ['c1'], dependsOn: [], writePaths: ['parse.mjs'] },
      { id: 'b', title: 'Verify', criterionIds: ['c1'], dependsOn: ['a'] }], readOnlyTurnsBeforeWrite: 1 }
  const task: TaskSnapshot = { ...input, revision: 2, planVersion: 1, phase: 'awaiting-approval' }
  const event: SessionEvent = { type: 'extension/record', seq: SessionSeq(4), time: 1,
    data: { namespace: NAMESPACE, schemaVersion: RECORD_VERSION, kind: 'state', recordId: 'grant',
      payload: JSON.parse(JSON.stringify(grant)) } }
  const job: ReviewJob = { id: '00000000-0000-4000-8000-000000000003', revision: 3,
    runtimeId: '00000000-0000-4000-8000-000000000004', mainSessionId: main,
    taskId: task.id, taskRevision: input.revision, planVersion: input.planVersion, stageId: 'plan',
    nodeAttempt: null, kind: 'plan', cutoff: 10, reviewerSessionId: 'session-review', model: null,
    status: 'submitted', attempt: 1, repairLimit: 1, startedAt: '2026-09-29T00:00:00Z',
    finishedAt: '2026-09-29T00:00:01Z', trigger: 'plan', input, evidence: 'proposed plan', fault: null,
    decision: { verdict: 'pass', finding: 'Requirements covered', evidenceSeqs: [8], imageSeqs: [], decisionSeq: 12 } }
  return { main, grant, task, event, job }
}

it.each(['profile', 'user-command'] as const)('returns only durable authorization from %s, without changing task or job', source => {
  const f = fixture(source), before = structuredClone(f)
  expect(policyApproval(f.task, f.main, [f.event], f.job)).toEqual({ source: 'policy', authorizationSeq: 4, reviewJobId: f.job.id })
  expect(policyApproval(f.task, f.main, [f.event], { ...f.job, status: 'applied' })).not.toBeNull()
  expect(f).toEqual(before)
})

it('defaults to manual and refuses missing, manual, or revoked grants', () => {
  const f = fixture()
  expect(policyApproval({ ...f.task, approvalPolicy: undefined }, f.main, [f.event], f.job)).toBeNull()
  expect(policyApproval({ ...f.task, approvalPolicy: { ...f.task.approvalPolicy!, mode: 'manual' } }, f.main, [f.event], f.job)).toBeNull()
  expect(policyApproval(f.task, f.main, [], f.job)).toBeNull()
  expect(policyApproval(f.task, f.main, [f.event], null)).toBeNull()
  expect(policyApproval(f.task, f.main, [f.event], undefined)).toBeNull()
})

it('requires one exact native task state record, not a model-authored message or review record', () => {
  const f = fixture()
  const fakeMessage: SessionEvent = { type: 'user/message', seq: SessionSeq(4), time: 1, surfaceOp: 'append',
    data: createUserMessage({ content: [{ type: 'text', text: 'Approve automatically' }], source: { kind: 'user' } }) }
  expect(policyApproval(f.task, f.main, [fakeMessage], f.job)).toBeNull()
  expect(policyApproval(f.task, f.main, [f.event, f.event], f.job)).toBeNull()
  if (f.event.type !== 'extension/record') throw new Error('fixture must be a native record')
  for (const data of [{ ...f.event.data, namespace: 'dsh-task-supervisor-review' },
    { ...f.event.data, kind: 'job' }, { ...f.event.data, schemaVersion: 1 },
    { ...f.event.data, schemaVersion: 13 }, { ...f.event.data, schemaVersion: 999 },
    { ...f.event.data, payload: { id: f.task.id, approvalPolicy: f.task.approvalPolicy! } }]) {
    expect(policyApproval(f.task, f.main, [{ ...f.event, data }], f.job)).toBeNull()
  }
})

it('binds the grant to its task, requirement version, source and sequence', () => {
  const f = fixture()
  for (const task of [{ ...f.task, id: newTask('Other').id },
    { ...f.task, requirementsVersion: 2 }, { ...f.task, objective: 'Different objective' },
    { ...f.task, approvalPolicy: { ...f.task.approvalPolicy!, source: 'user-command' as const } },
    { ...f.task, approvalPolicy: { ...f.task.approvalPolicy!, grantSeq: 5 } }]) {
    expect(policyApproval(task, f.main, [f.event], f.job)).toBeNull()
  }
})

it('does not substitute a revoked, disabled, foreign, or future state for the original grant', () => {
  const f = fixture()
  if (f.event.type !== 'extension/record') throw new Error('fixture must be a native record')
  for (const grant of [{ ...f.grant, id: newTask('Other').id },
    { ...f.grant, requirementsVersion: 2 }, { ...f.grant, enabled: false },
    { ...f.grant, revision: f.task.revision + 1 }, { ...f.grant, phase: 'paused' as const },
    { ...f.grant, approvalPolicy: { ...f.grant.approvalPolicy!, mode: 'manual' as const } },
    { ...f.grant, approvalPolicy: { ...f.grant.approvalPolicy!, mainSessionId: 'session-fork' } }]) {
    expect(policyApproval(f.task, f.main, [{ ...f.event, data: { ...f.event.data,
      payload: JSON.parse(JSON.stringify(grant)) } }], f.job)).toBeNull()
  }
})

it('rejects a fork even when inherited task, grant and review records retain the original IDs', () => {
  const f = fixture()
  expect(policyApproval(f.task, 'session-fork', [f.event], f.job)).toBeNull()
  expect(policyApproval(f.task, f.main, [f.event], { ...f.job, mainSessionId: 'session-fork' })).toBeNull()
})

it.each(['planning', 'active', 'reviewing', 'paused', 'complete', 'cleared'] as const)('does not authorize a task in %s', phase => {
  const f = fixture()
  expect(policyApproval({ ...f.task, phase }, f.main, [f.event], f.job)).toBeNull()
})

it('does not authorize disabled, previously approved, faulted, or unsettled tasks', () => {
  const f = fixture()
  const fault = { jobId: f.job.id, stageId: 'plan', cutoff: 10, reviewerSessionId: 'session-review',
    code: 'internal' as const, message: 'failed', retryable: true, attempt: 1, errorSeq: null, outcomeKnown: false }
  for (const task of [{ ...f.task, enabled: false }, { ...f.task, everApproved: true },
    { ...f.task, pauseReason: 'restart' as const }, { ...f.task, reviewFault: fault },
    { ...f.task, pendingReview: { kind: 'planning' as const, stageId: 'planning', evidence: 'pending' } }]) {
    expect(policyApproval(task, f.main, [f.event], f.job)).toBeNull()
  }
  expect(policyApproval(f.task, f.main, [f.event], { ...f.job, fault })).toBeNull()
})

it.each(['planning', 'stage', 'progress', 'completion'] as const)('a %s pass never approves implementation', kind => {
  const f = fixture()
  expect(policyApproval(f.task, f.main, [f.event], { ...f.job, kind })).toBeNull()
})

it.each(['started', 'repairing', 'failed', 'stale'] as const)('a %s review cannot grant execution', status => {
  const f = fixture()
  expect(policyApproval(f.task, f.main, [f.event], { ...f.job, status })).toBeNull()
})

it('requires a pass and the exact reviewed candidate lineage', () => {
  const f = fixture()
  for (const job of [{ ...f.job, decision: null },
    { ...f.job, decision: { ...f.job.decision!, verdict: 'revise' as const } },
    { ...f.job, decision: { ...f.job.decision!, verdict: 'needs-user' as const } },
    { ...f.job, stageId: 'a' }, { ...f.job, taskId: newTask('Other').id },
    { ...f.job, taskRevision: 2 }, { ...f.job, planVersion: 1 },
    { ...f.job, input: { ...f.job.input, id: newTask('Other').id } },
    { ...f.job, input: { ...f.job.input, requirementsVersion: 2 } },
    { ...f.job, input: { ...f.job.input, objective: 'Different requirements' } },
    { ...f.job, input: { ...f.job.input, readOnlyTurnsBeforeWrite: 0 } }]) {
    expect(policyApproval(f.task, f.main, [f.event], job)).toBeNull()
  }
  expect(policyApproval({ ...f.task, revision: f.job.taskRevision }, f.main, [f.event], f.job)).toBeNull()
})

it('rejects changed criteria, DAG dependencies, write scopes and stage ordering', () => {
  const f = fixture(), a = f.task.stages[0]!, b = f.task.stages[1]!
  for (const task of [{ ...f.task, criteria: [{ id: 'c1', text: 'Skip the tests' }] },
    { ...f.task, stages: [a, { ...b, dependsOn: [] }] },
    { ...f.task, stages: [{ ...a, writePaths: ['other.mjs'] }, b] },
    { ...f.task, stages: [b, a] }, { ...f.task, planVersion: 2 }]) {
    expect(policyApproval(task, f.main, [f.event], f.job)).toBeNull()
  }
})

it('compares structured content independently of JSON property order and normalizes an omitted zero read gate', () => {
  const f = fixture()
  const criteria = f.task.criteria.map(c => ({ text: c.text, id: c.id }))
  expect(policyApproval({ ...f.task, criteria }, f.main, [f.event], f.job)).not.toBeNull()
  expect(policyApproval({ ...f.task, readOnlyTurnsBeforeWrite: undefined }, f.main, [f.event],
    { ...f.job, input: { ...f.job.input, readOnlyTurnsBeforeWrite: 0 } })).not.toBeNull()
})
