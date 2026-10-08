/** Admit review requests durably; run them only after their transport settles. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { controlEvent } from './session-records.ts'
import type { TaskSnapshot } from './state.ts'

interface ReviewQueueOwner {
  current(agent: Agent): TaskSnapshot | null
  pendingInput(agent: Agent): boolean
  admitted(agent: Agent, task: TaskSnapshot): Promise<TaskSnapshot>
  failed(agent: Agent, task: TaskSnapshot, error: unknown): Promise<void>
  interrupted(agent: Agent, task: TaskSnapshot): Promise<void>
  run(agent: Agent, task: TaskSnapshot, signal: AbortSignal): Promise<void>
}

export function installReviewQueue(ctx: Context, owner: ReviewQueueOwner) {
  const pending = new Map<Agent, { task: TaskSnapshot; recovery: boolean }>()
  const running = new Set<Promise<void>>()
  const lifetime = new AbortController()
  let disposed = false
  function start(agent: Agent) {
    if (disposed || agent.status !== 'idle') return
    const queued = pending.get(agent)
    const expected = queued?.task
    if (!expected) return
    pending.delete(agent)
    const work = ctx.agents.withoutInitiator(async () => {
      // status=idle is emitted before the retiring turn resolves its activity barrier.
      await agent.whenIdle()
      if (disposed || ctx.agents.get(agent.id) !== agent) return
      const task = owner.current(agent)
      if (task?.id !== expected.id
        || task.revision !== expected.revision || !task.enabled || task.phase !== 'reviewing') return
      await agent.runMaintenance(async signal => {
        signal.throwIfAborted()
        const ending = agent.session.snapshotEvents().map(controlEvent).findLast(event => event.type === 'turn/end')
        if (!queued?.recovery && ending?.type === 'turn/end' && ending.data.reason.kind === 'aborted' || owner.pendingInput(agent)) { await owner.interrupted(agent, task); return }
        try { await owner.run(agent, task, AbortSignal.any([signal, lifetime.signal])) }
        catch (error) { await owner.failed(agent, task, error); throw error }
      })
    }).catch(error => { ctx.logger.warn(`Queued review for ${agent.id} failed: ${String(error)}`) })
      .finally(() => { running.delete(work) })
    running.add(work)
  }
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') start(agent) })
  ctx.on('tools/result', exec => { if (exec.agent) start(exec.agent); return undefined })
  ctx.on('agent/disposed', ({ agent }) => { pending.delete(agent) })
  ctx.effect(() => async () => {
    disposed = true
    pending.clear()
    lifetime.abort(new Error('Supervisor review queue unloaded'))
    // The owning controller aborts review work on unload; await that quiescence.
    await Promise.all([...running])
  })
  return {
    schedule(agent: Agent, task: TaskSnapshot) { pending.set(agent, { task, recovery: true }); start(agent) },
    async enqueue(agent: Agent, task: TaskSnapshot,
      review: NonNullable<TaskSnapshot['pendingReview']>, exec: Pick<ToolRunContext, 'signal' | 'concludeTurn'>) {
      exec.signal.throwIfAborted()
      const next: TaskSnapshot = { ...task, revision: task.revision + 1, phase: 'reviewing',
        pendingReview: { ...review, cutoff: agent.session.seq - 1 } }
      const admitted = await owner.admitted(agent, next)
      pending.set(agent, { task: admitted, recovery: false })
      exec.concludeTurn()
      return { phase: 'reviewing', queued: true, jobId: admitted.pendingReview!.jobId!, kind: review.kind, stageId: review.stageId,
        message: 'Review accepted by Supervisor. End this execution turn now. The controller runs the independent review after this turn settles; do not poll, approve, or execute another node in this turn.' }
    },
  }
}
