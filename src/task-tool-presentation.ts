/** Expose direct tools whenever Task admission rejects opaque PTC programs. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { NAMESPACE } from './state.ts'
import { controlEvent } from './session-records.ts'

/** Temporarily expose direct schemas; disposal restores the native preset's presentation. */
export function installTaskToolPresentation(ctx: Context, directTools: (agent: Agent) => readonly string[] | undefined): void {
  const presentations = new Map<Agent, { key: string; dispose: () => void }>()
  function restore(agent: Agent) {
    const entry = presentations.get(agent)
    presentations.delete(agent)
    entry?.dispose()
  }
  function sync(agent: Agent) {
    const allow = directTools(agent)
    if (allow === undefined) { restore(agent); return }
    const key = allow.join(',')
    if (presentations.get(agent)?.key === key) return
    restore(agent)
    if (!ctx.tools.get('run_code', agent)) return
    const disposePresentation = agent.ctx.tools.presentAs('native')
    let disposeMask: (() => void) | undefined
    try {
      disposeMask = agent.ctx.tools.restrict({ allow: allow.filter(name => ctx.tools.get(name, agent) !== undefined) })
    } catch (error) {
      // Public masks cannot name Agent-local tools. Admission guards still
      // protect such custom compositions; do not fail the Agent lifecycle.
      ctx.logger.warn(`Task tool presentation mask unavailable for ${agent.id}: ${String(error)}`)
    }
    presentations.set(agent, { key, dispose: () => { disposeMask?.(); disposePresentation() } })
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
    const disposers = [...presentations.values()].map(entry => entry.dispose)
    presentations.clear()
    await Promise.all(disposers.map(dispose => dispose()))
  })
  for (const agent of ctx.agents.list()) sync(agent)
}
