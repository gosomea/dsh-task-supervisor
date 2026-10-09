/** Continuation describes only the review belonging to this Task and effective decision. */
import type { ReviewJob } from './review-schema.ts'
import type { TaskSnapshot } from './state.ts'
import { readyNodes } from './graph.ts'

export function reviewHandoff(task: TaskSnapshot, job?: ReviewJob): string | null {
  if (!job?.decision || job.taskId !== task.id || task.lastReview?.jobId !== job.id) return null
  const compact = (text: string) => text.length > 500 ? `${text.slice(0, 500)}… [partial; open the full review record]` : text
  const results = job.decision.requirements ?? []
  return JSON.stringify({ jobId: job.id, kind: job.kind, nodeId: job.stageId, nodeAttempt: job.nodeAttempt,
    taskId: job.taskId, requirementsVersion: job.input.requirementsVersion, planVersion: job.planVersion, cutoff: job.cutoff,
    mode: job.verification ? 'independent' : 'log', applied: job.status === 'applied',
    confirmed: results.filter(item => item.status === 'satisfied').map(item => ({ id: item.id, requirement: compact(item.requirement), coverage: compact(item.coverage) })),
    pending: results.filter(item => item.status !== 'satisfied').map(item => ({ id: item.id, requirement: compact(item.requirement), status: item.status,
      basis: item.basis, revision: compact(item.finding), limitations: compact(item.limitations) })),
    evidence: results.map(item => ({ requirementId: item.id, references: item.evidence.map(evidence => evidence.kind === 'session'
      ? { kind: evidence.kind, seq: evidence.seq, ranges: evidence.ranges, total: evidence.total, truncated: evidence.truncated }
      : evidence.kind === 'artifact' ? { kind: evidence.kind, snapshotId: evidence.snapshotId, path: evidence.path, hash: evidence.hash }
        : { kind: evidence.kind, snapshotId: evidence.snapshotId, checkId: evidence.checkId }) })),
    readyNodes: readyNodes(task), taskPhase: task.phase, verdict: job.decision.verdict,
    revisions: compact(job.decision.finding), legacyCoverage: job.decision.requirements === undefined,
  })
}
