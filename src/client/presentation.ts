/** Compact labels preserve original text in the detailed view. */
import { acceptedNodes } from '../graph.ts'
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
