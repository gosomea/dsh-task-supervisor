/** Identify a settled native truncation; the controller owns authorization and delivery. */
import { createHash } from 'node:crypto'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { eventText, redact } from './evidence.ts'
import { NAMESPACE, READABLE_RECORD_VERSIONS, type TaskSnapshot } from './state.ts'
import { taskSchema } from './state-schema.ts'

export interface RecoveryBoundary {
  endSeq: number
  turn: number
  evidenceSeqs: number[]
  summary: string
  /** Novel successful tool output, not a claim that an acceptance criterion passed. */
  progressFingerprint: string
}

function recordedTask(event: SessionEvent): TaskSnapshot | null {
  if (event.type !== 'extension/record' || event.data.namespace !== NAMESPACE) return null
  if (event.data.kind !== 'state' || !READABLE_RECORD_VERSIONS.includes(event.data.schemaVersion)) return null
  const parsed = taskSchema.safeParse(event.data.payload)
  return parsed.success ? parsed.data : null
}

function continuable(task: TaskSnapshot): boolean {
  return task.enabled && task.pendingReview === null
    && (task.phase === 'planning' || task.phase === 'active' && task.everApproved)
}

/**
 * Read a complete ordered Session prefix, including this requirements version's state.
 * Inbox/live-status, durable recovery reservations and user authorization must still be
 * checked by the controller immediately before delivery. A missing prefix fails closed.
 */
export function recoveryBoundary(events: readonly SessionEvent[], task: TaskSnapshot): RecoveryBoundary | null {
  if (!continuable(task) || events.length === 0) return null
  for (let i = 0; i < events.length; i++) {
    if (!Number.isSafeInteger(events[i]!.seq) || events[i]!.seq < 0
      || i > 0 && events[i]!.seq <= events[i - 1]!.seq) return null
  }
  const end = events.findLast(event => event.type === 'turn/end')
  if (end?.type !== 'turn/end' || end.data.reason.kind !== 'max-tokens') return null
  const start = events.findLast(event => event.type === 'turn/start' && event.seq < end.seq)
  if (start?.type !== 'turn/start' || start.data.turn !== end.data.turn) return null
  if (events.some(event => event.seq > end.seq
    && ['user/message', 'developer/message', 'turn/start', 'step/start', 'step/end',
      'assistant/message', 'assistant/attempt', 'tool/call', 'tool/result'].includes(event.type))) return null

  let before: TaskSnapshot | null = null, latest: TaskSnapshot | null = null, epoch = -1
  for (const event of events) {
    if (event.type !== 'extension/record' || event.data.namespace !== NAMESPACE) continue
    const state = recordedTask(event)
    if (state === null) return null
    latest = state
    const matches = state.id === task.id && state.requirementsVersion === task.requirementsVersion
    if (event.seq < start.seq) {
      before = state
      if (!matches) epoch = -1
      else if (epoch < 0) epoch = event.seq
    } else if (!matches || !continuable(state) || state.phase !== task.phase) return null
  }
  if (before === null || latest === null || epoch < 0 || !continuable(before)
    || before.id !== task.id || before.requirementsVersion !== task.requirementsVersion
    || before.phase !== task.phase || before.revision > task.revision
    || latest.id !== task.id || latest.requirementsVersion !== task.requirementsVersion
    || latest.revision !== task.revision || latest.phase !== task.phase || !continuable(latest)) return null

  const openSteps = new Set<number>()
  const closedSteps = new Set<number>()
  for (const event of events) {
    if (event.seq <= start.seq || event.seq >= end.seq) continue
    if (event.type === 'turn/start' || event.type === 'turn/end') return null
    if (event.type === 'tool/call' || event.type === 'tool/result'
      || event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      if (event.data.turn !== end.data.turn || !openSteps.has(event.data.step)) return null
    }
    if (event.type !== 'step/start' && event.type !== 'step/end') continue
    if (event.data.turn !== end.data.turn) return null
    const step = event.data.step
    if (!Number.isSafeInteger(step) || step < 1) return null
    if (event.type === 'step/start') {
      if (openSteps.size || closedSteps.has(step)) return null
      openSteps.add(step)
    } else {
      if (!openSteps.delete(step)) return null
      closedSteps.add(step)
    }
  }
  if (openSteps.size || closedSteps.size === 0) return null
  const assistant = events.findLast(event => event.seq > start.seq && event.seq < end.seq
    && (event.type === 'assistant/message' || event.type === 'assistant/attempt'))
  if (assistant?.type !== 'assistant/message' || assistant.data.interrupted === true
    || assistant.data.turn !== end.data.turn || !closedSteps.has(assistant.data.step)
    || assistant.data.step !== [...closedSteps].reduce((maximum, step) => Math.max(maximum, step), 0)) return null
  const finishes = assistant.data.stream.filter(record => record.type === 'chunk' && record.chunk.type === 'finish')
  if (finishes.length !== 1 || finishes[0]?.type !== 'chunk'
    || finishes[0].chunk.type !== 'finish' || finishes[0].chunk.reason.kind !== 'max-tokens') return null
  // A sticky turn reason does not authorize replay after later successful work.
  if (events.some(event => event.seq > assistant.seq && event.seq < end.seq
    && (event.type === 'tool/call' || event.type === 'tool/result'))) return null

  const calls = new Map<string, Extract<SessionEvent, { type: 'tool/call' }>>()
  const seenCalls = new Set<string>()
  const outputs = new Map<string, { seq: number; name: string; text: string }>()
  for (const event of events) {
    if (event.seq < epoch || event.seq > end.seq) continue
    if (event.type === 'tool/call') {
      if (seenCalls.has(event.data.callId)) return null
      seenCalls.add(event.data.callId)
      calls.set(event.data.callId, event)
    } else if (event.type === 'tool/result') {
      const call = calls.get(event.data.message.source.callId)
      if (!call || call.data.turn !== event.data.turn || call.data.step !== event.data.step) return null
      calls.delete(event.data.message.source.callId)
      if (event.data.message.isError === true || call.data.name.startsWith('task_')) continue
      const text = redact(eventText(event)).trim()
      if (!text) continue
      // IDs, sequence numbers and repeated reads are not progress. Keep the latest
      // evidence reference for each distinct successful tool's reported output.
      const identity = JSON.stringify([call.data.name, text])
      outputs.set(identity, { seq: event.seq, name: call.data.name, text })
    }
  }
  if (calls.size) return null
  const fingerprint = createHash('sha256').update(JSON.stringify([...outputs.keys()].sort())).digest('hex')
  const all = [...outputs.values()].sort((a, b) => a.seq - b.seq)
  const selected = all.slice(-8)
  const lines = selected.map(item => `seq ${item.seq} · ${redact(item.name).slice(0, 64)}: ${item.text.slice(0, 220)}${item.text.length > 220 ? '…' : ''}`)
  if (all.length > selected.length) lines.unshift(`省略 ${all.length - selected.length} 项较早的不同工具结果；请通过 Session 证据读取入口查看。`)
  if (!lines.length) lines.push('没有可核实的新工具输出；被截断的推理不代表工具已执行或文件已修改。')
  return { endSeq: end.seq, turn: end.data.turn, evidenceSeqs: selected.map(item => item.seq),
    summary: lines.join('\n'), progressFingerprint: fingerprint }
}
