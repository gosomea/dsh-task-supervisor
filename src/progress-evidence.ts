/** Evidence novelty is not acceptance. Duplicate reads and model claims do not advance it. */
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { TaskSnapshot } from './state-schema.ts'
import { taskSchema } from './state-schema.ts'
import { controlEvent } from './session-records.ts'
import { eventText, redact } from './evidence.ts'

export function planningEvidenceFingerprint(events: readonly SessionEvent[], task: TaskSnapshot, cutoff: number): { fingerprint: string; hasEvidence: boolean } {
  events = events.map(controlEvent).filter(event => event.seq <= cutoff)
  let epoch = -1
  for (const event of events) {
    if (event.type !== 'extension/record' || event.data.namespace !== 'dsh-task-supervisor' || event.data.kind !== 'state') continue
    const state = taskSchema.safeParse(event.data.payload)
    if (!state.success) throw new Error('invalid Task evidence epoch')
    if (state.data.id !== task.id || state.data.requirementsVersion !== task.requirementsVersion) epoch = -1
    else if (epoch < 0) epoch = event.seq
  }
  const calls = new Map<string, Extract<SessionEvent, { type: 'tool/call' }>>()
  const outputs = new Set<string>()
  for (const event of events) {
    if (event.seq <= epoch || epoch < 0) continue
    if (event.type === 'tool/call') calls.set(event.data.callId, event)
    else if (event.type === 'tool/result') {
      const call = calls.get(event.data.message.source.callId)
      calls.delete(event.data.message.source.callId)
      if (!call || event.data.message.isError || call.data.name.startsWith('task_')
        || call.data.turn !== event.data.turn || call.data.step !== event.data.step) continue
      const text = redact(eventText(event)).trim()
      if (text) outputs.add(JSON.stringify([call.data.name, text]))
    }
  }
  return { fingerprint: createHash('sha256').update(JSON.stringify([...outputs].sort())).digest('hex'), hasEvidence: outputs.size > 0 }
}
