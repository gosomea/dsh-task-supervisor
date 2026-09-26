/** DSH right sidebar panel for the bound task; all actions use the host controller. */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { TaskSnapshot } from '../state.ts'
import { milestoneDefinition, type Milestone } from './milestones.ts'

const PANEL_ID = 'dsh-task-supervisor/sidebar'
const ENDPOINT = '/api/task-supervisor'

interface PanelProps { sessionId: string }
interface TailProps { turn: { data: { get(key: 'task-supervisor-milestones'): readonly Milestone[] | undefined } } }
interface PanelState { task: TaskSnapshot | null; live: boolean; armed: boolean }
interface ClientContext {
  effect(factory: () => (() => void) | void, label?: string): void
  uiConversation: { events: { register(definition: typeof milestoneDefinition): () => void } }
  sidebarRightTabs: {
    register(definition: { id: string; kind: string; priority: 'extension'; title: () => string;
      guide: Array<{ id: string; order: number; title: () => string; description: () => string }> }): () => void
  }
  slots: {
    inject(name: string, factory: () => () => void): () => void
    register(definition: { name: string; key: string }, component: (props: PanelProps) => ReactNode): () => void
    register(definition: { name: string; id: string }, component: (props: TailProps) => ReactNode): () => void
  }
}

export const inject = ['slots', 'sidebarRightTabs', 'uiSession', 'uiConversation']

const CSS = `
.dsh-task-panel{height:100%;overflow:auto;padding:18px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:13px/1.5 system-ui,sans-serif}
.dsh-task-panel *{box-sizing:border-box}.dsh-task-panel h2{font-size:16px;margin:0 0 4px}.dsh-task-panel h3{font-size:12px;color:var(--dsw-alias-label-secondary);margin:18px 0 7px}
.dsh-task-muted{color:var(--dsw-alias-label-tertiary)}.dsh-task-status{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:14px 0}
.dsh-task-badge{border:1px solid var(--dsw-alias-border-l2);border-radius:999px;padding:2px 9px;font-size:11px}
.dsh-task-card{border:1px solid var(--dsw-alias-border-l2);border-radius:9px;padding:12px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
.dsh-task-objective{font-size:14px;font-weight:600}.dsh-task-list{margin:6px 0 0;padding-left:18px}.dsh-task-list li+li{margin-top:5px}
.dsh-task-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.dsh-task-actions button{border:1px solid var(--dsw-alias-border-l3);border-radius:7px;padding:6px 10px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);cursor:pointer}
.dsh-task-actions button:hover{border-color:var(--dsw-alias-brand-primary)}.dsh-task-actions button:disabled{opacity:.5;cursor:default}.dsh-task-actions button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-task-actions button[data-action=off]{color:var(--dsw-alias-state-error-primary)}.dsh-task-error{margin-top:10px;color:var(--dsw-alias-state-error-primary)}
.dsh-task-review{white-space:pre-wrap}.dsh-task-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:8px}
.dsh-task-milestones{display:grid;gap:8px;margin:10px 0 14px}.dsh-task-milestone{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
.dsh-task-milestone[data-verdict=revise],.dsh-task-milestone[data-verdict=needs-user]{border-left-color:var(--dsw-alias-state-error-primary)}
.dsh-task-milestone strong{display:block;font-size:13px}.dsh-task-milestone p{margin:5px 0 0;white-space:pre-wrap}.dsh-task-milestone details{margin-top:7px}.dsh-task-milestone summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dsh-task-milestone .dsh-task-report{color:var(--dsw-alias-label-secondary)}.dsh-task-milestone .dsh-task-report span{font-weight:600}
.dsh-task-milestone pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:8px 0 0;color:var(--dsw-alias-label-secondary)}
`

const PHASE: Record<TaskSnapshot['phase'], string> = {
  planning: '规划中', 'awaiting-approval': '等待计划批准', active: '执行中',
  reviewing: '审查中', paused: '已暂停', complete: '已完成', cleared: '已清除',
}
const VERDICT = { pass: '通过', revise: '需要修订', 'needs-user': '等待用户决策' }

function actions(task: TaskSnapshot, armed: boolean): Array<[string, string]> {
  if (task.phase === 'cleared') return []
  if (!task.enabled) return [['on', '重新启用督导']]
  if (task.phase === 'awaiting-approval') return [['approve', '批准计划'], ['pause', '暂停'], ['off', '关闭督导']]
  if (task.phase === 'paused' || task.phase === 'reviewing' || !armed && task.phase !== 'complete') {
    return [['resume', '恢复任务'], ['off', '关闭督导']]
  }
  if (task.phase === 'complete') return [['clear', '清除任务']]
  return [['pause', '暂停'], ['off', '关闭督导']]
}

