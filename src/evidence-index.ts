/** Locators over a fixed Session prefix; a locator alone is never citable evidence. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { eventText, textPage } from './evidence.ts'
import { evidenceScopeFrom, type EvidenceScope } from './review-scope.ts'
import type { ReviewScope } from './review-scope-schema.ts'
import { EvidenceReadError } from './evidence-read.ts'
export interface EvidenceIndexQuery { fromSeq?: number; limit?: number; types?: string[]; tool?: string; errorsOnly?: boolean; scope?: EvidenceScope | undefined; taskId?: string | undefined; nodeId?: string | undefined; attempt?: number | undefined }
export function taskEvidenceIndex(events: readonly SessionEvent[], cutoff: number, query: EvidenceIndexQuery, scope?: ReviewScope) {
  const selected = query.scope ?? (scope ? 'current-task' : 'all')
  if (query.taskId !== undefined && query.taskId !== scope?.taskId || query.nodeId !== undefined && query.nodeId !== scope?.nodeId || query.attempt !== undefined && query.attempt !== scope?.nodeAttempt) throw new EvidenceReadError({ code: 'INVALID_RANGE', field: 'task_id/node_id/attempt', validRange: JSON.stringify(scope ?? {}), nextAction: 'Use this job scope; other attempts require a separate review.' })
  const from = Math.max(query.fromSeq ?? 0, evidenceScopeFrom(scope, selected)), limit = query.limit ?? 20
  if (!Number.isSafeInteger(from) || from < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 50) throw new EvidenceReadError({ code: 'INVALID_RANGE', field: 'from_seq/limit', validRange: 'nonnegative from_seq and limit 1–50', nextAction: 'Use nextSeq and a limit of at most 50.' })
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
    if (event.seq < from || selected === 'earlier-context' && scope?.taskFromSeq !== null && scope?.taskFromSeq !== undefined && event.seq >= scope.taskFromSeq || query.types?.length && !query.types.includes(event.type)) continue
    const callId = event.type === 'tool/call' ? event.data.callId : event.type === 'tool/result' ? event.data.message.source.callId : null
    const pairKey = event.type === 'tool/call' || event.type === 'tool/result' ? key(event.data.turn, event.data.step, callId!) : null
    const call = pairKey ? calls.get(pairKey) : undefined, result = pairKey ? results.get(pairKey) : undefined
    const error = result?.data.message.isError === true
    if (query.tool && call?.data.name !== query.tool || query.errorsOnly && !error) continue
    const page = textPage(eventText(event), 0, 700)
    rows.push({ seq: event.seq, type: event.type, callId, name: call?.data.name ?? null,
      callSeq: call?.seq ?? null, resultSeq: result?.seq ?? null, error,
      summary: page.text, truncated: page.truncated, totalChars: page.totalChars, citationReady: false,
      ...scope ? { taskId: scope.taskId, nodeId: scope.nodeId, attempt: scope.nodeAttempt, attribution: event.seq < (scope.taskFromSeq ?? 0) ? 'needs-check' : 'current-window' } : {} })
    if (rows.length > limit) break
  }
  const more = rows.length > limit
  return { cutoff, entries: rows.slice(0, limit), nextSeq: more ? rows[limit]!.seq : null }
}
