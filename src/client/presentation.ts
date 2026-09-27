/** Compact labels preserve original text in the detailed view. */
import { acceptedNodes, readyNodes, runsOf } from '../graph.ts'
import type { TaskSnapshot } from '../state-schema.ts'
import type { PanelState } from './task-store.ts'

export const VERDICT = { pass: '通过', revise: '需要修订', 'needs-user': '等待用户决策' }
const PHASE: Record<TaskSnapshot['phase'], string> = {
  planning: '规划中', 'awaiting-approval': '等待批准', active: '执行中', reviewing: '审查中',
  paused: '已暂停', complete: '已完成', cleared: '已清除',
}
export function taskStatus(state: PanelState): string {
  const task = state.task
  if (!task) return '暂无任务'
  if (!task.enabled) return '督导已关闭'
  if (state.reviewing) return '独立审查中'
  if (!state.armed && ['active', 'planning', 'reviewing'].includes(task.phase)) return '等待手动恢复'
  return PHASE[task.phase]
}
export function progress(task: TaskSnapshot): string {
  return task.stages.length ? `${acceptedNodes(task).length}/${task.stages.length} 已通过` : '正在准备计划'
}
export function headline(text: string, limit = 60): string {
  const first = text.trim().split('\n')[0]?.replace(/^#{1,6}\s*/u, '').replace(/\*\*/gu, '') ?? ''
  return first.length > limit ? `${first.slice(0, limit).trimEnd()}…` : first
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
  if (run?.status === 'passed') return '已通过'
  if (run?.status === 'awaiting-user') return '等待决定'
  if (run?.status === 'reviewing') return state.reviewing ? '审查中' : '审查待恢复'
  if (task.phase === 'awaiting-approval') return '等待批准'
  if (task.phase === 'paused' || !state.armed) return '等待继续'
  if (run?.status === 'awaiting-integration') return '等待集成'
  if (run?.status === 'running') return '执行中'
  if (run?.status === 'needs-revision') return '需要修订'
  return readyNodes(task).includes(id) ? '可执行' : '等待依赖'
}
