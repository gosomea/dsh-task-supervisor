/** Web panel transport on DSH Connection's authenticated Fetch surface. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { taskOf, taskProjection, type TaskProjection } from './state.ts'

const PATH = '/api/task-supervisor'
const ACTIONS = new Set(['consult', 'approve', 'pause', 'resume', 'clear', 'off', 'on'])

function response(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

/** Read cold Session state in bounded pages without taking write ownership. */
async function coldState(ctx: Context, sessionId: string, signal: AbortSignal): Promise<TaskProjection | null> {
  const id = SessionId(sessionId)
  if (await ctx.sessionPersistence.stat(id, { signal }) === undefined) return null
  const reader = await ctx.sessionPersistence.open(id, 'read', { signal })
  try {
    let state = taskProjection.init()
    for (let offset = 0;;) {
      signal.throwIfAborted()
      const page = await reader.read(offset, 256, { signal })
      if (page.events.length === 0) break
      for (const event of page.events) state = taskProjection.apply(state, event)
      offset += page.events.length
    }
    return state
  } finally {
    await reader.close()
  }
}

/** Register the panel route only when a Web Connection exists. */
export function installPanelApi(ctx: Context, controls: (agent: Agent) => { armed: boolean; reviewing: boolean; actions: string[] }, consultation: { open(main: Agent): Promise<Agent> }): void {
  ctx.inject(['connection'], web => {
    web.effect(() => web.connection.fetch.register({
      path: PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const sessionId = new URL(request.url).searchParams.get('sessionId')
        if (sessionId === null || sessionId.length === 0 || sessionId.length > 256) {
          return response({ error: 'sessionId is required' }, 400)
        }
        const agent = ctx.agents.get(SessionId(sessionId))
        if (request.method === 'GET') {
          if (agent !== undefined) {
            return response({ task: taskOf(ctx, agent), live: true, ...controls(agent),
              reviews: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviews ?? [] })
          }
          const projected = await coldState(ctx, sessionId, request.signal)
          if (projected === null) return response({ error: 'Session not found' }, 404)
          if (projected.failure !== null) return response({ error: projected.failure }, 409)
          return response({ task: projected.current, live: false, armed: false, reviewing: false, actions: [], reviews: projected.reviews })
        }
        if (agent === undefined) return response({ error: 'Open the Session before using controls' }, 409)
        let body: unknown
        try { body = await request.json() } catch { return response({ error: 'Invalid JSON' }, 400) }
        const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : null
        if (typeof action !== 'string' || !ACTIONS.has(action)) {
          return response({ error: 'Unknown Supervisor action' }, 400)
        }
        const task = taskOf(ctx, agent)
        if (task === null || typeof body !== 'object' || body === null || !('taskId' in body) || !('revision' in body)
          || body.taskId !== task.id || body.revision !== task.revision) {
          return response({ error: '任务状态已变化，请刷新后操作。' }, 409)
        }
        if (action === 'consult') {
          try { return response({ consultationSessionId: (await consultation.open(agent)).id }) }
          catch (error) { return response({ error: String(error) }, 409) }
        }
        if (!controls(agent).actions.includes(action)) return response({ error: '当前状态不允许此操作。' }, 409)
        const command = await ctx.commands.execute(agent, `/task ${action} ${task.id} ${task.revision}`, [], request.signal)
        if (command === undefined) return response({ error: 'Supervisor command unavailable' }, 503)
        if (command.result.kind === 'error') return response({ error: command.result.text }, 409)
        return response({ task: taskOf(ctx, agent), live: true, ...controls(agent),
              reviews: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviews ?? [], message: command.result.text })
      },
    }), 'task-supervisor.panel-api')
  })
}
