import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { newTask } from '../../src/state.ts'
import { reviewJobSchema, foldReviewJobs } from '../../src/review-records.ts'
import { logRequirementResults, independentRequirementResults } from '../../src/review-results.ts'
import { reviewHandoff } from '../../src/review-handoff.ts'
import { continuationContext } from '../../src/task-context.ts'
import type { ReviewJob } from '../../src/review-schema.ts'

function job(): ReviewJob {
  const task = { ...newTask('总数必须为 12'), criteria: [{ id: 'c', text: '总数为 12', provenance: { kind: 'user' as const, reference: 'objective' } }] }
  return reviewJobSchema.parse({ id: randomUUID(), revision: 1, mainSessionId: 'main', taskId: task.id, taskRevision: 1, planVersion: 0,
    stageId: 'completion', nodeAttempt: null, kind: 'completion', cutoff: 20, reviewerSessionId: 'review', model: null, runtimeId: randomUUID(),
    status: 'started', attempt: 1, repairLimit: 1, startedAt: '', finishedAt: null, trigger: 'completion', input: task, evidence: 'claimed done', fault: null, decision: null })
}
const requirement = { id: 'r', criterionId: 'c', requirement: '总数为 12', source: { kind: 'objective' as const, reference: 'objective' }, basis: 'explicit' as const,
  status: 'satisfied' as const, finding: '实际记录计算为 12', coverage: '指定输入与输出关系', limitations: '日志记录不能代表独立运行', evidenceSeqs: [10] }
const ranges = new Map([[10, { total: 400, ranges: [[0, 30]] as [number, number][], truncated: true }]])
it('keeps log results at their actual evidence level and partial original ranges', () => {
  const result = logRequirementResults(job(), [requirement], ranges, true)[0]!
  expect(result.method).toBe('log')
  expect(result.evidence).toEqual([{ kind: 'session', seq: 10, ...ranges.get(10) }])
  expect(result.limitations).toContain('不能代表独立运行')
})
it.each(['failed', 'unverified'] as const)('prevents %s original requirements from passing, including omissions from weak criteria', status => {
  const value = { ...requirement, status, evidenceSeqs: status === 'unverified' ? [] : [10] }
  expect(() => logRequirementResults(job(), [value], ranges, true)).toThrow('cannot pass')
  expect(logRequirementResults(job(), [value], ranges, false)[0]?.status).toBe(status)
  expect(() => logRequirementResults(job(), [requirement, { ...value, id: 'omitted', criterionId: null }], ranges, true)).toThrow('cannot pass')
})
it('allows failed optional preferences without weakening explicit requirements or inventing source evidence', () => {
  const optional = { ...requirement, id: 'style', criterionId: null, basis: 'derived', source: { kind: 'implementation', reference: 'optional style' }, status: 'failed' }
  expect(logRequirementResults(job(), [requirement, optional], ranges, true)).toHaveLength(2)
  expect(() => logRequirementResults(job(), [{ ...requirement, basis: 'derived' }], ranges, true)).toThrow()
  expect(() => logRequirementResults(job(), [{ ...requirement, evidenceSeqs: [11] }], ranges, true)).toThrow('not actually read')
  expect(() => logRequirementResults(job(), [requirement], new Map(), true)).toThrow('not actually read')
  expect(() => logRequirementResults(job(), [requirement, { ...optional, source: { kind: 'user-message', reference: 'seq:11' } }], ranges, true)).toThrow('original user')
})
it('normalizes independent static and unavailable checks without forcing execution or duplicating model fields', () => {
  const value = job()
  value.verification = { snapshot: { id: randomUUID(), workspace: '/source', root: '/snap', baseline: '/snap/base', check: '/snap/check', digest: 'd', excluded: [],
    entries: [{ path: 'report.md', kind: 'file', hash: 'h', bytes: 12, mode: 420 }] }, phase: 'comparison', observations: [], checks: [], readChecks: [],
    readFiles: [{ path: 'report.md', ranges: [[0, 12]], total: 12 }], checkPlan: [{ revision: 1, recordedAt: '', checks: [
      { id: 'read', criterionId: 'c', source: requirement.source, fact: '静态总数', method: 'read', expected: '12', coverage: '正文', basis: 'explicit' },
      { id: 'observe', criterionId: null, source: requirement.source, fact: '观察', method: 'visual', expected: '显示', coverage: '页面', basis: 'derived' },
    ] }] }
  const results = independentRequirementResults(value, [
    { checkId: 'read', status: 'satisfied', finding: '正文一致', coverage: '正文', limitations: '', evidenceIds: ['file:report.md'] },
    { checkId: 'observe', status: 'unverified', finding: '能力不可用', coverage: '无', limitations: '没有独立浏览器', evidenceIds: [] },
  ])
  expect(results[0]?.evidence).toEqual([{ kind: 'artifact', path: 'report.md', hash: 'h', snapshotId: value.verification.snapshot.id, ranges: [[0, 12]], total: 12 }])
  expect(results[1]).toMatchObject({ method: 'visual', status: 'unverified', evidence: [] })
  expect(value.verification.checks).toHaveLength(0)
})
it('hands off only this task and applied review with concrete pending results, retaining old records without fabricated coverage', () => {
  const value = job(), task = { ...value.input, lastReview: { jobId: value.id, stageId: 'completion', verdict: 'revise' as const, finding: '修订总数', cutoff: 20 } }
  value.status = 'applied'; value.decision = { verdict: 'revise', finding: '修订总数', evidenceSeqs: [10], imageSeqs: [], decisionSeq: 5,
    requirements: logRequirementResults(value, [{ ...requirement, status: 'failed' }], ranges, false) }
  expect(JSON.parse(reviewHandoff(task, value)!)).toMatchObject({ applied: true, mode: 'log', pending: [{ id: 'r', status: 'failed' }], evidence: [{ requirementId: 'r' }] })
  expect(reviewHandoff({ ...task, id: randomUUID() }, value)).toBeNull()
  expect(continuationContext(task, '按修订意见检查', value)).toContain('log inspection')
  const { requirements: _results, ...legacy } = value.decision
  value.decision = legacy
  expect(reviewJobSchema.parse(value).decision?.requirements).toBeUndefined()
  expect(JSON.parse(reviewHandoff(task, value)!).legacyCoverage).toBe(true)
})
it('preserves record 8 result identity and cannot upgrade an older job to a new result protocol', () => {
  const value = job()
  const event = (record: ReviewJob) => ({ type: 'extension/record', seq: 1, time: 0, data: { namespace: 'dsh-task-supervisor-review', schemaVersion: 8, kind: 'job', recordId: `${record.id}:${record.revision}`, payload: record } }) as unknown as Parameters<typeof foldReviewJobs>[1]
  expect(foldReviewJobs([], event(value))).toHaveLength(1)
  expect(() => foldReviewJobs([value], event({ ...value, revision: 2, resultProtocol: 1 }))).toThrow()
})
