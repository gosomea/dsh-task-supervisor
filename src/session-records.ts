/** Required Supervisor data carried by native, canceled Inbox messages. */
import { createUserMessage, type ContextFormed } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { z } from 'zod'

const recordSchema = z.object({ namespace: z.string().min(1), schemaVersion: z.number().int().positive(),
  kind: z.string().min(1), recordId: z.string().min(1), payload: z.json() }).strict()
export type ControlRecord = { namespace: string; schemaVersion: number; kind: string; recordId: string; payload: JsonValue }

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'task-supervisor-record': { kind: 'task-supervisor-record'; record: ControlRecord; queued?: true } & ContextFormed
  }
}
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Legacy 0.1.0 input only; new versions never append this event. */
    'extension/record': ControlRecord
  }
}

/** Persist a plugin-owned message and cancel delivery synchronously. Native Inbox
 * events retain the record without inserting messages between a tool call and result.
 * @param agent Owning native Agent.
 * @param record Complete plugin-owned record, validated before append.
 */
export function appendControlRecord(agent: Agent, record: ControlRecord) {
  const data = recordSchema.parse(record)
  const text = `Supervisor internal record: ${data.kind} (${data.namespace}, v${data.schemaVersion}).`
  const message = createUserMessage({ source: { kind: 'task-supervisor-record',
    record: data, queued: true, form: 'snapshot',
    sections: [{ name: 'task-supervisor:record', text }] }, content: [{ type: 'text', text }] })
  // append does not start a turn. No await may separate insertion and cancellation.
  agent.inbox.append('next-step', message)
  if (!agent.inbox.remove(message.id)) throw new Error('Supervisor record delivery could not be canceled.')
}

/** Normalize native carriers and legacy input for existing deterministic folds; never writes a log.
 * @param event The original persisted event, with its original sequence and timestamp.
 * @returns A fold-only record view or the unchanged event.
 */
export function controlEvent(event: SessionEvent): SessionEvent {
  const source = event.type === 'agent/inbox/spliced' && event.data.inserted.length === 1
    ? event.data.inserted[0]?.source : event.type === 'user/message' ? event.data.source : undefined
  if (source?.kind !== 'task-supervisor-record') return event
  // A claimed queued message is surface history, not a second state transition.
  if (event.type === 'user/message' && source.queued) return event
  const data = recordSchema.parse(source.record)
  return { type: 'extension/record', data, seq: event.seq, time: event.time }
}
