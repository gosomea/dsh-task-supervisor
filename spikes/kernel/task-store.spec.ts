import { afterEach, expect, it, vi } from 'vitest'
import { createTaskStore, type PanelState } from '../../src/client/task-store.ts'
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
