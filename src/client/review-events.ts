/** One native conversation node per durable review job, including idle-time reviews. */
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { reviewJobSchema, type ReviewJob } from '../review-schema.ts'

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap { 'task-supervisor-review': ReviewJob }
}

type Event = Parameters<ConversationNodeDefinition['match']>[0]
interface State { readonly anchorSeq: number; readonly job: ReviewJob }
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Canceled native Inbox carriers remain authoritative; claimed messages are not duplicates. */
export function reviewFromEvent(event: Pick<Event, 'type' | 'data'>): ReviewJob | undefined {
  const data = object(event.data)
  let record: Record<string, unknown> | undefined
  if (event.type === 'extension/record') record = data
  else if (event.type === 'agent/inbox/spliced' && Array.isArray(data?.inserted) && data.inserted.length === 1) {
    const source = object(object(data.inserted[0])?.source)
    if (source?.kind === 'task-supervisor-record') record = object(source.record)
  } else if (event.type === 'user/message') {
    const source = object(data?.source)
    if (source?.kind === 'task-supervisor-record' && source.queued !== true) record = object(source.record)
  }
  if (record?.namespace !== 'dsh-task-supervisor-review' || record.kind !== 'job') return undefined
  const parsed = reviewJobSchema.safeParse(record.payload)
  return parsed.success ? parsed.data : undefined
}

export const reviewDefinition: ConversationNodeDefinition<State> = {
  kind: 'task-supervisor-review', target: 'chat',
  match(event) {
    const job = reviewFromEvent(event)
    return job ? { id: job.id, role: job.revision === 1 ? 'start' : 'update' } : null
  },
  start(_context, match) {
    const job = reviewFromEvent(match.event)
    if (!job) throw new Error('Review node requires a durable review record')
    return { anchorSeq: match.event.seq, job }
  },
  update(context, match) {
    const job = reviewFromEvent(match.event)
    return job && job.revision > context.state.job.revision ? { ...context.state, job } : context.state
  },
  buildViewNode(context) {
    const first = context.matches[0]
    const job = context.state?.job ?? (context.matches.at(-1) && reviewFromEvent(context.matches.at(-1)!.event))
    if (!first || !job || !job.reviewerSessionId) return null
    return { key: context.key, id: context.id, target: 'chat', kind: 'task-supervisor-review',
      anchorSeq: context.state?.anchorSeq ?? first.event.seq,
      // A sidecar can outlive the primary Turn; its disclosure must not fold with that Turn.
      location: { kind: 'unresolved' }, visibility: 'visible', data: job }
  },
}
