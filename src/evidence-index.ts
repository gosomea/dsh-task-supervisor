/** Locators over a fixed Session prefix; a locator alone is never citable evidence. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { eventText, textPage } from './evidence.ts'
export interface EvidenceIndexQuery { fromSeq?: number; limit?: number; types?: string[]; tool?: string; errorsOnly?: boolean }
export function taskEvidenceIndex(events: readonly SessionEvent[], cutoff: number, query: EvidenceIndexQuery) {
  const from = query.fromSeq ?? 0, limit = query.limit ?? 20
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new Error('index requires nonnegative from_seq and limit 1–50')
  const prefix = events.filter(event => event.seq <= cutoff)
  const calls = new Map<string, Extract<SessionEvent, { type: 'tool/call' }>>()
  const results = new Map<string, Extract<SessionEvent, { type: 'tool/result' }>>()
  const key = (turn: number, step: number, id: string) => `${turn}:${step}:${id}`
  for (const event of prefix) {
    if (event.type === 'tool/call') calls.set(key(event.data.turn, event.data.step, event.data.callId), event)
    if (event.type === 'tool/result') results.set(key(event.data.turn, event.data.step, event.data.message.source.callId), event)
  }
  const rows = []
  for (const event of prefix) {
    if (event.seq < from || query.types?.length && !query.types.includes(event.type)) continue
    const callId = event.type === 'tool/call' ? event.data.callId : event.type === 'tool/result' ? event.data.message.source.callId : null
    const pairKey = event.type === 'tool/call' || event.type === 'tool/result' ? key(event.data.turn, event.data.step, callId!) : null
    const call = pairKey ? calls.get(pairKey) : undefined, result = pairKey ? results.get(pairKey) : undefined
    const error = result?.data.message.isError === true
    if (query.tool && call?.data.name !== query.tool || query.errorsOnly && !error) continue
    const page = textPage(eventText(event), 0, 700)
    rows.push({ seq: event.seq, type: event.type, callId, name: call?.data.name ?? null,
      callSeq: call?.seq ?? null, resultSeq: result?.seq ?? null, error,
      summary: page.text, truncated: page.truncated, totalChars: page.totalChars, citationReady: false })
    if (rows.length > limit) break
  }
  const more = rows.length > limit
  return { cutoff, entries: rows.slice(0, limit), nextSeq: more ? rows[limit]!.seq : null }
}
