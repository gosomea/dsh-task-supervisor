/** Rebuild review attribution from durable records, never from nearby timestamps. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { controlEvent } from './session-records.ts'
import { taskSchema, type TaskSnapshot } from './state-schema.ts'
const TASK_NAMESPACE = 'dsh-task-supervisor'
import { runsOf } from './graph.ts'

import type { ReviewScope } from './review-scope-schema.ts'
export type EvidenceScope = 'current-task' | 'current-attempt' | 'changes' | 'earlier-context' | 'all'

export function buildReviewScope(events: readonly SessionEvent[], task: TaskSnapshot, nodeId: string, cutoff: number, mainSessionId: string): ReviewScope {
  const prefix = events.map(controlEvent).filter(event => event.seq <= cutoff)
  const states = prefix.flatMap(event => {
    if (event.type !== 'extension/record' || event.data.namespace !== TASK_NAMESPACE || event.data.kind !== 'state') return []
    const parsed = taskSchema.safeParse(event.data.payload)
    return parsed.success && parsed.data.id === task.id ? [{ seq: event.seq, task: parsed.data }] : []
  })
  const first = states[0]?.seq ?? null
  const run = runsOf(task).find(run => run.id === nodeId)
  const sources: ReviewScope['sources'] = []
  for (const event of prefix) {
    if (event.type !== 'user/message' || event.data.source.kind !== 'user') continue
    const request = task.creationRequestId === `entry:${mainSessionId}:${event.data.id}`
      || task.creationRequestId === `main-task:${mainSessionId}:${event.seq}`
    const referenced = task.criteria.some(item => item.provenance?.sourceSeq === event.seq && item.provenance.kind === 'user')
    if (request || referenced || first !== null && event.seq < first) sources.push({ seq: event.seq,
      relation: request ? 'request' : referenced ? 'referenced-constraint' : 'earlier-context', attribution: request || referenced ? 'bound' : 'needs-check' })
  }
  const requestSeq = sources.find(source => source.relation === 'request')?.seq
  const prior = prefix.findLast(event => event.type === 'extension/record' && event.data.namespace === 'dsh-task-supervisor-review'
    && event.data.kind === 'job' && typeof event.data.payload === 'object' && event.data.payload !== null
    && !Array.isArray(event.data.payload) && event.data.payload.taskId === task.id && event.data.payload.status === 'applied')
  return { protocol: 1, taskId: task.id, requirementsVersion: task.requirementsVersion, planVersion: task.planVersion,
    nodeId, nodeAttempt: run?.attempt ?? null, cutoff, taskFromSeq: requestSeq ?? first,
    attemptFromSeq: run?.evidenceAfterSeq ?? null, changesFromSeq: prior ? prior.seq + 1 : requestSeq ?? first, sources }
}

/** A range helps locate evidence; earlier context stays accessible without becoming a requirement. */
export function evidenceScopeFrom(scope: ReviewScope | undefined, selected: EvidenceScope): number {
  if (!scope || selected === 'all' || selected === 'earlier-context') return 0
  return (selected === 'current-attempt' ? scope.attemptFromSeq : selected === 'changes' ? scope.changesFromSeq : scope.taskFromSeq) ?? scope.taskFromSeq ?? 0
}
