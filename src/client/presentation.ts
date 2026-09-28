/** Compact labels preserve original text in the detailed view. */
import { acceptedNodes, readyNodes, runsOf } from '../graph.ts'
import type { TaskSnapshot } from '../state-schema.ts'
import type { PanelState } from './task-store.ts'
import type { ReworkRecord } from '../rework-records.ts'

export const VERDICT = { pass: '通过', revise: '需要修订', 'needs-user': '等待用户决策' }
const PHASE: Record<TaskSnapshot['phase'], string> = {
  planning: '规划中', 'awaiting-approval': '等待批准', active: '执行中', reviewing: '审查中',
  paused: '已暂停', complete: '已完成', cleared: '已清除',
}
export function taskStatus(state: PanelState): string {
  const task = state.task
  if (!task) return '暂无任务'
  if (!task.enabled) return '督导已关闭'
  if (task.phase === 'paused' && task.pauseReason === 'review-fault') return '审查故障 · 等待恢复'
  if (task.phase === 'paused' && task.pauseReason === 'decision') return '等待用户决策'
  if (state.reviewing) return '独立审查中'
  if (!state.armed && ['active', 'planning', 'reviewing'].includes(task.phase)) return '等待手动恢复'
  return task.acceptanceCycle && task.acceptanceCycle > 1 ? `${PHASE[task.phase]} · 第 ${task.acceptanceCycle} 轮验收` : PHASE[task.phase]
}
export function progress(task: TaskSnapshot): string {
  return task.stages.length ? `${acceptedNodes(task).length}/${task.stages.length} 已通过` : '正在准备计划'
}
export function headline(text: string, limit = 60): string {
  const first = text.trim().split('\n')[0]?.replace(/^#{1,6}\s*/u, '').replace(/\*\*/gu, '') ?? ''
  return first.length > limit ? `${first.slice(0, limit).trimEnd()}…` : first
}

/** Attempts created by restart alone do not acquire a rework explanation. */
export function nodeRework(task: TaskSnapshot, id: string, records: readonly ReworkRecord[] = []) {
  const run = runsOf(task).find(item => item.id === id)
  const recorded = records.findLast(record => record.planVersion === task.planVersion
    && record.nodes.some(node => node.id === id && node.nextAttempt === run?.attempt))
  if (recorded) return recorded
  const repair = task.repairHistory?.findLast(cycle => cycle.affectedNodeIds.includes(id)
    && cycle.previousRuns.some(prior => prior.id === id && prior.attempt + 1 === run?.attempt))
  return repair ? { stageId: repair.rootNodeIds.includes(id) ? id : repair.rootNodeIds[0]!, reason: repair.reason } : undefined
}

/** Worker labels come from recorded execution Sessions, never title text or planned delegation. */
export function executionActors(task: TaskSnapshot, mainSessionId: string) {
  const ids = [...new Set(runsOf(task).flatMap(run => run.sessionId && run.sessionId !== mainSessionId ? [run.sessionId] : []))]
  return ids.map((sessionId, index) => ({ sessionId, label: `Worker ${index + 1}`,
    nodeIds: runsOf(task).filter(run => run.sessionId === sessionId).map(run => run.id) }))
}
export function executorLabel(task: TaskSnapshot, mainSessionId: string, nodeId: string): string {
  return executionActors(task, mainSessionId).find(actor => actor.nodeIds.includes(nodeId))?.label ?? '主 Agent'
}
export function nodeLabel(task: TaskSnapshot, id: string, state: PanelState): string {
  const run = runsOf(task).find(item => item.id === id)
  const rework = nodeRework(task, id, state.reworks)
  if (run?.status === 'passed') return '已通过'
  if (run?.status === 'awaiting-user') return '等待决定'
  if (run?.status === 'reviewing') return state.reviewing ? '审查中' : '审查待恢复'
  if (task.phase === 'awaiting-approval') return '等待批准'
  if (task.phase === 'paused' || !state.armed) return '等待继续'
  if (run?.status === 'awaiting-integration') return '等待集成'
  if (run?.status === 'running') return rework ? rework.stageId === id ? '返工中' : '重新执行中' : '执行中'
  if (run?.status === 'needs-revision') return '需要修订'
  return readyNodes(task).includes(id) ? rework ? rework.stageId === id ? '待返工' : '待重新执行' : '可执行' : '等待依赖'
}