function Panel({ sessionId }: PanelProps): ReactNode {
  const [state, setState] = useState<PanelState | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const load = useCallback(async (signal: AbortSignal) => {
    const request = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, { signal, cache: 'no-store' })
    const body = await request.json() as PanelState & { error?: string }
    if (!request.ok) throw new Error(body.error ?? '无法读取督导状态')
    setState({ task: body.task, live: body.live, armed: body.armed })
    setError('')
  }, [sessionId])

  useEffect(() => {
    const controller = new AbortController()
    const refresh = () => { void load(controller.signal).catch(reason => {
      if (!controller.signal.aborted) setError(String(reason))
    }) }
    setState(null)
    refresh()
    const timer = window.setInterval(refresh, 2000)
    return () => { controller.abort(); window.clearInterval(timer) }
  }, [load])

  async function act(action: string): Promise<void> {
    setBusy(true)
    try {
      const request = await fetch(`${ENDPOINT}?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action }),
      })
      const body = await request.json() as PanelState & { error?: string }
      if (!request.ok) throw new Error(body.error ?? '督导操作失败')
      setState({ task: body.task, live: body.live, armed: body.armed })
      setError('')
    } catch (reason) {
      setError(String(reason))
    } finally {
      setBusy(false)
    }
  }

  const task: TaskSnapshot | null = state === null ? null : state.task
  const stage = task?.stages[task.stageIndex]
  return <div className="dsh-task-panel" aria-live="polite">
    <h2>任务督导</h2>
    <div className="dsh-task-muted">独立规划、审查与续行</div>
    {state === null ? <p className="dsh-task-muted">正在读取会话状态…</p>
      : task === null ? <div className="dsh-task-card" style={{ marginTop: 16 }}>
        当前会话没有督导任务。在输入框使用 <code>/task new &lt;目标&gt;</code> 创建。
      </div> : <>
        <div className="dsh-task-status"><span className="dsh-task-badge">{PHASE[task.phase]}</span>
          <span className="dsh-task-muted">{task.enabled ? '督导开启' : '督导关闭'} · 第 {task.revision} 版</span></div>
        <div className="dsh-task-card"><div className="dsh-task-objective">{task.objective}</div>
          <div className="dsh-task-meta">计划第 {task.planVersion} 版 · 阶段 {Math.min(task.stageIndex + 1, task.stages.length)}/{task.stages.length}</div></div>
        {stage !== undefined && <><h3>当前阶段</h3><div className="dsh-task-card">{stage.title}</div></>}
        {task.criteria.length > 0 && <><h3>验收标准</h3><div className="dsh-task-card"><ol className="dsh-task-list">
          {task.criteria.map(item => <li key={item.id}>{item.text}</li>)}
        </ol></div></>}
        {task.lastReview !== null && <><h3>最近审查 · {VERDICT[task.lastReview.verdict]}</h3>
          <div className="dsh-task-card"><div className="dsh-task-review">{task.lastReview.finding}</div>
            <div className="dsh-task-meta">检查点 {task.lastReview.stageId} · 主会话截止 seq {task.lastReview.cutoff}
              {task.lastReview.evidenceSeqs === undefined ? '' : ` · 证据 ${task.lastReview.evidenceSeqs.join(', ')}`}</div></div></>}
        <div className="dsh-task-actions">{actions(task, state.armed).map(([action, label]) => <button key={action}
          data-action={action} disabled={busy || !state.live} onClick={() => { void act(action) }}>{label}</button>)}</div>
        {!state.live && <p className="dsh-task-muted">打开该会话后可使用控制按钮；恢复执行仍需手动操作。</p>}
      </>}
    {error && <div className="dsh-task-error" role="alert">{error}</div>}
  </div>
}

/** Logged checkpoints stay visible when DSH folds the model's tool-heavy Turn. */
function MilestoneCards({ turn }: TailProps): ReactNode {
  const milestones = turn.data.get('task-supervisor-milestones')
  if (milestones === undefined || milestones.length === 0) return null
  return <div className="dsh-task-milestones" aria-label="任务督导检查点">
    {milestones.map(item => <section key={item.seq} className="dsh-task-milestone"
      data-verdict={item.verdict} data-milestone={item.kind}>
      <strong>{item.title}</strong><p>{item.summary}</p>
      {item.report && <p className="dsh-task-report"><span>主 Agent 汇报：</span>{item.report}</p>}
      {item.detail && item.detail !== item.summary && <details><summary>查看完整{item.kind === 'plan' ? '阶段' : '审查发现'}</summary>
        <pre>{item.detail}</pre></details>}
    </section>)}
  </div>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.uiConversation.events.register(milestoneDefinition), 'task-supervisor:milestones')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-task-supervisor'
    style.textContent = CSS
    document.head.append(style)
    return () => { style.remove() }
  })
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PANEL_ID, kind: 'task-supervisor', priority: 'extension', title: () => '任务督导',
    guide: [{ id: 'task-supervisor', order: 5, title: () => '任务督导',
      description: () => '查看任务阶段、审查结果及暂停和恢复控制' }],
  }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: PANEL_ID }, Panel,
  )))
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register(
    { name: 'conversation.chat.turnTail', id: `${PANEL_ID}/milestones` }, MilestoneCards,
  )))
}
