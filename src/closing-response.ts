/** One native, tool-free answer after a committed checkpoint; never another executor turn. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { taskOf } from './state.ts'

export function installClosingResponse(ctx: Context) {
  const pending = new WeakMap<object, { revision: number; used: boolean }>()
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const closing = pending.get(agent)
    if (!closing) return next()
    if (closing.used || taskOf(ctx, agent)?.revision !== closing.revision) return { kind: 'reject' }
    closing.used = true
    return next()
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    return context.scope && pending.has(context.scope) ? { ...result, tools: [] } : result
  })
  ctx.tools.guard(exec => exec.agent && pending.has(exec.agent)
    ? 'This checkpoint has settled. Finish the current turn with a brief text answer; no further tools.' : undefined)
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle') pending.delete(agent) })
  return (agent: Agent, revision: number) => {
    if (agent.status === 'running') pending.set(agent, { revision, used: false })
  }
}
export const CLOSING_MESSAGE = 'Now finish this turn with your own concise user-facing response and a short heading in the task language. Explain the submitted plan or actual outcome, the independent review result, and any user decision needed. Distinguish this checkpoint from overall completion: only phase=complete means the whole task is accepted. Do not call more tools or start the next node; the controller schedules it after your answer.'
