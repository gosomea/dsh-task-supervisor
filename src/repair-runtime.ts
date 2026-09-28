/** Repair proposal transport and click-only authorization over the native Session log. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { artifactIdentity } from './artifact-identity.ts'
import { taskOf, type TaskSnapshot } from './state.ts'
import { REPAIR_NAMESPACE, TaskActionError, repairImpact, repairProposalSchema, reopenTask, type RepairProposal } from './repairs.ts'

export interface RepairInput {
  source?: 'main-agent' | 'consultation' | 'user'; proposerSessionId?: string
  taskId: string; taskRevision: number; title: string; reason: string; rootNodeIds: string[]; evidenceSeqs: number[]
}
export interface RepairController {
  propose(agent: Agent, input: RepairInput, signal: AbortSignal): Promise<RepairProposal>
  confirm(agent: Agent, id: string, targetId: string, targetRevision: number, signal: AbortSignal): Promise<void>
  decline(agent: Agent, id: string, targetId: string, targetRevision: number): Promise<void>
}

export function installRepairs(ctx: Context, wake: (agent: Agent, expected: TaskSnapshot, next: () => TaskSnapshot,
  instruction: string, beforeCommit: () => Promise<void>) => Promise<void>, limits = { files: 10000, bytes: 256 * 1024 * 1024 }): RepairController {
  ctx.agents.registerSessionControlReader(REPAIR_NAMESPACE, [1])
  const projection = (agent: Agent) => {
    const state = ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')
    if (!state || state.failure) throw new TaskActionError('TASK_STATE_UNAVAILABLE', state?.failure ?? 'Task projection unavailable.')
    return state
  }
  const target = (agent: Agent, id: string, revision: number) => {
    const state = projection(agent)
    const task = state.current?.id === id ? state.current : state.archivedTasks.find(entry => entry.task.id === id)?.task
    if (!task || task.revision !== revision) throw new TaskActionError('REPAIR_STALE', 'Read the selected task again and refresh the proposal.')
    return task
  }
  const artifact = async (agent: Agent, signal: AbortSignal) => {
    const fs = ctx.get('fs'), cwd = agent.session.header.cwd
    if (!fs || !cwd) throw new TaskActionError('ARTIFACT_UNAVAILABLE', 'Repair confirmation needs a native filesystem and bound task workspace.')
    return artifactIdentity(fs, cwd, signal, limits)
  }
  async function flush(agent: Agent) {
    if (!await ctx.sessions.flush(agent.session)) throw new TaskActionError('REPAIR_NOT_DURABLE', 'Repair record is not durable; do not execute.')
  }
  function proposal(agent: Agent, id: string, taskId: string, revision: number) {
    const found = projection(agent).repairs.find(p => p.id === id)
    if (!found || found.taskId !== taskId || found.taskRevision !== revision) throw new TaskActionError('REPAIR_STALE', 'The click refers to a different proposal or task.')
    return found
  }
  function admission(agent: Agent, repair: RepairProposal) {
    const live = taskOf(ctx, agent)
    if (!live) throw new TaskActionError('TASK_STATE_UNAVAILABLE', 'Open the original main Session first.')
    if (!live.enabled) throw new TaskActionError('SUPERVISOR_DISABLED', 'Enable supervision explicitly before confirming.')
    if (!['complete', 'cleared'].includes(live.phase)) throw new TaskActionError('ACTIVE_TASK_CONFLICT', 'Another task owns execution; wait for it to finish before confirming this repair.')
    if (!['pending', 'confirmed'].includes(repair.status)) throw new TaskActionError('REPAIR_STALE', 'The proposal is no longer awaiting confirmation.')
    const selected = target(agent, repair.taskId, repair.taskRevision)
    repairImpact(selected, repair.rootNodeIds)
    if (!selected.enabled) throw new TaskActionError('SUPERVISOR_DISABLED', 'The selected task is disabled.')
    return { live, selected }
  }
  const recordDecision = async (agent: Agent, repair: RepairProposal, kind: 'confirm' | 'decline') => {
    agent.session.append('extension/record', { namespace: REPAIR_NAMESPACE, schemaVersion: 1, kind,
      recordId: randomUUID(), payload: { proposalId: repair.id, taskId: repair.taskId, taskRevision: repair.taskRevision,
        source: 'web-confirmation', confirmedAt: new Date().toISOString() } })
    await flush(agent)
  }
  return {
    async propose(agent, input, signal) {
      const selected = target(agent, input.taskId, input.taskRevision)
      const affectedNodeIds = repairImpact(selected, input.rootNodeIds)
      const evidenceSeqs = [...new Set(input.evidenceSeqs)]
      const events = agent.session.snapshotEvents()
      if (evidenceSeqs.some(seq => !events.some(e => e.seq === seq && ['tool/result', 'assistant/message', 'user/message'].includes(e.type)))) {
        throw new TaskActionError('REPAIR_EVIDENCE_INVALID', 'Use real main Session assistant-message, user-message, or tool-result references.')
      }
      const identity = await artifact(agent, signal)
      signal.throwIfAborted()
      target(agent, input.taskId, input.taskRevision)
      const existing = projection(agent).repairs.findLast(p => p.status === 'pending' && p.taskId === input.taskId
        && p.taskRevision === input.taskRevision && p.artifact.digest === identity.digest && p.title === input.title.trim()
        && p.reason === input.reason.trim() && JSON.stringify(p.rootNodeIds) === JSON.stringify(input.rootNodeIds)
        && JSON.stringify(p.evidenceSeqs) === JSON.stringify(evidenceSeqs))
      if (existing) return existing
      const next = repairProposalSchema.parse({ id: randomUUID(), ...input, evidenceSeqs, affectedNodeIds,
        artifact: identity, proposedAt: new Date().toISOString(), proposedSeq: agent.session.seq, status: 'pending' })
      agent.session.append('extension/record', { namespace: REPAIR_NAMESPACE, schemaVersion: 1, kind: 'proposal',
        recordId: next.id, payload: next as unknown as JsonValue })
      await flush(agent)
      return next
    },
    async confirm(agent, id, targetId, targetRevision, signal) {
      let repair = proposal(agent, id, targetId, targetRevision)
      if (repair.status === 'applied') return
      const { live, selected } = admission(agent, repair)
      await agent.whenIdle()
      signal.throwIfAborted()
      await wake(agent, live, () => reopenTask(selected, repair, agent.session.seq),
        `Repair acceptance cycle ${(selected.acceptanceCycle ?? 1) + 1}. The user clicked the impact confirmation. `
        + `Reason: ${repair.reason}. Rework roots: ${repair.rootNodeIds.join(', ')}; affected nodes: ${repair.affectedNodeIds.join(', ')}. `
        + 'Inspect current artifacts, start ready nodes, fix only the original objective, and resubmit affected nodes plus final completion for review.',
        async () => {
          const identity = await artifact(agent, signal)
          if (identity.workspaceKey !== repair.artifact.workspaceKey || identity.digest !== repair.artifact.digest) {
            throw new TaskActionError('ARTIFACT_CHANGED', 'Files changed since the impact proposal. Refresh it and confirm the updated scope.')
          }
          if (taskOf(ctx, agent)?.id !== live.id || taskOf(ctx, agent)?.revision !== live.revision) throw new TaskActionError('REPAIR_STALE', 'Current task changed while checking artifacts.')
          repair = proposal(agent, id, targetId, targetRevision)
          admission(agent, repair)
          signal.throwIfAborted()
          await recordDecision(agent, repair, 'confirm')
          repair = proposal(agent, id, targetId, targetRevision)
        })
    },
    async decline(agent, id, targetId, targetRevision) {
      const repair = proposal(agent, id, targetId, targetRevision)
      if (repair.status === 'declined') return
      if (!['pending', 'confirmed'].includes(repair.status)) throw new TaskActionError('REPAIR_STALE', 'The proposal is no longer awaiting a decision.')
      await recordDecision(agent, repair, 'decline')
    },
  }
}
