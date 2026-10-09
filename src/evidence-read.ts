/** Structured bounded original reads, shared by single and batch readers. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { eventText, redact, textPage } from './evidence.ts'
export class EvidenceReadError extends Error {
  constructor(readonly detail: { code: 'INVALID_RANGE' | 'NOT_LOCATED' | 'NOT_FOUND' | 'WRONG_TYPE'; field: string; validRange: string; nextAction: string }) {
    super(JSON.stringify({ error: 'EVIDENCE_READ_CORRECTION', ...detail }))
  }
}
/** Only plugin-generated argument/locator failures qualify; unknown and denied reads do not. */
export function readCorrectionDetail(text: string): EvidenceReadError['detail'] | null {
  const start = text.indexOf('{"error":"EVIDENCE_READ_CORRECTION"')
  if (start < 0) return null
  try {
    const value = JSON.parse(text.slice(start))
    if (!['INVALID_RANGE', 'NOT_LOCATED', 'NOT_FOUND', 'WRONG_TYPE'].includes(value.code)
      || !['field', 'validRange', 'nextAction'].every(key => typeof value[key] === 'string')) return null
    return { code: value.code, field: value.field, validRange: value.validRange, nextAction: value.nextAction }
  } catch { return null }
}
export function originalEvidenceRead(event: SessionEvent | undefined, input: { seq: number; offset?: number | undefined; limit?: number | undefined; kind?: 'call' | 'text' | undefined }, cutoff: number, located: boolean) {
  const fail = (code: EvidenceReadError['detail']['code'], field: string, validRange: string, nextAction: string): never => { throw new EvidenceReadError({ code, field, validRange, nextAction }) }
  if (!Number.isSafeInteger(input.seq) || input.seq < 0 || input.seq > cutoff) fail('INVALID_RANGE', 'seq', `0..${cutoff}`, 'Select a seq from the bound evidence index.')
  if (!located) fail('NOT_LOCATED', 'seq', `located original events up to ${cutoff}`, 'Read the index or containing evidence page first.')
  if (!event || event.seq !== input.seq || event.seq > cutoff) return fail('NOT_FOUND', 'seq', `persisted original events up to ${cutoff}`, 'Select another seq from the bound evidence index.')
  if (input.kind === 'call' && event.type !== 'tool/call') fail('WRONG_TYPE', 'kind', 'call for tool/call; text for other events', 'Use read_task_text for this event.')
  const offset = input.offset ?? 0, limit = input.limit ?? 3000, length = redact(eventText(event)).length
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length) fail('INVALID_RANGE', 'offset', `0..${length}`, 'Use the previous page nextOffset or zero.')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 6000) fail('INVALID_RANGE', 'limit', '1..6000', 'Request at most 6000 redacted characters.')
  return { seq: event.seq, type: event.type, ...textPage(eventText(event), offset, limit),
    ...event.type === 'tool/call' ? { turn: event.data.turn, name: event.data.name } : {} }
}

export const originalReadRange = (value: { offset: number; text: string; totalChars: number }) => ({
  start: value.offset, end: value.offset + value.text.length, total: value.totalChars,
})
