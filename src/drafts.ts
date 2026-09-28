/** Versioned proposals; promotion commits authoritative requirements to the main Session. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'

export const DRAFT_NAMESPACE = 'dsh-task-supervisor-draft'
export const draftSchema = z.object({
  id: z.string().uuid(), version: z.number().int().positive(), mainSessionId: z.string(),
  title: z.string().min(1).max(100), requirements: z.string().min(1).max(10000),
  questions: z.array(z.string()).max(10), language: z.string(),
  sourceSessionId: z.string(), sourceUserSeq: z.number().int().nonnegative(),
  status: z.enum(['draft', 'creating', 'created']), taskId: z.string().uuid().nullable(),
  creationId: z.string().nullable(), updatedAt: z.string(),
}).strict()
export type TaskDraft = z.infer<typeof draftSchema>

export function foldDraft(current: TaskDraft | null, event: SessionEvent): TaskDraft | null {
  if (event.type !== 'extension/record' || event.data.namespace !== DRAFT_NAMESPACE) return current
  if (event.data.schemaVersion !== 1 || event.data.kind !== 'draft') throw new Error('unsupported task draft record')
  const next = draftSchema.parse(event.data.payload)
  if (current?.id === next.id && next.version !== current.version + 1) throw new Error('draft versions must be contiguous')
  if (current?.id !== next.id && next.version !== 1) throw new Error('new draft must start at version one')
  return next
}

export function draftOf(ctx: Context, main: Agent): TaskDraft | null {
  const projection = ctx.sessionProjections.stateOf(main.session, 'taskSupervisor')
  if (projection?.failure) throw new Error(projection.failure)
  const draft = projection?.draft ?? null
  // A fork inherits historical proposals, not permission to promote its parent's draft.
  return draft?.mainSessionId === main.id ? draft : null
}

export async function recordDraft(ctx: Context, main: Agent, draft: TaskDraft): Promise<TaskDraft> {
  const parsed = draftSchema.parse(draft)
  main.session.append('extension/record', { namespace: DRAFT_NAMESPACE, schemaVersion: 1, kind: 'draft',
    recordId: `${draft.id}:${draft.version}`, payload: JSON.parse(JSON.stringify(parsed)) as JsonValue })
  if (!await ctx.sessions.flush(main.session)) throw new Error('draft is not durable')
  return parsed
}
