/** DSH right sidebar panel for the bound task; all actions use the host controller. */

import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { acceptedNodes, readyNodes, runsOf } from '../graph.ts'
import { TaskGraph, GRAPH_CSS } from './task-graph.tsx'
import { taskStore } from './task-store.ts'
import type { TaskSnapshot } from '../state.ts'
import { milestoneDefinition, type Milestone } from './milestones.ts'

const PANEL_ID = 'dsh-task-supervisor/sidebar'

interface PanelProps { sessionId: string }
interface TailProps { turn: { data: { get(key: 'task-supervisor-milestones'): readonly Milestone[] | undefined } } }
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
    register(definition: { name: string; id: string }, component: (props: PanelProps) => ReactNode): () => void
  }
}

export const inject = ['slots', 'sidebarRightTabs', 'uiSession', 'uiConversation']

const CSS = `
.dsh-task-inline{width:calc(100% - 2 * var(--dsh-composer-side-clearance,16px) - 2 * var(--dsh-composer-dock-inset,8px));max-width:calc(var(--dsh-composer-card-max-width,800px) - 2 * var(--dsh-composer-dock-inset,8px));margin:8px auto;border:1px solid var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary)}
.dsh-task-inline>summary{padding:10px 14px;cursor:pointer;font:13px/1.5 system-ui}.dsh-task-inline .dsh-task-panel{max-height:38vh}
.dsh-task-stages{list-style:none;margin:12px 0;padding:0;display:grid;gap:6px}.dsh-task-stages button{width:100%;text-align:left;display:grid;gap:3px;padding:9px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-2);color:inherit;cursor:pointer}
.dsh-task-stages button[aria-current=step]{border-color:var(--dsw-alias-brand-primary)}.dsh-task-stages span{font-size:11px;color:var(--dsw-alias-label-secondary)}.dsh-task-actions{position:sticky;top:0;background:var(--dsw-alias-bg-layer-1);padding:8px 0;z-index:1}

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
.dsh-task-milestones,.dsh-task-milestone-pair{display:grid;gap:8px}.dsh-task-milestones{margin:10px 0 14px}.dsh-task-milestone{border:1px solid var(--dsw-alias-border-l2);border-left:3px solid var(--dsw-alias-brand-primary);border-radius:8px;padding:10px 12px;background:var(--dsw-alias-bg-layer-2);overflow-wrap:anywhere}
.dsh-task-milestone[data-role=supervisor]{border-left-color:var(--dsw-alias-state-success-primary)}.dsh-task-milestone[data-verdict=revise],.dsh-task-milestone[data-verdict=needs-user]{border-left-color:var(--dsw-alias-state-error-primary)}
.dsh-task-milestone .dsh-task-role{font-size:11px;font-weight:700;color:var(--dsw-alias-label-secondary);margin-bottom:5px}.dsh-task-milestone strong{display:block;font-size:13px}.dsh-task-milestone p{margin:5px 0 0;white-space:pre-wrap}.dsh-task-milestone details{margin-top:7px}.dsh-task-milestone summary{cursor:pointer;color:var(--dsw-alias-label-secondary)}
.dsh-task-milestone .dsh-task-source{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:7px}.dsh-task-milestone .dsh-task-source code{font:inherit;overflow-wrap:anywhere}
.dsh-task-milestone pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:8px 0 0;color:var(--dsw-alias-label-secondary)}
`

const PHASE: Record<TaskSnapshot['phase'], string> = {
  planning: '规划中', 'awaiting-approval': '等待计划批准', active: '执行中',
  reviewing: '审查中', paused: '已暂停', complete: '已完成', cleared: '已清除',
}
const VERDICT = { pass: '通过', revise: '需要修订', 'needs-user': '等待用户决策' }

function nodeLabel(task: TaskSnapshot, id: string, armed: boolean, reviewing: boolean): string {
  const run = runsOf(task).find(item => item.id === id)
  if (run?.status === 'passed') return '✓ 已通过'
  if (run?.status === 'awaiting-user') return '等待用户'
  if (run?.status === 'reviewing') return reviewing ? '◉ 审查中' : '审查待恢复'
  if (task.phase === 'awaiting-approval') return '等待批准'
  if (task.phase === 'paused' || !armed) return '等待继续'
  if (run?.status === 'running') return '● 执行中'
  if (run?.status === 'needs-revision') return '需要修订'
  return readyNodes(task).includes(id) ? '可执行' : '等待依赖'
}

