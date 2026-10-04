/** Completed-task repair proposals and deterministic acceptance-cycle transitions. */
import { controlEvent } from './session-records.ts'
import { z } from 'zod'
import { HarnessError } from '@deepseek-ai/dsh-llm'
import { affectedNodes, runsOf, withRuns } from './graph.ts'
import { type TaskSnapshot } from './state-schema.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export const REPAIR_NAMESPACE = 'dsh-task-supervisor-repair'
export const artifactStampSchema = z.object({
  workspaceKey: z.string().min(1), digest: z.string().regex(/^[a-f0-9]{64}$/u),
  files: z.number().int().nonnegative(), bytes: z.number().int().nonnegative(),
}).strict()
export const repairProposalSchema = z.object({
  id: z.string().uuid(), taskId: z.string().uuid(), taskRevision: z.number().int().positive(),
  source: z.enum(['main-agent', 'consultation', 'user']).optional(), proposerSessionId: z.string().optional(),
  title: z.string().trim().min(1).max(120), reason: z.string().trim().min(1).max(10000),
  rootNodeIds: z.array(z.string().min(1)).min(1), affectedNodeIds: z.array(z.string().min(1)).min(1),
  evidenceSeqs: z.array(z.number().int().nonnegative()), artifact: artifactStampSchema,
  proposedAt: z.string(), proposedSeq: z.number().int().nonnegative(),
  status: z.enum(['pending', 'confirmed', 'applied', 'declined', 'superseded']),
  confirmedAt: z.string().optional(), confirmationSeq: z.number().int().nonnegative().optional(),
}).strict()
export type RepairProposal = z.infer<typeof repairProposalSchema>
export type ArtifactStamp = z.infer<typeof artifactStampSchema>

export class TaskActionError extends HarnessError {
  constructor(override readonly code: string, message: string) { super(`${code}: ${message}`, code) }
}

/** The proposal fixes a particular impact set; stale plans cannot broaden it at confirmation. */
export function repairImpact(task: TaskSnapshot, roots: readonly string[]): string[] {
  if (task.phase !== 'complete') throw new TaskActionError('TASK_NOT_COMPLETE', 'Only completed tasks use repair proposals.')
  if (!roots.length || new Set(roots).size !== roots.length) throw new TaskActionError('INVALID_REPAIR_SCOPE', 'Select distinct affected root nodes.')
  return affectedNodes(task, roots)
}

export function reopenTask(task: TaskSnapshot, proposal: RepairProposal, evidenceAfterSeq: number): TaskSnapshot {
  if (proposal.status !== 'confirmed' || proposal.confirmationSeq === undefined || !proposal.confirmedAt) {
    throw new TaskActionError('REPAIR_CONFIRMATION_REQUIRED', 'Click the impact proposal confirmation in the task panel.')
  }
  if (task.id !== proposal.taskId || task.revision !== proposal.taskRevision
    || JSON.stringify(repairImpact(task, proposal.rootNodeIds)) !== JSON.stringify(proposal.affectedNodeIds)) {
    throw new TaskActionError('REPAIR_STALE', 'Refresh the impact proposal before confirming.')
  }
  if (!task.enabled) throw new TaskActionError('SUPERVISOR_DISABLED', 'Enable supervision explicitly before confirming.')
  const cycle = task.acceptanceCycle ?? 1
  const affected = new Set(proposal.affectedNodeIds)
  return withRuns({ ...task, revision: task.revision + 1, phase: 'active', acceptanceCycle: cycle + 1,
    reopenedFromProposalId: proposal.id, roundsSinceReview: 0, pendingReview: null, lastReview: null,
    reviewFault: null, pauseReason: null,
    repairHistory: [...task.repairHistory ?? [], {
      proposalId: proposal.id, previousCycle: cycle, previousReview: task.lastReview,
      previousRuns: runsOf(task), completedAt: task.completedAt ?? null,
      rootNodeIds: proposal.rootNodeIds, affectedNodeIds: proposal.affectedNodeIds,
      reason: proposal.reason, confirmedAt: proposal.confirmedAt, confirmationSeq: proposal.confirmationSeq,
    }], completedAt: undefined,
  }, runsOf(task).map(run => affected.has(run.id)
    ? { id: run.id, attempt: run.attempt + 1, status: 'pending', evidenceAfterSeq } : run))
}

export function foldRepairs(current: RepairProposal[], event: SessionEvent): RepairProposal[] {
  event = controlEvent(event)
  if (event.type !== 'extension/record' || event.data.namespace !== REPAIR_NAMESPACE) return current
  if (event.data.schemaVersion !== 1) throw new Error('unsupported repair record')
  if (event.data.kind === 'proposal') {
    const next = repairProposalSchema.parse(event.data.payload)
    if (next.status !== 'pending' || next.proposedSeq !== event.seq || current.some(p => p.id === next.id)) throw new Error('invalid new repair proposal')
    return [...current.map(p => p.status === 'pending' || p.status === 'confirmed' ? { ...p, status: 'superseded' as const } : p), next].slice(-50)
  }
  const decision = z.object({ proposalId: z.string().uuid(), taskId: z.string().uuid(), taskRevision: z.number().int().positive(),
    source: z.literal('web-confirmation'), confirmedAt: z.string() }).strict().parse(event.data.payload)
  const proposal = current.find(p => p.id === decision.proposalId)
  if (!proposal || proposal.taskId !== decision.taskId || proposal.taskRevision !== decision.taskRevision
    || !['pending', 'confirmed'].includes(proposal.status) || !['confirm', 'decline'].includes(event.data.kind)) throw new Error('stale repair decision')
  return current.map(p => p.id !== proposal.id ? p : { ...p,
    status: event.data.kind === 'confirm' ? 'confirmed' : 'declined',
    ...event.data.kind === 'confirm' ? { confirmedAt: decision.confirmedAt, confirmationSeq: event.seq } : {},
  })
}

/** A model-callable replay can observe a recorded click, but cannot create that authorization. */
export function taskExecutionError(task: TaskSnapshot | null): TaskActionError {
  return task?.phase === 'complete'
    ? new TaskActionError('TASK_COMPLETED', 'Use task_propose_repair, then wait for the user to click the impact confirmation. task_rework_node requires an executing task.')
    : new TaskActionError('TASK_NOT_EXECUTING', 'Read task_status for available actions and blocking reasons.')
}
