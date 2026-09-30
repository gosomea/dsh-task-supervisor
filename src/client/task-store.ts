/** One live task snapshot and action stream per displayed Session. */
import type { RepairProposal } from '../repairs.ts'
import type { ReviewJob } from '../review-records.ts'
import type { TaskSnapshot } from '../state-schema.ts'
import type { TaskDraft } from '../drafts.ts'
import type { ReworkRecord } from '../rework-records.ts'

export interface PanelState {
  task: TaskSnapshot | null
  live: boolean
  armed: boolean
  reviewVerification?: 'log' | 'independent'
  reviewing: boolean
  actions: string[]
  draft?: TaskDraft | null
  consultationMode?: 'discussion' | 'direct'
  reviewJobs?: ReviewJob[]
  reviews?: NonNullable<TaskSnapshot['lastReview']>[]
  repairs?: RepairProposal[]
  reworks?: ReworkRecord[]
}
export interface TaskView { state: PanelState | null; busy: boolean; error: string }

export function createTaskStore(sessionId: string, request: typeof fetch = fetch) {
  let view: TaskView = { state: null, busy: false, error: '' }
  let sequence = 0
  let subscriptionEpoch = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let poll: AbortController | undefined
  const listeners = new Set<() => void>()
  const url = `/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}`
  const publish = (next: TaskView) => { view = next; for (const listener of listeners) listener() }

  async function load(): Promise<void> {
    if (view.busy) return
    const current = ++sequence
    poll?.abort()
    const controller = new AbortController()
    poll = controller
    try {
      const result = await request(url, { signal: controller.signal, cache: 'no-store' })
      const body = await result.json() as PanelState & { error?: string }
      if (!result.ok) throw new Error(body.error ?? '无法读取督导状态')
      if (current === sequence && !controller.signal.aborted) publish({ ...view, state: body, error: '' })
    } catch (error) {
      if (current === sequence && !controller.signal.aborted) publish({ ...view, error: String(error) })
    }
  }
  function schedule(epoch: number): void {
    if (listeners.size === 0 || epoch !== subscriptionEpoch) return
    timer = setTimeout(() => {
      void load().finally(() => schedule(epoch))
    }, 2000)
  }
  return {
    getSnapshot: () => view,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        const epoch = ++subscriptionEpoch
        void load().finally(() => schedule(epoch))
      }
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) { clearTimeout(timer); poll?.abort(); sequence++; subscriptionEpoch++ }
      }
    },
    async act(action: string): Promise<void> {
      const state = view.state
      if (view.busy || state?.task === null || state === null || !state.live || !state.actions.includes(action)) return
      const current = ++sequence
      poll?.abort()
      publish({ ...view, busy: true, error: '' })
      try {
        const result = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action, taskId: state.task.id, revision: state.task.revision }) })
        const body = await result.json() as PanelState & { error?: string }
        if (!result.ok) throw new Error(body.error ?? '督导操作失败')
        if (current === sequence) publish({ state: body, busy: false, error: '' })
      } catch (error) {
        if (current === sequence) publish({ ...view, busy: false, error: String(error) })
      } finally {
        if (view.busy) publish({ ...view, busy: false })
      }
    },
    async repair(action: 'propose-repair' | 'confirm-repair' | 'decline-repair', task: TaskSnapshot,
      input: { proposalId: string } | { title: string; reason: string; rootNodeIds: string[]; evidenceSeqs: number[] }): Promise<boolean> {
      if (view.busy || !view.state?.live) return false
      const current = ++sequence
      poll?.abort()
      publish({ ...view, busy: true, error: '' })
      try {
        const result = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, action, taskId: task.id, revision: task.revision }) })
        const body = await result.json() as PanelState & { error?: string }
        if (!result.ok) throw new Error(body.error ?? '修复提案操作失败')
        if (current === sequence) publish({ state: body, busy: false, error: '' })
        return true
      } catch (error) {
        if (current === sequence) publish({ ...view, busy: false, error: String(error) })
        return false
      } finally { if (view.busy) publish({ ...view, busy: false }) }
    },
    async create(objective: string): Promise<boolean> {
      const state = view.state
      if (view.busy || state === null || !state.live || !objective.trim()) return false
      const current = ++sequence
      poll?.abort()
      publish({ ...view, busy: true, error: '' })
      try {
        const result = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'new', objective: objective.trim(),
            taskId: state.task?.id ?? null, revision: state.task?.revision ?? null }) })
        const body = await result.json() as PanelState & { error?: string }
        if (!result.ok) throw new Error(body.error ?? '无法新建任务')
        if (current === sequence) publish({ state: body, busy: false, error: '' })
        return true
      } catch (error) {
        if (current === sequence) publish({ ...view, busy: false, error: String(error) })
        return false
      } finally {
        if (view.busy) publish({ ...view, busy: false })
      }
    },
    async promote(draftId: string, draftVersion: number): Promise<boolean> {
      const state = view.state
      if (view.busy || !state?.live || state.draft?.id !== draftId || state.draft.version !== draftVersion) return false
      const current = ++sequence
      poll?.abort()
      publish({ ...view, busy: true, error: '' })
      try {
        const result = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'create-draft', draftId, draftVersion,
            taskId: state.task?.id ?? null, revision: state.task?.revision ?? null }) })
        const body = await result.json() as PanelState & { error?: string }
        if (!result.ok) throw new Error(body.error ?? '无法创建草案任务')
        if (current === sequence) publish({ state: body, busy: false, error: '' })
        return true
      } catch (error) {
        if (current === sequence) publish({ ...view, busy: false, error: String(error) })
        return false
      } finally { if (view.busy) publish({ ...view, busy: false }) }
    },
  }
}

const stores = new Map<string, ReturnType<typeof createTaskStore>>()
export function taskStore(sessionId: string): ReturnType<typeof createTaskStore> {
  let store = stores.get(sessionId)
  if (store === undefined) { store = createTaskStore(sessionId); stores.set(sessionId, store) }
  return store
}