const SOURCE_LABEL = { user: '用户要求', project: '项目约束', implementation: '实现选择' }

const ACTION_LABEL: Record<string, string> = { approve: '批准计划', pause: '暂停', resume: '恢复任务',
  off: '关闭督导', on: '重新启用督导', clear: '清除任务' }

function TaskPanel({ sessionId, inline = false }: PanelProps & { inline?: boolean }): ReactNode {
  const store = useMemo(() => taskStore(sessionId), [sessionId])
  const { state, error, busy } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const [selected, setSelected] = useState<string | null>(null)
  const task = state?.task
  if (inline && (task === undefined || task === null || task.phase === 'cleared')) return null
  const selectedIndex = task?.stages.findIndex(item => item.id === selected) ?? -1
  const index = selectedIndex >= 0 ? selectedIndex : Math.min(task?.stageIndex ?? 0, (task?.stages.length ?? 0) - 1)
  const status = !task ? '' : !task.enabled ? '督导已关闭' : state?.reviewing ? '独立审查进行中'
    : !state?.armed && ['active', 'planning', 'reviewing'].includes(task.phase) ? '等待手动恢复' : PHASE[task.phase]
  const stage = task?.stages[index]
  const actionBar = <div className="dsh-task-actions">{state?.actions.map(action => <button key={action}
    data-action={action} disabled={busy || !state.live} onClick={() => { void store.act(action) }}>
    {ACTION_LABEL[action] ?? action}</button>)}</div>
  const content = <>
    {state === null ? <p>正在读取任务状态…</p> : task === null || task === undefined
      ? <p>在输入框使用 <code>/task new &lt;目标&gt;</code> 创建任务。</p> : <>
      <div className="dsh-task-status"><strong>{status}</strong>
        <span>{task.stages.length > 0 ? <>计划 v{task.planVersion} · 已通过 {acceptedNodes(task).length}/{task.stages.length}</> : '正在准备计划'}</span></div>
      {task.phase === 'awaiting-approval' && <p>等待你批准当前计划；也可以直接输入“批准”。</p>}
      {task.phase === 'paused' && task.lastReview?.verdict === 'needs-user' && <p>需要你的决定，任务将保持等待。</p>}
      {actionBar}
      <details><summary>任务目标</summary><p className="dsh-task-review">{task.objective}</p></details>
      <h3>执行节点</h3>
      <TaskGraph task={task} selected={stage?.id} select={setSelected}
        label={id => nodeLabel(task, id, state.armed ?? false, state.reviewing ?? false)} />
      {stage && <section className="dsh-task-card"><h3>{stage.id} · 节点详情</h3><p>{stage.description ?? stage.title}</p><small>写入范围：{stage.writePaths?.join('、') || '主 Agent 执行，尚未分配并行写入范围'}</small>
        <ul>{task.criteria.filter(item => stage.criterionIds.includes(item.id)).map(item => <li key={item.id}>{item.text}<br /><small>{item.provenance
          ? `${SOURCE_LABEL[item.provenance.kind]} · ${item.provenance.reference === 'objective' ? '任务目标' : item.provenance.reference}${item.provenance.sourceSeq === undefined ? '' : ` · seq ${item.provenance.sourceSeq}`}`
          : '历史计划 · 来源未标注'}</small></li>)}</ul></section>}
      {task.lastReview && <section className="dsh-task-card"><h3>Supervisor · 最近独立审查</h3>
        <strong>{task.lastReview.stageId} · {VERDICT[task.lastReview.verdict]}</strong>
        <p className="dsh-task-review">{task.lastReview.finding.slice(0, 240)}{task.lastReview.finding.length > 240 ? '…' : ''}</p>
        <details><summary>审查全文与证据</summary><p className="dsh-task-review">{task.lastReview.finding}</p>
          <small>主 Session 截至 seq {task.lastReview.cutoff} · 证据 {task.lastReview.evidenceSeqs?.join(', ')}<br />
          审查 Session {task.lastReview.reviewerSessionId}</small></details></section>}
      {(state.reviews?.length ?? 0) > 1 && <details><summary>审查历史（最近 {state.reviews?.length} 项）</summary>
        {state.reviews?.slice().reverse().map(review => <details key={`${review.stageId}:${review.cutoff}`}>
          <summary>{review.stageId} · {VERDICT[review.verdict]} · seq {review.cutoff}</summary>
          <p className="dsh-task-review">{review.finding}</p><small>审查 Session {review.reviewerSessionId}</small>
        </details>)}</details>}
      {!state.live && <p>打开会话后可操作；恢复执行仍需手动操作。</p>}
    </>}
    {error && <p role="alert" className="dsh-task-error">{error}</p>}
  </>
  return inline ? <details className="dsh-task-inline"><summary>
    <strong>任务督导</strong> · {status} · {task?.stages.length ? <>已通过 {acceptedNodes(task).length}/{task.stages.length}</> : '正在准备计划'}
    {task?.stages[task.stageIndex] && <> · {task.stages[task.stageIndex]?.id}</>}
    </summary><div className="dsh-task-panel">{content}</div></details>
    : <div className="dsh-task-panel"><h2>任务督导</h2>{content}</div>
}
function Panel(props: PanelProps): ReactNode { return <TaskPanel {...props} /> }
function InlineTask(props: PanelProps): ReactNode { return <TaskPanel {...props} inline /> }

