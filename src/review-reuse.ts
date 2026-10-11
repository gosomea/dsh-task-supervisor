/** Reuse raw execution evidence only when its complete execution world and scope still match. */
import { z } from 'zod'
import type { ReviewJob } from './review-schema.ts'
import type { ReviewCheck } from './review-check-plan.ts'
import { affectedNodes, runsOf } from './graph.ts'

export const reusedCheckSchema = z.object({ checkId: z.string().uuid(), plannedCheckId: z.string(),
  sourceJobId: z.string().uuid(), sourceSessionId: z.string(), sourceNodeId: z.string(), sourceAttempt: z.number().int().positive(),
  sourceSnapshotId: z.string().uuid(), sourceRoot: z.string(), digest: z.string(),
  importedAt: z.string(), method: z.literal('run'), scope: z.string() }).strict()

/** No historical finding, report or verdict is returned to the reviewer. */
export function reusableChecks(job: ReviewJob, prior: readonly ReviewJob[], planned: ReviewCheck, image?: string) {
  if (planned.method !== 'run' || !job.verification) return []
  return prior.flatMap(source => {
    const state = source.verification, run = runsOf(job.input).find(run => run.id === source.stageId)
    if (source.id === job.id || source.taskId !== job.taskId || source.mainSessionId !== job.mainSessionId
      || source.planVersion !== job.planVersion || source.input.requirementsVersion !== job.input.requirementsVersion
      || source.kind !== 'stage' || source.status !== 'applied' || source.decision?.verdict !== 'pass'
      || !run || run.status !== 'passed' || run.attempt !== source.nodeAttempt || !source.reviewerSessionId
      || !state || state.snapshot.digest !== job.verification!.snapshot.digest
      || state.snapshot.workspace !== job.verification!.snapshot.workspace
      || JSON.stringify(state.snapshot.excluded) !== JSON.stringify(job.verification!.snapshot.excluded)
      || job.kind !== 'completion' && !affectedNodes(job.input, [source.stageId]).includes(job.stageId)) return []
    const compatible = state.checkPlan?.flatMap(revision => revision.checks).filter(check =>
      check.method === planned.method && check.fact === planned.fact && check.expected === planned.expected
      && check.coverage === planned.coverage && check.basis === planned.basis && JSON.stringify(check.source) === JSON.stringify(planned.source)) ?? []
    const evidence = compatible.flatMap(check => source.decision!.checks?.find(result => result.checkId === check.id)?.evidenceIds ?? [])
    return state.checks.filter(check => evidence.includes(check.id) && check.snapshotId === state.snapshot.id
      && check.runtime?.image === image && !check.changed.length && !check.timedOut && !check.cancelled && !check.outputIncomplete)
      .map(check => ({ source, check }))
  })
}
