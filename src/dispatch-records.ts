/** A continuation's durable identity precedes its Inbox effect, for every Task. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { appendControlRecord, controlEvent } from './session-records.ts'
import type { TaskSnapshot } from './state.ts'

const namespace = 'dsh-task-supervisor-dispatch'
const schema = z.object({ id: z.string(), taskId: z.string().uuid(), requirementsVersion: z.number().int().positive(),
  taskRevision: z.number().int().positive(), digest: z.string(), status: z.enum(['reserved', 'confirmed']), at: z.string() }).strict()
type Dispatch = z.infer<typeof schema>

export function dispatches(events: readonly SessionEvent[]): Dispatch[] {
  const records = new Map<string, Dispatch>()
  for (const original of events) {
    const event = controlEvent(original)
    if (event.type !== 'extension/record' || event.data.namespace !== namespace) continue
    if (event.data.schemaVersion !== 1 || event.data.kind !== 'dispatch') throw new Error('unsupported dispatch record')
    const record = schema.parse(event.data.payload), previous = records.get(record.id)
    if (previous && (previous.status !== 'reserved' || record.status !== 'confirmed'
      || previous.taskId !== record.taskId || previous.taskRevision !== record.taskRevision
      || previous.requirementsVersion !== record.requirementsVersion || previous.digest !== record.digest)) throw new Error('dispatch identity changed')
    if (!previous && record.status !== 'reserved') throw new Error('dispatch must be reserved first')
    records.set(record.id, record)
  }
  return [...records.values()]
}

function handedOff(agent: Agent, id: string): boolean {
  return [...agent.inbox.nextStep, ...agent.inbox.nextTurn].some(message => message.id === id)
    || agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.id === id
      || event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.id === id))
}

/** Requires the caller's native maintenance lock and current permission checks. */
export async function deliverContinuation(ctx: Context, agent: Agent, task: TaskSnapshot, message: UserMessage,
  signal: AbortSignal, valid: () => boolean): Promise<void> {
  const digest = createHash('sha256').update(JSON.stringify(message)).digest('hex')
  const previous = dispatches(agent.session.snapshotEvents()).find(record => record.id === message.id)
  const record: Dispatch = previous ?? { id: message.id, taskId: task.id, taskRevision: task.revision,
    requirementsVersion: task.requirementsVersion, digest, status: 'reserved', at: new Date().toISOString() }
  if (record.digest !== digest || record.taskId !== task.id || record.taskRevision !== task.revision) throw new Error('dispatch binding changed')
  if (record.status === 'confirmed') return
  const append = async (value: Dispatch) => {
    appendControlRecord(agent, { namespace, schemaVersion: 1, kind: 'dispatch', recordId: `${value.id}:${value.status}`, payload: value })
    if (!await ctx.sessions.flush(agent.session)) throw new Error('continuation record is not durable')
  }
  if (!previous) await append(record)
  signal.throwIfAborted()
  if (!valid()) throw new Error('task changed before continuation handoff')
  // An uncertain prior effect is reconciled by its exact identity, never reissued.
  if (previous && !handedOff(agent, message.id)) throw new Error('SUPERVISOR_DISPATCH_UNKNOWN: inspect the original action before resuming')
  if (!previous) agent.followup(message)
  try {
    if (!await ctx.sessions.flush(agent.session)) throw new Error('continuation Inbox is not durable')
    signal.throwIfAborted()
    if (!valid()) throw new Error('task changed during continuation handoff')
    await append({ ...record, status: 'confirmed', at: new Date().toISOString() })
  } catch (error) {
    agent.inbox.remove(message.id)
    throw error
  }
}