/** Logged checkpoints stay visible when DSH folds the model's tool-heavy Turn. */
function MilestoneCards({ turn }: TailProps): ReactNode {
  const milestones = turn.data.get('task-supervisor-milestones')
  if (milestones === undefined || milestones.length === 0) return null
  return <div className="dsh-task-milestones" aria-label="任务督导检查点">
    {milestones.map(item => <div key={item.seq} className="dsh-task-milestone-pair">
      <section className="dsh-task-milestone" data-role="main" data-milestone={item.kind}
        aria-label="主 Agent 在主 Session 的提交">
        <div className="dsh-task-role">主 Agent · 主 Session</div>
        <strong>{item.kind === 'plan' ? '提交计划' : item.kind === 'completion' ? '申请完成' : '提交阶段报告'}</strong>
        <p>{item.kind === 'plan' ? item.report ?? item.summary : item.report ?? '已提交审查申请。'}</p>
        {item.kind === 'plan' && (item.reportDetail ?? item.detail) && <details><summary>查看计划阶段</summary>
          <pre>{item.reportDetail ?? item.detail}</pre></details>}
        {item.kind !== 'plan' && item.reportDetail && <details><summary>继续阅读主 Agent 汇报</summary>
          <pre>{item.reportDetail}</pre></details>}
        <div className="dsh-task-source">主 Session · 提交事件 seq {item.mainSeq}</div>
      </section>
      {(item.kind !== 'plan' || item.reviewerSessionId) && <section className="dsh-task-milestone" data-role="supervisor"
        data-verdict={item.verdict} data-milestone={item.kind} aria-label="Supervisor 独立审查结论">
        <div className="dsh-task-role">Supervisor · 独立审查 Session</div>
        <strong>{item.title}</strong><p>{item.summary}</p>
        {item.detail && <details><summary>继续阅读审查依据</summary><pre>{item.detail}</pre></details>}
        <div className="dsh-task-source">审查结论 · 主 Session seq {item.seq}
          {item.reviewerSessionId && <> · 审查 Session <code>{item.reviewerSessionId}</code></>}</div>
      </section>}
    </div>)}
  </div>
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register(
    { name: 'conversation.input.dock', id: `${PANEL_ID}/current` }, InlineTask,
  )))
  ctx.effect(() => ctx.uiConversation.events.register(milestoneDefinition), 'task-supervisor:milestones')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.pluginCss = 'dsh-task-supervisor'
    style.textContent = CSS + GRAPH_CSS
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
