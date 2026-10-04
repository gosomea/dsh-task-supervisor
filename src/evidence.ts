/** Bounded views over fixed Session evidence; offsets address redacted text. */
import { controlEvent } from './session-records.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export function redact(text: string): string {
  // Named quoted assignments can also occur inside JSON-serialized argv or output.
  // Match their quote escaping level so an escaped quote inside the value cannot expose its tail.
  const assignment = /(\bapi[_-]?key(?:\\*["'])?\s*[:=]\s*)(\\*["'])/giu
  let result = '', copied = 0, match: RegExpExecArray | null
  while ((match = assignment.exec(text))) {
    const delimiter = match[2]!, quote = delimiter.at(-1)!, escaping = delimiter.length - 1
    let end = text.indexOf(quote, assignment.lastIndex)
    while (end !== -1) {
      let slashes = 0
      while (text[end - slashes - 1] === '\\') slashes++
      if (slashes >= escaping && (slashes - escaping) % (2 * (escaping + 1)) === 0) break
      end = text.indexOf(quote, end + 1)
    }
    if (end === -1) continue // A malformed unfinished value has no complete quoted assignment.
    result += text.slice(copied, match.index) + match[1]! + delimiter + '[redacted]' + delimiter
    copied = end + 1
    assignment.lastIndex = copied
  }
  result += text.slice(copied)
  return result.replace(/(Bearer\s+|\bapi[_-]?key\s*[:=]\s*|sk-)[A-Za-z0-9._-]{8,}/giu, '$1[redacted]')
}

export function textPage(text: string, offset = 0, limit = 3000) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1) {
    throw new Error('offset and limit must be nonnegative/positive integers')
  }
  const safe = redact(text)
  const end = Math.min(safe.length, offset + Math.min(limit, 6000))
  return { text: safe.slice(offset, end), offset, totalChars: safe.length,
    truncated: offset > 0 || end < safe.length, nextOffset: end < safe.length ? end : null }
}

export function eventText(event: SessionEvent): string {
  event = controlEvent(event)
  switch (event.type) {
    case 'tool/call': return event.data.arguments
    case 'extension/record': return JSON.stringify(event.data.payload)
    case 'user/message': return contentText(event.data.content)
    case 'assistant/message': return contentText(event.data.message.content)
    case 'tool/result': return contentText(event.data.message.content)
    default: return ''
  }
}

function contentText(content: readonly { type: string; text?: string }[]): string {
  return content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')
}

export function evidenceRecord(event: SessionEvent): JsonValue {
  event = controlEvent(event)
  const base = { seq: event.seq, type: event.type }
  const page = (limit: number) => textPage(eventText(event), 0, limit)
  switch (event.type) {
    case 'user/message': return { ...base, source: event.data.source.kind, ...page(1500),
      nonTextBlocks: event.data.content.filter(block => block.type !== 'text').map(block => block.type) }
    case 'assistant/message': return { ...base, ...page(1500), interrupted: event.data.interrupted === true }
    case 'tool/call': return { ...base, turn: event.data.turn, name: event.data.name, callId: event.data.callId }
    case 'tool/result': return { ...base, turn: event.data.turn, callId: event.data.message.source.callId,
      error: event.data.message.isError === true, ...page(700),
      nonTextBlocks: event.data.message.content.filter(block => block.type !== 'text').map(block => block.type) }
    case 'extension/record': return { ...base, namespace: event.data.namespace, ...page(1500) }
    case 'turn/start': return { ...base, turn: event.data.turn }
    case 'turn/end': return { ...base, turn: event.data.turn, reason: event.data.reason.kind }
    default: return base
  }
}
