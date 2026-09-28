/** Web panel transport on DSH Connection's authenticated Fetch surface. */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-client-connection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { draftOf } from './drafts.ts'
import { evidenceRecord } from './evidence.ts'
import type { ConsultationMode } from './consultation.ts'
import { createTaskHistoryCollector, taskOf, taskProjection, type TaskProjection } from './state.ts'

const PATH = '/api/task-supervisor'
const ACTIONS = new Set(['consult-mode', 'create-draft', 'consult', 'approve', 'pause', 'resume', 'retry-review', 'clear', 'off', 'on'])

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

/** History is fetched only when opened; its source remains the native Session log. */
async function taskHistory(ctx: Context, sessionId: string, agent: Agent | undefined, signal: AbortSignal) {
  const collector = createTaskHistoryCollector()
  if (agent) {
    for (const event of agent.session.snapshotEvents()) collector.add(event)
    return collector.finish()
  }
  const id = SessionId(sessionId)
  if (await ctx.sessionPersistence.stat(id, { signal }) === undefined) return null
  const reader = await ctx.sessionPersistence.open(id, 'read', { signal })
  try {
    for (let offset = 0;;) {
      signal.throwIfAborted()
      const page = await reader.read(offset, 256, { signal })
      if (page.events.length === 0) break
      for (const event of page.events) collector.add(event)
      offset += page.events.length
    }
    return collector.finish()
  } finally { await reader.close() }
}

