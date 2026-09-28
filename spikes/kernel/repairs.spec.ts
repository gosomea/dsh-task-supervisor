import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { REPAIR_NAMESPACE, reopenTask, repairImpact, type RepairProposal } from '../../src/repairs.ts'
import { newTask, taskJson, taskProjection, createTaskHistoryCollector, type TaskSnapshot } from '../../src/state.ts'
import { runsOf, withRuns } from '../../src/graph.ts'
import { nodeLabel } from '../../src/client/presentation.ts'

export function completed(): TaskSnapshot {
  const task = { ...newTask('原目标'), phase: 'complete' as const, planVersion: 1, approvedPlanVersion: 1,
    everApproved: true, completedAt: '2026-09-28T01:00:00Z', lastReview: { stageId: 'completion', cutoff: 0, verdict: 'pass' as const, finding: '此前完成验收' },
    criteria: [{ id: 'c', text: '正确执行' }], stages: [
      { id: 'a', title: '核心', criterionIds: ['c'], dependsOn: [] },
      { id: 'b', title: '独立组件', criterionIds: ['c'], dependsOn: [] },
      { id: 'c', title: '集成', criterionIds: ['c'], dependsOn: ['a', 'b'] },
      { id: 'd', title: '终验', criterionIds: ['c'], dependsOn: ['c'] },
    ] }
  return withRuns(task, runsOf(task).map(run => ({ ...run, status: 'passed', reviewSeq: 0 })))
}
function proposal(task: TaskSnapshot, roots = ['a']): RepairProposal {
  return { id: randomUUID(), taskId: task.id, taskRevision: task.revision, title: '修复缺陷', reason: '发现真实缺陷',
    rootNodeIds: roots, affectedNodeIds: repairImpact(task, roots), evidenceSeqs: [],
    artifact: { workspaceKey: '/case', digest: 'a'.repeat(64), files: 1, bytes: 1 }, proposedAt: '2026-09-28T02:00:00Z', proposedSeq: 1, status: 'pending' }
}
const stateRecord = (task: TaskSnapshot, seq: number): SessionEvent => ({ type: 'extension/record', seq, time: seq,
  data: { namespace: 'dsh-task-supervisor', schemaVersion: 10, kind: 'state', recordId: randomUUID(), payload: taskJson(task) } } as SessionEvent)
const proposeRecord = (p: RepairProposal): SessionEvent => ({ type: 'extension/record', seq: p.proposedSeq, time: p.proposedSeq,
  data: { namespace: REPAIR_NAMESPACE, schemaVersion: 1, kind: 'proposal', recordId: p.id, payload: p } } as SessionEvent)
const confirmRecord = (p: RepairProposal, seq: number): SessionEvent => ({ type: 'extension/record', seq, time: seq,
  data: { namespace: REPAIR_NAMESPACE, schemaVersion: 1, kind: 'confirm', recordId: randomUUID(), payload: {
    proposalId: p.id, taskId: p.taskId, taskRevision: p.taskRevision, source: 'web-confirmation', confirmedAt: '2026-09-28T03:00:00Z',
  } } } as SessionEvent)
const confirm = (p: RepairProposal, seq = 2): RepairProposal => ({ ...p, status: 'confirmed', confirmationSeq: seq, confirmedAt: '2026-09-28T03:00:00Z' })

it('requires confirmation, retains old acceptance and resets only the dependency union once', () => {
  const before = completed(), pending = proposal(before, ['a', 'b'])
  expect(() => reopenTask(before, pending, 3)).toThrow('REPAIR_CONFIRMATION_REQUIRED')
  const next = reopenTask(before, confirm(pending), 3)
  expect(next.id).toBe(before.id)
  expect(next).toMatchObject({ acceptanceCycle: 2, phase: 'active', stageIndex: 0, lastReview: null, completedAt: undefined })
  expect(runsOf(next).map(r => [r.id, r.attempt, r.status])).toEqual(['a', 'b', 'c', 'd'].map(id => [id, 2, 'pending']))
  expect(next.repairHistory?.[0]?.previousReview?.finding).toBe('此前完成验收')
  const single = reopenTask(before, confirm(proposal(before)), 3)
  expect(runsOf(single).find(r => r.id === 'b')).toEqual(runsOf(before).find(r => r.id === 'b'))
  expect(nodeLabel(single, 'a', { task: single, live: true, armed: true, reviewing: false, actions: [] })).toBe('待返工')
})

it.each(['revision', 'scope', 'disabled'] as const)('rejects an invalid confirmed transition: %s', mode => {
  const task = completed(), p = confirm(proposal(task))
  if (mode === 'revision') task.revision++
  if (mode === 'scope') p.affectedNodeIds = ['a']
  if (mode === 'disabled') task.enabled = false
  expect(() => reopenTask(task, p, 3)).toThrow(mode === 'disabled' ? 'SUPERVISOR_DISABLED' : 'REPAIR_STALE')
})

it('refuses native state reopening without a recorded confirmation receipt', () => {
  const before = completed(), p = proposal(before)
  let state = taskProjection.apply(taskProjection.init(), stateRecord(before, 0))
  state = taskProjection.apply(state, proposeRecord(p))
  expect(state.current?.phase).toBe('complete')
  const forged = reopenTask(before, confirm(p), 2)
  state = taskProjection.apply(state, stateRecord(forged, 2))
  expect(state.failure).toContain('REPAIR_CONFIRMATION_REQUIRED')
  expect(state.current?.phase).toBe('complete')
})

it('replays repeated acceptance cycles and historical reopening without duplicate task identities', () => {
  const original = completed(), other = { ...newTask('后来的任务'), phase: 'complete' as const }
  const collector = createTaskHistoryCollector()
  let state = taskProjection.init(), seq = 0
  const append = (event: SessionEvent) => { collector.add(event); state = taskProjection.apply(state, event); expect(state.failure).toBeNull() }
  append(stateRecord(original, seq++)); append(stateRecord(other, seq++))
  let task = original
  for (let cycle = 2; cycle <= 3; cycle++) {
    const p = { ...proposal(task), proposedSeq: seq }
    append(proposeRecord(p)); seq++
    append(confirmRecord(p, seq)); const confirmed = confirm(p, seq++)
    task = reopenTask(task, confirmed, seq)
    append(stateRecord(task, seq++))
    expect(state.current?.acceptanceCycle).toBe(cycle)
    expect(state.repairs.at(-1)?.status).toBe('applied')
    task = { ...task, revision: task.revision + 1, phase: 'complete', lastReview: { stageId: 'completion', cutoff: seq, verdict: 'pass', finding: `第 ${cycle} 轮通过` },
      nodeRuns: runsOf(task).map(r => ({ ...r, status: 'passed' })), stageIndex: task.stages.length }
    append(stateRecord(task, seq++))
  }
  expect(collector.finish().map(e => e.task.id)).toEqual([original.id, other.id])
  expect(collector.finish()[0]?.task.repairHistory).toHaveLength(2)
  expect(collector.finish()[0]?.reviews.map(r => r.finding)).toEqual(['此前完成验收', '第 2 轮通过', '第 3 轮通过'])
})
