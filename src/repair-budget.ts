/** Original-requirement repair permits and cumulative limits survive every resume. */
import { z } from 'zod'
import type { TaskSnapshot } from './state-schema.ts'
import { affectedNodes, reworkNode } from './graph.ts'

export const repairBudgetSchema = z.object({
  replanLimit: z.literal(3), nodeLimit: z.literal(3), noProgressLimit: z.literal(2),
  permit: z.object({ requirementsVersion: z.number().int().positive(), planVersion: z.number().int().positive(),
    approvalSeq: z.number().int().nonnegative() }).strict().nullable(),
  history: z.array(z.object({ id: z.string().min(1), kind: z.enum(['replan', 'rework']), nodeId: z.string().nullable(),
    reason: z.string().min(1), affectedNodeIds: z.array(z.string()), requirementsVersion: z.number().int().positive(),
    planVersion: z.number().int().nonnegative(), fingerprint: z.string().nullable(),
    noProgress: z.number().int().nonnegative(), permitSeq: z.number().int().nonnegative(), recordedAt: z.iso.datetime(),
    admitted: z.boolean(), stop: z.enum(['limit', 'no-progress']).nullable() }).strict()),
}).strict()

export function initialRepairBudget(): z.infer<typeof repairBudgetSchema> {
  return { replanLimit: 3, nodeLimit: 3, noProgressLimit: 2, permit: null, history: [] }
}

export function hasRepairPermit(task: TaskSnapshot): boolean {
  return task.enabled && task.everApproved && task.repairBudget?.permit?.requirementsVersion === task.requirementsVersion
}

/** An exact action identity is reserved in the Task snapshot before any new dispatch. */
export function repairTransition(task: TaskSnapshot, action: {
  id: string; kind: 'replan' | 'rework'; nodeId?: string; reason: string; fingerprint: string | null; seq: number
}, now = new Date().toISOString()): TaskSnapshot {
  const budget = task.repairBudget
  if (!budget || !hasRepairPermit(task) || !['active', 'reviewing', 'planning'].includes(task.phase)) throw new Error('Original-requirement repair needs a current durable approval permit; read task_status.')
  if (budget.history.some(item => item.id === action.id)) return task
  if (!action.reason.trim()) throw new Error('Repair needs a concrete reason and must preserve the original objective.')
  const nodeId = action.kind === 'rework' ? action.nodeId ?? '' : null
  const affected = nodeId === null ? task.stages.map(stage => stage.id) : affectedNodes(task, [nodeId])
  const prior = budget.history.filter(item => item.kind === action.kind && item.nodeId === nodeId)
  const last = prior.at(-1)
  // Unknown evidence cannot establish novelty. Neither time nor model claims enter this identity.
  const noProgress = last && (action.fingerprint === null || last.fingerprint === action.fingerprint) ? last.noProgress + 1 : 0
  const stop: 'limit' | 'no-progress' | null = prior.filter(item => item.admitted).length >= (nodeId === null ? budget.replanLimit : budget.nodeLimit)
    ? 'limit' : noProgress >= budget.noProgressLimit ? 'no-progress' : null
  const entry = { ...action, nodeId, affectedNodeIds: affected, requirementsVersion: task.requirementsVersion,
    planVersion: task.planVersion, noProgress, permitSeq: budget.permit!.approvalSeq, recordedAt: now, admitted: stop === null, stop }
  const { seq: _seq, ...record } = entry
  const next = { ...task, repairBudget: { ...budget, history: [...budget.history, record] }, pendingReview: null }
  if (stop) return { ...next, phase: 'paused', pauseReason: stop === 'limit' ? 'repair-budget' : 'repair-stalled' }
  return nodeId === null ? { ...next, phase: 'planning', approvedPlanVersion: null, pauseReason: null }
    : { ...reworkNode(next, nodeId, action.seq), phase: 'active', pauseReason: null }
}

/** Old Tasks remain readable, but cannot acquire automatic repair authorization on replay. */
export function validateRepairHistory(previous: TaskSnapshot | undefined, next: TaskSnapshot): void {
  if (!previous) return
  const before = previous.repairBudget, after = next.repairBudget
  if (before && (!after || JSON.stringify(before.history) !== JSON.stringify(after.history.slice(0, before.history.length))
    || before.replanLimit !== after.replanLimit || before.nodeLimit !== after.nodeLimit || before.noProgressLimit !== after.noProgressLimit)) throw new Error('Repair budget/history cannot reset or change')
  if (!before && after) throw new Error('Legacy Task cannot gain fabricated repair history or permit')
  if (after?.permit && after.permit.requirementsVersion !== next.requirementsVersion) throw new Error('Repair permit refers to old requirements')
}
