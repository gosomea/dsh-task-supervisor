/** Coalesce activity triggers at native pre-step boundaries without a timer loop. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface ObservationPolicy { toolCalls: number; elapsedMs: number; consecutiveErrors: number }
export interface ObservationCursor { key: string; seq: number; time: number }

export function observationReason(events: readonly SessionEvent[], cursor: ObservationCursor,
  policy: ObservationPolicy, now: number): string | null {
  const results = events.filter(event => event.seq >= cursor.seq && event.type === 'tool/result')
  if (!results.length) return null
  let failures = 0
  for (const event of [...results].reverse()) {
    if (event.type !== 'tool/result' || event.data.message.isError !== true) break
    failures++
  }
  if (failures >= policy.consecutiveErrors) return `${failures} consecutive tool errors`
  if (results.length >= policy.toolCalls) return `${results.length} tool results since the previous observation`
  if (now - cursor.time >= policy.elapsedMs) return `${now - cursor.time} milliseconds of active work since the previous observation`
  return null
}
