/** Live progress is derived from reviewer events, not a fabricated completion percentage. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from './review-records.ts'

export interface ReviewActivity {
  jobId: string
  sessionId: string
  running: boolean
  lastSeq: number | null
  lastActivityAt: number | null
  action: 'queued' | 'reading' | 'checking' | 'deciding' | 'analysing' | 'settled'
  tool: string | null
  toolCalls: number
  reads: number
  errors: number
}
export function reviewActivity(job: ReviewJob, events: readonly SessionEvent[], running: boolean): ReviewActivity {
  const calls = new Map<string, string>()
  const value: ReviewActivity = { jobId: job.id, sessionId: job.reviewerSessionId ?? '', running,
    lastSeq: null, lastActivityAt: null, action: job.status === 'queued' ? 'queued' : 'analysing',
    tool: null, toolCalls: 0, reads: 0, errors: 0 }
  for (const event of events) {
    value.lastSeq = event.seq; value.lastActivityAt = event.time
    if (event.type === 'tool/call') {
      calls.set(event.data.callId, event.data.name); value.toolCalls++; value.tool = event.data.name
      value.action = event.data.name === 'task_review_decision' ? 'deciding' : event.data.name.startsWith('read_task')
        ? 'reading' : event.data.name === 'run_task_check' ? 'checking' : 'analysing'
    } else if (event.type === 'tool/result') {
      const name = calls.get(event.data.message.source.callId)
      if (event.data.message.isError) value.errors++
      else if (name?.startsWith('read_task')) value.reads++
      value.action = 'analysing'
    } else if (event.type === 'step/start') value.action = 'analysing'
    else if (event.type === 'turn/end') value.action = 'settled'
  }
  return value
}
