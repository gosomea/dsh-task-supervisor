/** One native, tool-free answer after a committed checkpoint; never another executor turn. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { taskOf } from './state.ts'

export function installClosingResponse(ctx: Context) {
  const pending = new WeakMap<object, { agent: Agent; revision: number; used: boolean }>()
  const current = (scope: object) => {
    const closing = pending.get(scope)
    if (closing && taskOf(ctx, closing.agent)?.revision !== closing.revision) {
      // A checkpoint answer grants no authority over a later edit or Task.
      // The Task pre-step guard still rejects queued messages from old revisions.
      pending.delete(scope)
      return undefined
    }
    return closing
  }
  ctx.on('agent/pre-step', async ({ agent }, next) => {
    const closing = current(agent)
    if (!closing) return next()
    if (closing.used) return { kind: 'reject' }
    closing.used = true
    return next()
  })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const result = await next()
    return context.scope && current(context.scope) ? { ...result, tools: [] } : result
  })
  ctx.tools.guard(exec => exec.agent && current(exec.agent)
    ? 'This checkpoint has settled. Finish the current turn with a brief text answer; no further tools.' : undefined)
  ctx.on('agent/status', ({ agent, status }) => { if (status === 'idle' && current(agent)?.used) pending.delete(agent) })
  const close = (agent: Agent, revision: number, fromMaintenance = false) => {
    if (agent.status === 'running' || fromMaintenance) pending.set(agent, { agent, revision, used: false })
  }
  return Object.assign(close, { isPending: (agent: Agent, revision: number) => current(agent)?.revision === revision })
}
export const CLOSING_MESSAGE = 'Now finish this turn with your own concise user-facing response and a short heading in the task language. Explain the submitted plan or actual outcome, the independent review result, and any user decision needed. Distinguish this checkpoint from overall completion: only phase=complete means the whole task is accepted. Do not call more tools or start the next node; the controller schedules it after your answer.'
