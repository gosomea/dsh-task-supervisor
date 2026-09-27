/** Compact conversation summaries navigate to the native sidebar's detail and chat views. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { runsOf } from '../graph.ts'
import { ConsultationHost, ConsultationConversation, type ConsultationPanelProps } from './consultation.tsx'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { TaskGraph, GRAPH_CSS } from './task-graph.tsx'
import { taskStore } from './task-store.ts'
import { milestoneDefinition, type Milestone } from './milestones.ts'
import { executorLabel, nodeLabel, headline, progress, taskStatus, VERDICT } from './presentation.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { Disclosure } from './disclosure.tsx'
import { TaskOverview, type TaskNavigation } from './inline-task.tsx'
import { CSS } from './styles.ts'

const PANEL_ID = 'dsh-task-supervisor/sidebar'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'task-supervisor': TaskNavigation }
}
interface PanelProps { sessionId: string }
interface TailProps extends PanelProps { turn: { data: { get(key: 'task-supervisor-milestones'): readonly Milestone[] | undefined } } }
interface ClientContext {
  sidebarRight: { openTab(kind: string, options?: { params: TaskNavigation }): void }
  sessions: ISessions
  effect(factory: () => (() => void) | void, label?: string): void
  uiConversation: { events: { register(definition: typeof milestoneDefinition): () => void } }
  sidebarRightTabs: {
    register(definition: { id: string; kind: string; priority: 'extension'; title: () => string;
      guide: Array<{ id: string; order: number; title: () => string; description: () => string }> }): () => void
  }
  slots: {
    register(definition: { name: 'sidebar.right.pane.tab'; key: string; children: { 'task-supervisor.consultation': { kind: 'single'; scope: 'session' } } }, component: (props: ConsultationPanelProps) => ReactNode): () => void
    register(definition: { name: 'task-supervisor.consultation' }, component: (props: PropsRuntime<'task-supervisor.consultation'> & PropsRenderFactories) => ReactNode): () => void
    inject(name: string, factory: () => () => void): () => void
    register(definition: { name: string; key: string }, component: (props: PanelProps) => ReactNode): () => void
    register(definition: { name: string; id: string }, component: (props: TailProps) => ReactNode): () => void
    register(definition: { name: string; id: string }, component: (props: PanelProps) => ReactNode): () => void
  }
}

export const inject = ['sessions', 'slots', 'sidebarRightTabs', 'sidebarRight', 'uiSession', 'uiConversation']
const ACTION_LABEL: Record<string, string> = { approve: '批准计划', pause: '暂停', resume: '恢复任务',
  off: '关闭督导', on: '重新启用督导', clear: '清除任务' }
const SOURCE_LABEL = { user: '用户要求', project: '项目约束', implementation: '实现选择' }
function useTask(sessionId: string) {
  const store = useMemo(() => taskStore(sessionId), [sessionId])
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot), store }
}
function Actions({ sessionId }: PanelProps) {
  const { state, busy, store } = useTask(sessionId)
  return <div className="dsh-task-actions" aria-label="任务操作">{state?.actions.map(action => <Button size="sm" variant={action === 'approve' || action === 'resume' ? 'primary' : 'ghost'} key={action}
    data-action={action} disabled={busy || !state.live} onClick={() => { void store.act(action) }}>
    {ACTION_LABEL[action] ?? action}</Button>)}</div>
}
function InlineTask({ sessionId, open }: PanelProps & { open: (params?: TaskNavigation) => void }): ReactNode {
  const { state, error } = useTask(sessionId)
  const task = state?.task
  if (!task || task.phase === 'cleared') return null
  return <TaskOverview key={task.id} sessionId={sessionId} task={task} state={state} error={error}
    actions={<Actions sessionId={sessionId} />} open={open} />
}
function TaskPanel({ sessionId, navigation, renderConsult }: PanelProps & {
  navigation: ReturnType<ConsultationPanelProps['useTabInfo']>['tab']['navigation']; renderConsult: (id: string) => ReactNode
}): ReactNode {
  const { state, error } = useTask(sessionId)
  const [tab, setTab] = useState<'details' | 'consultation'>('details')
  const [consultation, setConsultation] = useState<string | null>(null)
  const [consultError, setConsultError] = useState('')
  const [opening, setOpening] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const detailsBody = useRef<HTMLDivElement>(null)
  const task = state?.task
  useEffect(() => {
    const params = navigation.params as TaskNavigation | undefined
    setTab(params?.view ?? 'details'); setSelected(params?.nodeId ?? null); setReviewId(params?.reviewerSessionId ?? null)
    if (detailsBody.current) detailsBody.current.scrollTop = 0
  }, [navigation.revision])
  // A replaced task must not keep the previous task's writable consultation mounted.
  useEffect(() => { setConsultation(null); setConsultError('') }, [task?.id])
  const index = Math.max(0, task?.stages.findIndex(item => item.id === selected) ?? -1)
  const stage = task?.stages[selected === null ? task.stageIndex : index]
  const review = reviewId ? state?.reviews?.find(item => item.reviewerSessionId === reviewId) : task?.lastReview
  const reviewSection = review && <section className="dsh-task-section dsh-task-card" aria-label="审查详情"><h3>Supervisor · {review.stageId === 'plan' ? '计划审查' : review.stageId === 'completion' ? '完成审查' : '节点审查'} · {VERDICT[review.verdict]}</h3>
          <p className="dsh-task-review">{review.finding}</p><Disclosure title="证据来源"><p className="dsh-task-meta">主 Session 截至 seq {review.cutoff} · 证据 {review.evidenceSeqs?.join(', ')}<br />审查 Session {review.reviewerSessionId}</p></Disclosure></section>
  function openConsultation() {
    setTab('consultation')
    if (consultation || opening || !task || !state?.live) return
    setOpening(true); setConsultError('')
    const taskId = task.id
    void fetch(`/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'consult', taskId, revision: task.revision }) })
      .then(async response => { const body = await response.json() as { consultationSessionId?: string; error?: string }
        if (!response.ok || !body.consultationSessionId) throw new Error(body.error ?? '无法打开督导对话')
        if (taskStore(sessionId).getSnapshot().state?.task?.id === taskId) setConsultation(body.consultationSessionId)
      }).catch(error => setConsultError(String(error))).finally(() => setOpening(false))
  }
  return <div className="dsh-task-panel">
    <header className="dsh-task-panel-header"><h2>任务督导</h2>
      <div className="dsh-task-status"><span>{state ? taskStatus(state) : '正在读取…'}</span><span>{task ? `计划 v${task.planVersion} · ${progress(task)}` : ''}</span></div>
      <div className="dsh-task-tabs" role="tablist" aria-label="督导视图">
        <button type="button" role="tab" id={`task-details-tab-${sessionId}`} aria-controls={`task-details-${sessionId}`} aria-selected={tab === 'details'} onClick={() => setTab('details')}>任务详情</button>
        <button type="button" role="tab" id={`task-chat-tab-${sessionId}`} aria-controls={`task-chat-${sessionId}`} aria-selected={tab === 'consultation'} onClick={openConsultation}>督导对话</button>
      </div>
    </header>
    <div ref={detailsBody} className="dsh-task-body" role="tabpanel" id={`task-details-${sessionId}`} aria-labelledby={`task-details-tab-${sessionId}`} hidden={tab !== 'details'}>
      {reviewId && (reviewSection ?? <p role="status">这次审查已超出当前历史窗口，请从原生会话日志查看原始记录。</p>)}
      {!task ? <p>使用 <code>/task new &lt;目标&gt;</code> 创建受督导任务。</p> : <>
        <section className="dsh-task-section"><h3>任务目标</h3><Disclosure title={headline(task.objective, 72)}><p className="dsh-task-objective">{task.objective}</p></Disclosure></section>
        <section className="dsh-task-section"><h3>执行计划 · {task.stages.length} 个节点</h3>
          <TaskGraph task={task} selected={stage?.id} select={setSelected} label={id => nodeLabel(task, id, state)} executor={id => executorLabel(task, sessionId, id)} />
        </section>
        {stage && <section className="dsh-task-section dsh-task-card"><h3>节点详情 · {nodeLabel(task, stage.id, state)}</h3><h4>{stage.title}</h4><p className="dsh-task-muted">执行者：{executorLabel(task, sessionId, stage.id)}</p>
          <p className="dsh-task-review">{stage.description ?? '暂无补充说明。'}</p>
          <Disclosure title={`验收标准 · ${stage.criterionIds.length} 项`}><ul>{task.criteria.filter(item => stage.criterionIds.includes(item.id)).map(item => <li key={item.id}>{item.text}<br /><small>{item.provenance
            ? `${SOURCE_LABEL[item.provenance.kind]} · ${item.provenance.reference === 'objective' ? '任务目标' : item.provenance.reference}` : '历史计划 · 来源未标注'}</small></li>)}</ul></Disclosure>
          <Disclosure title="执行与证据标识"><p className="dsh-task-meta">{stage.id}<br />执行 Session：{runsOf(task).find(run => run.id === stage.id)?.sessionId ?? sessionId}<br />尝试 {runsOf(task).find(run => run.id === stage.id)?.attempt ?? 1}</p>
            <p>依赖：{stage.dependsOn?.join('、') || '无显式依赖'}</p><p>写入范围：{stage.writePaths?.join('、') || '主 Agent 执行'}</p></Disclosure>
        </section>}
        {!reviewId && reviewSection}
        {(state.reviews?.length ?? 0) > 1 && <section className="dsh-task-section"><Disclosure title={`审查历史 · 最近 ${state.reviews?.length} 项`}>
          {state.reviews?.slice().reverse().map(item => <Disclosure key={`${item.stageId}:${item.cutoff}`} title={`${item.stageId} · ${VERDICT[item.verdict]} · ${headline(item.finding, 34)}`}><p className="dsh-task-review">{item.finding}</p></Disclosure>)}
        </Disclosure></section>}
      </>}
    </div>
    <div className="dsh-task-chat-body" role="tabpanel" id={`task-chat-${sessionId}`} aria-labelledby={`task-chat-tab-${sessionId}`} hidden={tab !== 'consultation'}>
      {consultation ? renderConsult(consultation) : <div className="dsh-task-empty"><p>{opening ? '正在连接督导对话…' : '了解当前进度，或明确提出暂停、恢复等操作。普通问询不会打断任务。'}</p>
        {!opening && <Button size="sm" variant="toolbar" disabled={!task || !state?.live} onClick={openConsultation}>打开督导对话</Button>}
        {consultError && <p role="alert">{consultError}</p>}</div>}
    </div>
    {error && <p role="alert" className="dsh-task-error">{error}</p>}
    {task && <footer className="dsh-task-footer"><Actions sessionId={sessionId} />
      {task.phase === 'paused' && <small className="dsh-task-muted">等待手动恢复</small>}
      {task.phase === 'awaiting-approval' && <small className="dsh-task-muted">也可在主会话输入“批准”</small>}
    </footer>}
  </div>
}
/** Only Supervisor findings are projected; native main-Agent messages stay untouched. */
function ReviewNotes({ turn, open }: TailProps & { open: (params?: TaskNavigation) => void }): ReactNode {
  const milestones = turn.data.get('task-supervisor-milestones')
  return <>{milestones?.filter(item => item.reviewerSessionId).map(item => <section key={item.seq} className="dsh-task-review-note" aria-label="Supervisor 审查摘要">
    <span className="dsh-task-dot" data-verdict={item.verdict} aria-hidden="true" />
    <div className="dsh-task-review-copy"><strong>Supervisor · {item.title}</strong><p>{headline(item.summary, 90)}</p></div>
    <Button size="sm" onClick={() => open({ reviewerSessionId: item.reviewerSessionId! })}>查看审查</Button>
  </section>)}</>
}
export function apply(ctx: ClientContext): void {
  const open = (params: TaskNavigation = {}) => ctx.sidebarRight.openTab('task-supervisor', { params })
  const Panel = (props: ConsultationPanelProps) => {
    const { tab } = props.useTabInfo()
    return <TaskPanel key={props.sessionId} sessionId={props.sessionId} navigation={tab.navigation}
      renderConsult={id => <ConsultationHost id={id} sessions={ctx.sessions} SessionProvider={props.SessionProvider} renderSlot={props.renderSlot} />} />
  }
  const Inline = (props: PanelProps) => <InlineTask {...props} open={open} />
  const Notes = (props: TailProps) => <ReviewNotes {...props} open={open} />
  ctx.effect(() => ctx.slots.inject('task-supervisor.consultation', () => ctx.slots.register({ name: 'task-supervisor.consultation' }, ConsultationConversation)))
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: `${PANEL_ID}/current` }, Inline)))
  ctx.effect(() => ctx.uiConversation.events.register(milestoneDefinition), 'task-supervisor:milestones')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.pluginCss = 'dsh-task-supervisor'; style.textContent = CSS + GRAPH_CSS
    document.head.append(style); return () => { style.remove() } })
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: PANEL_ID, kind: 'task-supervisor', priority: 'extension', title: () => '任务督导',
    guide: [{ id: 'task-supervisor', order: 5, title: () => '任务督导', description: () => '查看任务详情或与督导对话' }] }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PANEL_ID,
    children: { 'task-supervisor.consultation': { kind: 'single', scope: 'session' } } }, Panel)))
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: `${PANEL_ID}/milestones` }, Notes)))
}