/** Register the panel route only when a Web Connection exists. */
export function installPanelApi(ctx: Context, controls: (agent: Agent) => { armed: boolean; reviewing: boolean; actions: string[] }, consultation: { open(main: Agent): Promise<Agent>; promote(main: Agent, id: string, version: number): Promise<unknown>; mode(main: Agent): ConsultationMode; setMode(main: Agent, mode: ConsultationMode): Promise<void> }): void {
  ctx.inject(['connection'], web => {
    web.effect(() => web.connection.fetch.register({
      path: PATH,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      async fetch(request) {
        const url = new URL(request.url)
        const sessionId = url.searchParams.get('sessionId')
        if (sessionId === null || sessionId.length === 0 || sessionId.length > 256) {
          return response({ error: 'sessionId is required' }, 400)
        }
        const agent = ctx.agents.get(SessionId(sessionId))
        if (request.method === 'GET') {
          if (url.searchParams.get('view') === 'review-log') {
            try {
              const state = agent ? ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor') : await coldState(ctx, sessionId, request.signal)
              const reviewerId = url.searchParams.get('reviewerSessionId')
              if (!reviewerId || !state?.reviewJobs.some(job => job.reviewerSessionId === reviewerId)) return response({ error: '审查不属于当前主 Session 的记录窗口' }, 404)
              const id = SessionId(reviewerId)
              const stat = await ctx.sessionPersistence.stat(id, { signal: request.signal })
              if (!stat) return response({ error: '审查原始日志不存在' }, 404)
              const reader = await ctx.sessionPersistence.open(id, 'read', { signal: request.signal })
              try {
                // Tail in bounded pages without opening a reviewer Agent.
                let tail: import('@deepseek-ai/dsh-session').SessionEvent[] = []
                for (let offset = 0;;) {
                  request.signal.throwIfAborted()
                  const page = await reader.read(offset, 256, { signal: request.signal })
                  if (!page.events.length) break
                  tail = [...tail, ...page.events].slice(-100); offset += page.events.length
                }
                return response({ events: tail.map(evidenceRecord) })
              } finally { await reader.close() }
            } catch (error) { return response({ error: String(error) }, 409) }
          }
          if (url.searchParams.get('view') === 'history') {
            try {
              const entries = await taskHistory(ctx, sessionId, agent, request.signal)
              return entries === null ? response({ error: 'Session not found' }, 404) : response({ entries })
            } catch (error) { return response({ error: String(error) }, 409) }
          }
          if (agent !== undefined) {
            return response({ task: taskOf(ctx, agent), live: true, ...controls(agent), consultationMode: consultation.mode(agent),
              draft: draftOf(ctx, agent), reviews: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviews ?? [],
              reviewJobs: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs ?? [] })
          }
          const projected = await coldState(ctx, sessionId, request.signal)
          if (projected === null) return response({ error: 'Session not found' }, 404)
          if (projected.failure !== null) return response({ error: projected.failure }, 409)
          return response({ task: projected.current, live: false, armed: false, reviewing: false, actions: [], draft: projected.draft?.mainSessionId === sessionId ? projected.draft : null, reviews: projected.reviews, reviewJobs: projected.reviewJobs })
        }
        if (agent === undefined) return response({ error: 'Open the Session before using controls' }, 409)
        let body: unknown
        try { body = await request.json() } catch { return response({ error: 'Invalid JSON' }, 400) }
        const action = typeof body === 'object' && body !== null && 'action' in body ? body.action : null
        if (action === 'new') {
          const objective = typeof body === 'object' && body !== null && 'objective' in body && typeof body.objective === 'string'
            ? body.objective.trim() : ''
          const current = taskOf(ctx, agent)
          if (!objective || objective.length > 10000) return response({ error: '请输入完整任务目标（最多 10000 字）。' }, 400)
          if (typeof body !== 'object' || body === null || !('taskId' in body) || !('revision' in body)
            || body.taskId !== (current?.id ?? null) || body.revision !== (current?.revision ?? null)) {
            return response({ error: '任务状态已变化，请刷新后操作。' }, 409)
          }
          if (current && current.phase !== 'complete' && current.phase !== 'cleared') {
            return response({ error: '请先完成当前任务，再新建下一项。' }, 409)
          }
          const command = await ctx.commands.execute(agent, `/task new ${objective}`, [], request.signal)
          if (command === undefined) return response({ error: 'Supervisor command unavailable' }, 503)
          if (command.result.kind === 'error') return response({ error: command.result.text }, 409)
          return response({ task: taskOf(ctx, agent), live: true, ...controls(agent),
            draft: draftOf(ctx, agent), reviews: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviews ?? [],
              reviewJobs: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs ?? [], message: command.result.text })
        }
        if (typeof action !== 'string' || !ACTIONS.has(action)) {
          return response({ error: 'Unknown Supervisor action' }, 400)
        }
        if (action === 'consult-mode') {
          if (typeof body !== 'object' || body === null || !('mode' in body) || (body.mode !== 'discussion' && body.mode !== 'direct')) return response({ error: 'Unknown input mode' }, 400)
          try {
            await consultation.setMode(agent, body.mode)
            return response({ consultationMode: consultation.mode(agent) })
          } catch (error) { return response({ error: String(error) }, 409) }
        }
        if (action === 'create-draft') {
          const current = taskOf(ctx, agent)
          if (typeof body !== 'object' || body === null || !('taskId' in body) || !('revision' in body)
            || body.taskId !== (current?.id ?? null) || body.revision !== (current?.revision ?? null)
            || !('draftId' in body) || typeof body.draftId !== 'string' || !('draftVersion' in body) || typeof body.draftVersion !== 'number') {
            return response({ error: '任务或草案状态已变化，请刷新后操作。' }, 409)
          }
          try {
            const confirmation = { draftId: body.draftId, draftVersion: body.draftVersion, taskId: current?.id ?? null,
              taskRevision: current?.revision ?? null, source: 'web-confirmation', confirmedAt: new Date().toISOString() }
            agent.session.append('extension/record', { namespace: 'dsh-task-supervisor-consultation', schemaVersion: 2,
              kind: 'confirmation', recordId: `web-draft:${body.draftId}:${body.draftVersion}`, payload: confirmation })
            if (!await ctx.sessions.flush(agent.session)) throw new Error('创建确认未持久化，请重试。')
            await consultation.promote(agent, body.draftId, body.draftVersion)
            return response({ task: taskOf(ctx, agent), draft: draftOf(ctx, agent), live: true, ...controls(agent),
              reviews: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviews ?? [],
              reviewJobs: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs ?? [] })
          } catch (error) { return response({ error: String(error) }, 409) }
        }
        if (action === 'consult') {
          try { return response({ consultationSessionId: (await consultation.open(agent)).id, consultationMode: consultation.mode(agent) }) }
          catch (error) { return response({ error: String(error) }, 409) }
        }
        const task = taskOf(ctx, agent)
        if (task === null || typeof body !== 'object' || body === null || !('taskId' in body) || !('revision' in body)
          || body.taskId !== task.id || body.revision !== task.revision) {
          return response({ error: '任务状态已变化，请刷新后操作。' }, 409)
        }
        if (!controls(agent).actions.includes(action)) return response({ error: '当前状态不允许此操作。' }, 409)
        const command = await ctx.commands.execute(agent, `/task ${action} ${task.id} ${task.revision}`, [], request.signal)
        if (command === undefined) return response({ error: 'Supervisor command unavailable' }, 503)
        if (command.result.kind === 'error') return response({ error: command.result.text }, 409)
        return response({ task: taskOf(ctx, agent), live: true, ...controls(agent),
              draft: draftOf(ctx, agent), reviews: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviews ?? [],
              reviewJobs: ctx.sessionProjections.stateOf(agent.session, 'taskSupervisor')?.reviewJobs ?? [], message: command.result.text })
      },
    }), 'task-supervisor.panel-api')
  })
}
