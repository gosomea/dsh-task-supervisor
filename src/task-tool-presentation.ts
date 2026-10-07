/** Expose direct tools whenever Task admission rejects opaque PTC programs. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { NAMESPACE } from './state.ts'
import { controlEvent } from './session-records.ts'

/** Temporarily expose direct schemas; disposal restores the native preset's presentation. */
export function installTaskToolPresentation(ctx: Context, requiresDirectTools: (agent: Agent) => boolean): void {
  const presentations = new Map<Agent, () => void>()
  function restore(agent: Agent) {
    const dispose = presentations.get(agent)
    presentations.delete(agent)
    dispose?.()
  }
  function sync(agent: Agent) {
    if (!requiresDirectTools(agent)) { restore(agent); return }
    if (presentations.has(agent) || !ctx.tools.get('run_code', agent)) return
    // Public, Agent-scoped presentation only. The completed-task guard still
    // rejects writes and generic executors; preset identity and permissions stay intact.
    presentations.set(agent, agent.ctx.tools.presentAs('native'))
  }
  ctx.on('agent/status', ({ agent }) => sync(agent))
  ctx.on('agent/created', ({ agent }) => { sync(agent); return undefined })
  ctx.on('agent/disposed', ({ agent }) => restore(agent))
  ctx.on('session/event', (session, event) => {
    const record = controlEvent(event)
    if (record.type !== 'extension/record' || record.data.namespace !== NAMESPACE || record.data.kind !== 'state') return
    const agent = ctx.agents.get(session.id)
    if (agent) sync(agent)
  })
  ctx.effect(() => async () => {
    const disposers = [...presentations.values()]
    presentations.clear()
    await Promise.all(disposers.map(dispose => dispose()))
  })
  for (const agent of ctx.agents.list()) sync(agent)
}
