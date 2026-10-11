/** Delivery is requirement-specific: artifacts and actions have different actual receipts. */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ReviewJob } from './review-schema.ts'
import type { RequirementResult } from './review-results.ts'
import { runsOf } from './graph.ts'
import { controlEvent } from './session-records.ts'
import { complete } from './read-coverage.ts'

export function validateDelivery(job: ReviewJob, requirements: RequirementResult[] | undefined, events: readonly SessionEvent[]): void {
  if (job.kind !== 'completion') return
  if (runsOf(job.input).some(run => run.status !== 'passed') || !job.input.stages.length) throw new Error('Completion needs every current DAG attempt passed')
  const results = requirements ?? []
  for (const criterion of job.input.criteria.filter(criterion => criterion.delivery)) {
    if (!results.some(result => result.criterionId === criterion.id && result.delivery === criterion.delivery && result.status === 'satisfied')) throw new Error(`Delivery requirement ${criterion.id} needs a current satisfied delivery result`)
  }
  events = events.map(controlEvent)
  for (const result of results.filter(result => result.delivery && result.basis === 'explicit')) {
    if (result.status !== 'satisfied') throw new Error('Requested delivery is not verified')
    if (result.delivery === 'artifact' && job.verification) {
      if (!result.evidence.some(evidence => evidence.kind === 'artifact' && evidence.snapshotId === job.verification!.snapshot.id
        || evidence.kind === 'check' && (evidence.snapshotId === job.verification!.snapshot.id || evidence.reusedForSnapshotId === job.verification!.snapshot.id))) throw new Error('Artifact delivery needs current inspected snapshot evidence')
    } else {
      // This ensures receipt provenance. The reviewer must still check content, paths, remote and semantics.
      const receipt = result.evidence.some(evidence => {
        if (evidence.kind !== 'session' || evidence.truncated || !complete(evidence.ranges, evidence.total)) return false
        const event = events.find(event => event.seq === evidence.seq)
        if (event?.type !== 'tool/result' || event.data.message.isError) return false
        const call = events.find(call => call.type === 'tool/call' && call.data.callId === event.data.message.source.callId)
        return call?.type === 'tool/call' && !call.data.name.startsWith('task_') && call.data.turn === event.data.turn && call.data.step === event.data.step
          && call.seq < event.seq && event.seq <= job.cutoff
      })
      if (!receipt) throw new Error('Requested delivery needs a fully read actual successful native operation receipt; claims are insufficient')
    }
  }
}
