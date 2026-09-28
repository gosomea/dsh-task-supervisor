import { afterEach, expect, it, vi } from 'vitest'
import { createTaskStore, type PanelState } from '../../src/client/task-store.ts'
import { randomUUID } from 'node:crypto'
import { newTask } from '../../src/state.ts'

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.useRealTimers() })

it('shares one poll and sends the displayed version; late reads cannot undo an action', async () => {
  vi.useFakeTimers()
  const task = newTask('场景')
  const initial: PanelState = { task, live: true, armed: true, reviewing: false, actions: ['pause'] }
  const late = Promise.withResolvers<Response>()
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(initial))
    .mockReturnValueOnce(late.promise)
    .mockResolvedValueOnce(Response.json({ ...initial, task: { ...task, revision: 2, phase: 'paused' }, actions: ['resume'], armed: false }))
  const store = createTaskStore('session', request)
  cleanups.push(store.subscribe(() => {}), store.subscribe(() => {}))
  await vi.advanceTimersByTimeAsync(0)
  expect(request).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2000)
  await store.act('pause')
  const sent = request.mock.calls[2]?.[1]
  expect(JSON.parse(String(sent?.body))).toEqual({ action: 'pause', taskId: task.id, revision: 1 })
  late.resolve(Response.json(initial))
  await vi.advanceTimersByTimeAsync(0)
  expect(store.getSnapshot().state?.task?.phase).toBe('paused')
  expect(store.getSnapshot().state?.task?.revision).toBe(2)
  for (const cleanup of cleanups.splice(0)) cleanup()
  await vi.advanceTimersByTimeAsync(10000)
  expect(request).toHaveBeenCalledTimes(3)
})

it('coalesces duplicate controls while the first request is in flight', async () => {
  vi.useFakeTimers()
  const initial: PanelState = { task: newTask('场景'), live: true, armed: true, reviewing: false, actions: ['pause'] }
  const action = Promise.withResolvers<Response>()
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(action.promise)
  const store = createTaskStore('session', request)
  cleanups.push(store.subscribe(() => {}))
  await vi.advanceTimersByTimeAsync(0)
  const first = store.act('pause')
  await store.act('pause')
  expect(request).toHaveBeenCalledTimes(2)
  action.resolve(Response.json({ ...initial, actions: ['resume'], armed: false }))
  await first
  expect(store.getSnapshot().busy).toBe(false)
})


it('does not restart a detached polling loop when a late read settles after remount', async () => {
  vi.useFakeTimers()
  const late = Promise.withResolvers<Response>()
  const initial: PanelState = { task: null, live: true, armed: false, reviewing: false, actions: [] }
  const request = vi.fn<typeof fetch>().mockReturnValueOnce(late.promise)
    .mockImplementation(async () => Response.json(initial))
  const store = createTaskStore('remount', request)
  const detach = store.subscribe(() => {})
  detach()
  cleanups.push(store.subscribe(() => {}))
  await vi.advanceTimersByTimeAsync(0)
  late.resolve(Response.json(initial))
  await vi.advanceTimersByTimeAsync(2000)
  expect(request).toHaveBeenCalledTimes(3)
  await vi.advanceTimersByTimeAsync(2000)
  expect(request).toHaveBeenCalledTimes(4)
})

it('creates a following task against the completed task revision', async () => {
  const done = { ...newTask('First task'), revision: 4, phase: 'complete' as const }
  const initial: PanelState = { task: done, live: true, armed: false, reviewing: false, actions: [] }
  const next: PanelState = { ...initial, task: newTask('Second task'), armed: true }
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(initial)).mockResolvedValueOnce(Response.json(next))
  const store = createTaskStore('session', request)
  cleanups.push(store.subscribe(() => {}))
  await vi.waitFor(() => expect(store.getSnapshot().state?.task?.id).toBe(done.id))
  expect(await store.create('  Second task  ')).toBe(true)
  expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({ action: 'new', objective: 'Second task',
    taskId: done.id, revision: 4 })
  expect(store.getSnapshot().state?.task?.objective).toBe('Second task')
})

it('promotes the displayed draft version once and keeps a rejected draft available', async () => {
  const draft = { id: randomUUID(), version: 3, mainSessionId: 'main', title: '草案', requirements: '只读报告',
    questions: [], language: 'zh-CN', sourceSessionId: 'chat', sourceUserSeq: 1, status: 'draft' as const,
    creationId: null, taskId: null, updatedAt: new Date().toISOString() }
  const initial: PanelState = { task: null, draft, live: true, armed: false, reviewing: false, actions: [] }
  const pending = Promise.withResolvers<Response>()
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(pending.promise)
  const store = createTaskStore('main', request); cleanups.push(store.subscribe(() => {}))
  await vi.waitFor(() => expect(store.getSnapshot().state?.draft?.version).toBe(3))
  expect(await store.promote(draft.id, 2)).toBe(false)
  const action = store.promote(draft.id, 3)
  expect(await store.promote(draft.id, 3)).toBe(false)
  expect(request).toHaveBeenCalledTimes(2)
  expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({ action: 'create-draft', draftId: draft.id,
    draftVersion: 3, taskId: null, revision: null })
  pending.resolve(Response.json({ error: '任务状态已变化' }, { status: 409 }))
  expect(await action).toBe(false)
  expect(store.getSnapshot().state?.draft).toEqual(draft)
  expect(store.getSnapshot().error).toContain('任务状态已变化')
})

it('binds repair confirmation to the displayed historical task rather than the current task', async () => {
  const current = { ...newTask('当前已结束任务'), phase: 'complete' as const }
  const historical = { ...newTask('历史任务'), revision: 7, phase: 'complete' as const }
  const initial: PanelState = { task: current, live: true, armed: false, reviewing: false, actions: [] }
  const pending = Promise.withResolvers<Response>()
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(initial)).mockReturnValueOnce(pending.promise)
  const store = createTaskStore('main', request); cleanups.push(store.subscribe(() => {}))
  await vi.waitFor(() => expect(store.getSnapshot().state?.task?.id).toBe(current.id))
  const id = randomUUID(), clicked = store.repair('confirm-repair', historical, { proposalId: id })
  expect(await store.repair('confirm-repair', historical, { proposalId: id })).toBe(false)
  expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({ action: 'confirm-repair', proposalId: id, taskId: historical.id, revision: 7 })
  pending.resolve(Response.json({ error: 'ARTIFACT_CHANGED' }, { status: 409 }))
  expect(await clicked).toBe(false)
  expect(store.getSnapshot().state?.task?.id).toBe(current.id)
  expect(store.getSnapshot().error).toContain('ARTIFACT_CHANGED')
})
