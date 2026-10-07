/** Recover only old cancellations proved to be caused by a timed-out PTC transport. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from './review-records.ts'
import { controlEvent } from './session-records.ts'

export function confirmedPtcTimeout(events: readonly SessionEvent[], job: ReviewJob): boolean {
  if (job.status !== 'failed' || job.fault?.code !== 'cancelled' || job.fault.message !== 'run_code settled') return false
  const name = { plan: 'task_submit_plan', stage: 'task_report_stage', completion: 'task_request_completion' }[job.kind as 'plan' | 'stage' | 'completion']
  if (!name) return false
  events = events.map(controlEvent)
  const dispatch = events.findLast(event => event.type === 'tool/ptc-dispatch-start'
    && event.seq <= job.cutoff && event.data.name === name)
  if (dispatch?.type !== 'tool/ptc-dispatch-start') return false
  const raw = dispatch.data.arguments
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false
  const args = raw as Record<string, unknown>
  if (job.kind === 'stage' && (args.stage_id !== job.stageId || args.evidence !== job.evidence)) return false
  if (job.kind === 'completion' && args.evidence !== job.evidence) return false
  if (job.kind === 'plan' && (JSON.stringify(args.stages) !== JSON.stringify(job.input.stages)
    || JSON.stringify(args.criteria) !== JSON.stringify(job.input.criteria))) return false
  const call = events.find(event => event.type === 'tool/call' && event.seq < dispatch.seq
    && event.data.name === 'run_code' && event.data.callId === dispatch.data.rootCallId)
  return !!call && events.some(event => event.type === 'tool/result' && event.seq > job.cutoff
    && event.data.message.source.callId === dispatch.data.rootCallId && event.data.message.isError === true
    && event.data.message.content.some(block => block.type === 'text'
      && /code run failed \(timeout\): execution deadline reached \(\d+ms\)/u.test(block.text)))
}
