/** Live progress is derived from reviewer events, not a fabricated completion percentage. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from './review-records.ts'

export interface ReviewActivity {
  jobId: string
  sessionId: string
  running: boolean
  lastSeq: number | null
  lastActivityAt: number | null
  action: 'queued' | 'reading' | 'checking' | 'deciding' | 'analysing' | 'generating' | 'settled'
  tool: string | null
  target?: string | null
  toolCalls: number
  reads: number
  errors: number
}
export function reviewActivity(job: ReviewJob, events: readonly SessionEvent[], running: boolean): ReviewActivity {
  const calls = new Map<string, string>()
  const pending = new Map<string, { name: string; target: string | null }>()
  const classify = (name: string) => name === 'task_review_decision' ? 'deciding' as const
    : name.startsWith('read_task') || ['inspect_task_artifact', 'read_review_evidence'].includes(name) ? 'reading' as const
      : ['run_review_check', 'run_task_check'].includes(name) ? 'checking' as const : 'analysing' as const
  const value: ReviewActivity = { jobId: job.id, sessionId: job.reviewerSessionId ?? '', running,
    lastSeq: null, lastActivityAt: null, action: job.status === 'queued' ? 'queued' : 'analysing',
    tool: null, toolCalls: 0, reads: 0, errors: 0 }
  for (const event of events) {
    value.lastSeq = event.seq; value.lastActivityAt = event.time
    if (event.type === 'tool/call') {
      calls.set(event.data.callId, event.data.name); value.toolCalls++; value.tool = event.data.name
      let target: string | null = null
      try {
        const args: unknown = JSON.parse(event.data.arguments)
        if (args && typeof args === 'object' && !Array.isArray(args)) {
          const fields = args as Record<string, unknown>
          if (typeof fields.path === 'string') target = fields.path.slice(0, 160)
          else if (Number.isSafeInteger(fields.seq)) target = `seq ${fields.seq}`
          else if (Number.isSafeInteger(fields.from_seq)) target = `seq ${fields.from_seq}`
        }
      } catch { /* Invalid arguments remain visible in the native tool row. */ }
      pending.set(event.data.callId, { name: event.data.name, target })
      value.action = classify(event.data.name); value.target = target
    } else if (event.type === 'tool/result') {
      const name = calls.get(event.data.message.source.callId)
      if (event.data.message.isError) value.errors++
      else if (name && classify(name) === 'reading') value.reads++
      pending.delete(event.data.message.source.callId)
      const remaining = [...pending.values()].at(-1)
      value.tool = remaining?.name ?? null; value.target = remaining?.target ?? null
      value.action = remaining ? classify(remaining.name) : 'generating'
    } else if (['turn/start', 'step/start', 'request/header'].includes(event.type) && pending.size === 0) {
      value.action = 'generating'; value.tool = null; value.target = null
    } else if (event.type === 'turn/end') { value.action = 'settled'; value.tool = null; value.target = null }
  }
  return value
}
