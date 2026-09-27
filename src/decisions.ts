/** Version-bound approval from a direct user message, never an injected prompt. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { NAMESPACE, type TaskSnapshot } from './state.ts'

export function isApprovalText(text: string): boolean {
  const normalized = text.trim().replace(/[。！!．.]$/u, '').trim()
  return /^(?:批准(?:当前|这个|该)?(?:计划)?|同意(?:当前|这个|该)?计划(?:，?开始(?:执行)?)?|可以[，, ]*开始(?:执行)?(?:吧)?|approve(?: the)?(?: current)?(?: plan)?|yes[ ,]+(?:approve|proceed))$/iu.test(normalized)
}

export function approvalMessage(events: readonly SessionEvent[], task: TaskSnapshot): number | null {
  let planSeq = -1
  let latestUser: Extract<SessionEvent, { type: 'user/message' }> | undefined
  for (const event of events) {
    if (event.type === 'extension/record' && event.data.namespace === NAMESPACE) {
      const payload = event.data.payload
      if (payload !== null && typeof payload === 'object' && !Array.isArray(payload)
        && payload.id === task.id && payload.planVersion === task.planVersion
        && payload.phase === 'awaiting-approval' && planSeq === -1) planSeq = event.seq
    }
    if (event.type === 'user/message' && event.data.source.kind === 'user') latestUser = event
  }
  if (planSeq < 0 || latestUser === undefined || latestUser.seq <= planSeq) return null
  const text = latestUser.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  return isApprovalText(text) ? latestUser.seq : null
}

export function approvedTask(task: TaskSnapshot, startSeq: number, userMessageSeq?: number): TaskSnapshot {
  if (task.phase !== 'awaiting-approval' || !task.enabled) throw new Error('the current plan is not awaiting approval')
  return { ...task, revision: task.revision + 1, approvedPlanVersion: task.planVersion,
    everApproved: true, phase: 'active', readOnlyGateStartSeq: startSeq,
    lastApproval: { planVersion: task.planVersion, userMessageSeq: userMessageSeq ?? null } }
}

export function controlActions(task: TaskSnapshot | null, armed: boolean, reviewing: boolean): string[] {
  if (task === null || task.phase === 'cleared') return []
  if (!task.enabled) return ['on']
  if (task.phase === 'complete') return []
  if (reviewing) return ['pause', 'off']
  if (task.phase === 'awaiting-approval') return ['approve', 'pause', 'off']
  if (task.phase === 'paused' || task.phase === 'reviewing' || !armed) return ['resume', 'off']
  return ['pause', 'off']
}
