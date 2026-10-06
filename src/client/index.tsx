/** Compact conversation summaries navigate to the native sidebar's detail and chat views. */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { runsOf, dependencies } from '../graph.ts'
import type { TaskHistoryEntry } from '../state.ts'
import { ConsultationHost, ConsultationConversation, type ConsultationPanelProps } from './consultation.tsx'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsRuntime, PropsRenderFactories } from '@deepseek-ai/dsh-client-ui-slots'
import { TaskGraph, GRAPH_CSS } from './task-graph.tsx'
import { taskStore, type PanelState } from './task-store.ts'
import { milestoneDefinition, type Milestone } from './milestones.ts'
import { executorLabel, nodeLabel, headline, progress, taskStatus, VERDICT } from './presentation.ts'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { Disclosure } from './disclosure.tsx'
import { TaskOverview, type TaskNavigation } from './inline-task.tsx'
import { RepairPanel } from './repair-panel.tsx'
import { AttemptDetails } from './attempt-details.tsx'
import { ReviewInspection } from './review-inspection.tsx'
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
const ACTION_LABEL: Record<string, string> = { 'auto-approve-on': '审查通过后自动执行', 'auto-approve-off': '改为手动批准', approve: '批准计划', pause: '暂停', resume: '恢复任务', 'retry-review': '重试审查',
  off: '关闭督导', on: '重新启用督导' }
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
  const previous = useRef<{ id: string | null; phase: string | null } | null>(null)
  useEffect(() => {
    if (!state) return
    const before = previous.current
    if (before && task && (before.id !== task.id || (task.phase === 'paused' && before.phase !== 'paused'))) {
      open({ view: 'details' })
    }
    previous.current = { id: task?.id ?? null, phase: task?.phase ?? null }
  }, [state, task?.id, task?.phase, open])
  if (!task || task.phase === 'cleared') return null
  return <TaskOverview key={task.id} sessionId={sessionId} task={task} state={state} error={error}
    actions={state.actions.length ? <Actions sessionId={sessionId} /> : null} open={open} />
}

function HistoricalDetails({ entry, sessionId }: { entry: TaskHistoryEntry; sessionId: string }): ReactNode {
  const [selected, setSelected] = useState<string | null>(null)
  const { state, busy, store } = useTask(sessionId)
  const task = entry.task
  const stage = task.stages.find(item => item.id === selected) ?? task.stages[task.stageIndex] ?? task.stages[0]
  const historicalState: PanelState = { task, live: false, armed: false, reviewing: false, actions: [], reviews: entry.reviews, reworks: entry.reworks }
  return <>
    <section className="dsh-task-section"><h3>任务目标</h3><p className="dsh-task-objective">{task.objective}</p>
      <p className="dsh-task-muted">{task.phase === 'complete' ? '已完成' : '已清除'} · 记录 seq {entry.lastSeq}</p></section>
    {task.stages.length > 0 && <section className="dsh-task-section"><h3>执行计划 · {task.stages.length} 个节点</h3>
      <TaskGraph task={task} reworks={entry.reworks} selected={stage?.id} select={setSelected}
        label={id => nodeLabel(task, id, historicalState)} executor={id => executorLabel(task, sessionId, id)} />
    </section>}
    {stage && <section className="dsh-task-section dsh-task-card"><h3>节点详情 · {nodeLabel(task, stage.id, historicalState)}</h3>
      <h4>{stage.title}</h4><p className="dsh-task-muted">执行者：{executorLabel(task, sessionId, stage.id)}</p>
      <AttemptDetails task={task} nodeId={stage.id} state={historicalState} />
      <p className="dsh-task-review">{stage.description ?? '暂无补充说明。'}</p>
      <Disclosure title={`验收标准 · ${stage.criterionIds.length} 项`}><ul>{task.criteria.filter(item => stage.criterionIds.includes(item.id))
        .map(item => <li key={item.id}>{item.text}</li>)}</ul></Disclosure>
    </section>}
    {state && <RepairPanel key={task.id} task={task} state={state} busy={busy} store={store} />}
    {entry.reviews.length > 0 && <section className="dsh-task-section dsh-task-card"><h3>审查记录 · {entry.reviews.length} 项</h3>
      {entry.reviews.slice().reverse().map(review => <Disclosure key={`${review.stageId}:${review.cutoff}`}
        title={`${review.stageId} · ${VERDICT[review.verdict]} · ${headline(review.finding, 36)}`}>
        <p className="dsh-task-review">{review.finding}</p><p className="dsh-task-meta">主 Session 截至 seq {review.cutoff} · 审查 Session {review.reviewerSessionId ?? '未记录'}</p>
      </Disclosure>)}
    </section>}
  </>
}
/** Read retained records through the Host; no reviewer Agent or writable composer is opened. */
function ReviewLog({ sessionId, reviewerSessionId }: { sessionId: string; reviewerSessionId: string }) {
  const [records, setRecords] = useState<Array<{ seq: number; type: string; data: unknown }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController(); setError(''); setRecords([])
    void fetch(`/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}&view=review-log&reviewerSessionId=${encodeURIComponent(reviewerSessionId)}`,
      { signal: abort.signal, cache: 'no-store' }).then(async response => {
        const body = await response.json() as { events?: typeof records; error?: string }
        if (!response.ok || !body.events) throw new Error(body.error ?? '无法读取审查原始记录')
        if (!abort.signal.aborted) setRecords(body.events)
      }).catch(error => { if (!abort.signal.aborted) setError(String(error)) })
    return () => abort.abort()
  }, [sessionId, reviewerSessionId])
  return <section className="dsh-task-section" aria-label="只读审查原始记录"><h3>原始审查记录 · 只读</h3>
    <p className="dsh-task-meta">{reviewerSessionId} · 最近 100 条记录，长文本按证据协议截断</p>
    {error && <p role="alert">{error}</p>}{records.map(record => <Disclosure key={record.seq} title={`seq ${record.seq} · ${record.type}`}>
      <pre className="dsh-task-log-record">{JSON.stringify(record, null, 2)}</pre></Disclosure>)}</section>
}
function TaskPanel({ sessionId, navigation, renderConsult }: PanelProps & {
  navigation: ReturnType<ConsultationPanelProps['useTabInfo']>['tab']['navigation']; renderConsult: (id: string) => ReactNode
}): ReactNode {
  const { state, error, busy, store } = useTask(sessionId)
  const [tab, setTab] = useState<'details' | 'consultation'>('details')
  const [showHistory, setShowHistory] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<TaskHistoryEntry[] | null>(null)
  const [historySelection, setHistorySelection] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [mode, setMode] = useState<'discussion' | 'direct'>('discussion')
  const [modeBusy, setModeBusy] = useState(false)
  const [consultation, setConsultation] = useState<string | null>(null)
  const [consultError, setConsultError] = useState('')
  const [opening, setOpening] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [reviewId, setReviewId] = useState<string | null>(null)
  const detailsBody = useRef<HTMLDivElement>(null)
  const historyBody = useRef<HTMLDivElement>(null)
  const task = state?.task
  const previousTaskId = useRef<string | null>(null)
  useEffect(() => {
    const params = navigation.params as TaskNavigation | undefined
    setTab(params?.view ?? 'details'); setSelected(params?.nodeId ?? null); setReviewId(params?.reviewerSessionId ?? null)
    if (detailsBody.current) detailsBody.current.scrollTop = 0
  }, [navigation.revision])
  // Keep the main-scoped conversation mounted when the current task changes.
  useEffect(() => {
    if (previousTaskId.current && previousTaskId.current !== task?.id) {
      setTab('details'); setShowHistory(false); setSelected(null); setReviewId(null)
    }
    previousTaskId.current = task?.id ?? null
  }, [task?.id])
  const index = Math.max(0, task?.stages.findIndex(item => item.id === selected) ?? -1)
  const stage = task?.stages[selected === null ? task.stageIndex : index]
  const review = reviewId ? state?.reviews?.find(item => item.reviewerSessionId === reviewId) : task?.lastReview
  const reviewJob = state?.reviewJobs?.filter(item => item.taskId === task?.id).findLast(item => reviewId ? item.reviewerSessionId === reviewId : true)
  const historicalTask = historyEntries?.find(entry => entry.task.id === historySelection)
  useEffect(() => {
    if (showHistory && historySelection === task?.id && task && !['complete', 'cleared'].includes(task.phase)) {
      setShowHistory(false); setHistorySelection(null); setTab('details'); setSelected(null)
    }
  }, [showHistory, historySelection, task?.id, task?.phase])
  const canCreate = state?.live && (!task || task.phase === 'complete' || task.phase === 'cleared')
  const reviewSection = review && <section className="dsh-task-section dsh-task-card" aria-label="审查详情"><h3>Supervisor · {review.stageId === 'planning' ? '规划进展审查' : review.stageId === 'plan' ? '计划审查' : review.stageId === 'completion' ? task?.phase === 'complete' && state?.repairs?.some(p => p.taskId === task.id && ['pending', 'confirmed'].includes(p.status)) ? '此前完成审查' : '完成审查' : '节点审查'} · {VERDICT[review.verdict]}</h3>
          <p className="dsh-task-review">{review.finding}</p><Disclosure title="证据来源"><p className="dsh-task-meta">主 Session 截至 seq {review.cutoff} · 证据 {review.evidenceSeqs?.join(', ')}<br />审查 Session {review.reviewerSessionId}</p></Disclosure></section>
  function openConsultation() {
    setTab('consultation')
    if (consultation || opening || !state?.live) return
    setOpening(true); setConsultError('')
    void fetch(`/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'consult' }) })
      .then(async response => { const body = await response.json() as { consultationSessionId?: string; consultationMode?: 'discussion' | 'direct'; error?: string }
        if (!response.ok || !body.consultationSessionId) throw new Error(body.error ?? '无法打开督导对话')
        setConsultation(body.consultationSessionId); setMode(body.consultationMode ?? 'discussion')
      }).catch(error => setConsultError(String(error))).finally(() => setOpening(false))
  }
  function openHistory() {
    setShowHistory(true); setHistorySelection(null); setHistoryBusy(true); setHistoryError('')
    if (historyBody.current) historyBody.current.scrollTop = 0
    void fetch(`/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}&view=history`, { cache: 'no-store' })
      .then(async response => { const body = await response.json() as { entries?: TaskHistoryEntry[]; error?: string }
        if (!response.ok || !body.entries) throw new Error(body.error ?? '无法读取历史任务')
        setHistoryEntries(body.entries)
      }).catch(error => setHistoryError(String(error))).finally(() => setHistoryBusy(false))
  }
  async function changeMode(next: 'discussion' | 'direct') {
    if (modeBusy) return
    setModeBusy(true); setConsultError('')
    try {
      const response = await fetch(`/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'consult-mode', mode: next }) })
      const body = await response.json() as { consultationMode?: 'discussion' | 'direct'; error?: string }
      if (!response.ok || !body.consultationMode) throw new Error(body.error ?? '无法切换输入方式')
      setMode(body.consultationMode)
    } catch (error) { setConsultError(String(error)) } finally { setModeBusy(false) }
  }
  useEffect(() => {
    if (state?.live && !task) openConsultation()
  }, [state?.live, task?.id])
  function closeHistory() { setShowHistory(false); setHistorySelection(null) }
  function selectHistory(id: string | null) {
    setHistorySelection(id)
    if (historyBody.current) historyBody.current.scrollTop = 0
  }
  return <div className="dsh-task-panel">
    <header className="dsh-task-panel-header"><div className="dsh-task-panel-heading"><h2>任务督导</h2>
      <Button size="sm" variant="toolbar" onClick={() => showHistory ? closeHistory() : openHistory()}>
        {showHistory ? '返回当前任务' : '历史任务'}</Button></div>
      <div className="dsh-task-status"><span>{showHistory ? '已结束的任务' : state ? taskStatus(state) : '正在读取…'}</span>
        <span>{showHistory ? `${historyEntries?.length ?? 0} 项` : task ? `计划 v${task.planVersion} · ${progress(task)}` : ''}</span></div>
      {!showHistory && <div className="dsh-task-tabs" role="tablist" aria-label="督导视图">
        <button type="button" role="tab" id={`task-details-tab-${sessionId}`} aria-controls={`task-details-${sessionId}`} aria-selected={tab === 'details'} onClick={() => setTab('details')}>任务详情</button>
        <button type="button" role="tab" id={`task-chat-tab-${sessionId}`} aria-controls={`task-chat-${sessionId}`} aria-selected={tab === 'consultation'} onClick={openConsultation}>督导对话</button>
      </div>}
    </header>
    {showHistory && <div ref={historyBody} className="dsh-task-body dsh-task-history" aria-label="历史任务">
      {historicalTask ? <><Button size="sm" variant="toolbar" onClick={() => selectHistory(null)}>返回历史列表</Button>
        <HistoricalDetails key={historicalTask.task.id} entry={historicalTask} sessionId={sessionId} /></> : <>
        <section className="dsh-task-section"><Button size="sm" variant="primary" disabled={!state?.live}
          onClick={() => { closeHistory(); openConsultation() }}>讨论新任务</Button></section>
        <section className="dsh-task-section"><h3>已结束 · {historyEntries?.length ?? 0} 项</h3>
          {historyBusy && <p>正在读取历史任务…</p>}
          {!historyBusy && historyEntries?.length === 0 && <p className="dsh-task-muted">这里还没有已结束的任务。</p>}
          {historyEntries?.map(entry => <button type="button" className="dsh-task-history-item" key={entry.task.id}
            onClick={() => selectHistory(entry.task.id)}>
            <strong>{headline(entry.task.objective, 72)}</strong>
            <small>{entry.task.phase === 'complete' ? '已完成' : '已清除'} · {progress(entry.task)} · seq {entry.lastSeq}</small>
          </button>)}
        </section>
      </>}
      {historyError && <p role="alert" className="dsh-task-error">{historyError}</p>}
      {error && <p role="alert" className="dsh-task-error">{error}</p>}
    </div>}
    <div ref={detailsBody} className="dsh-task-body" role="tabpanel" id={`task-details-${sessionId}`} aria-labelledby={`task-details-tab-${sessionId}`} hidden={showHistory || tab !== 'details'}>
      {reviewId && !review && <div className="dsh-task-evidence-chat"><ReviewLog sessionId={sessionId} reviewerSessionId={reviewId} /></div>}
      {reviewId && (reviewSection ?? <p role="status">这次审查已超出当前历史窗口，请从原生会话日志查看原始记录。</p>)}
      {task && <section className="dsh-task-section"><h3>执行批准</h3><p>{task.approvalPolicy?.mode === 'after-review' && task.approvalPolicy.mainSessionId === sessionId && task.approvalPolicy.requirementsVersion === task.requirementsVersion ? '按你的设置：计划通过独立审查后自动执行' : '手动批准计划后执行'}</p>{task.approvalPolicy && <small className="dsh-task-meta">来源：{task.approvalPolicy.source === 'profile' ? 'DSH profile 设置' : '用户任务设置'} · 授权事件 seq {task.approvalPolicy.grantSeq}</small>}{task.lastApproval?.source === 'policy' && task.lastApproval.planVersion === task.planVersion && <p>本计划按预授权自动批准 · 授权 seq {task.lastApproval.authorizationSeq} · 审查作业 {task.lastApproval.reviewJobId}</p>}</section>}
      {task?.planning && task.planning.requirementsVersion === task.requirementsVersion && <section className="dsh-task-section"><h3>规划进展 · Supervisor</h3><p>{task.planning.nextAction}</p><Disclosure title={`已确认 ${task.planning.facts.length} 项 · 待核对 ${task.planning.unknowns.length} 项`}><h4>已确认事实</h4><ul>{task.planning.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul><h4>未决问题</h4><ul>{task.planning.unknowns.map((question, i) => <li key={i}>{question}</li>)}</ul><p className="dsh-task-meta">要求 v{task.planning.requirementsVersion} · 截至 seq {task.planning.cutoff} · 证据 {task.planning.evidenceSeqs.join(', ')} · 连续无进展 {task.planning.noProgress} 次</p></Disclosure></section>}
      {task?.pauseReason === 'planning-stalled' && <p role="status">独立规划检查未发现新的相关进展，已暂停。检查未决问题后可手动恢复。</p>}
      {task?.recovery && <section className="dsh-task-section"><Disclosure title="生成截断后的续行记录"><p>原回合 {task.recovery.turn} · 结束事件 seq {task.recovery.endSeq} · 连续无进展 {task.recovery.noProgress} 次</p><p className="dsh-task-review">{task.recovery.instruction}</p></Disclosure></section>}
      {task?.pauseReason === 'recovery-stalled' && <p role="status">连续恢复未产生可核实的新进展，已暂停。检查现状后可手动恢复或修改目标。</p>}
      {task?.reviewFault && <section className="dsh-task-fault" role="alert"><h3>审查故障 · 尚未形成有效决定</h3><p>任务已暂停，已保存审查现场。重试只恢复审查；后续执行仍需明确恢复。</p><Disclosure title="诊断详情"><p>错误：{task.reviewFault.code}<br />{task.reviewFault.message}<br />尝试 {task.reviewFault.attempt} · 原证据截止 {task.reviewFault.cutoff}<br />错误事件 {task.reviewFault.errorSeq ?? '无'} · 审查 Session {task.reviewFault.reviewerSessionId ?? '尚未创建'}</p>{task.reviewFault.reviewerSessionId && <Button size="sm" variant="toolbar" onClick={() => setReviewId(task.reviewFault!.reviewerSessionId!)}>查看审查原始对话</Button>}</Disclosure></section>}
      {state?.reviewVerification && <p className="dsh-task-muted">续行控制：Supervisor · 原生 Goal／Plan 可用于规划，不代替任务批准与验收。<br />验收模式：{state.reviewVerification === 'independent' ? '独立产物验证' : '日志证据审查'} · 计划与进展采用日志审查</p>}
      {reviewJob && <ReviewInspection job={reviewJob} />}
      {!task ? <p>未启用任务督导。模式选择不会创建任务；你可以在主会话中明确要求创建 Task，或在督导对话中整理草案。</p> : <>
        <section className="dsh-task-section"><h3>任务目标</h3><Disclosure title={headline(task.objective, 72)}><p className="dsh-task-objective">{task.objective}</p></Disclosure></section>
        <section className="dsh-task-section"><h3>执行计划 · {task.stages.length} 个节点</h3>
          <TaskGraph task={task} reworks={state.reworks} selected={stage?.id} select={setSelected} label={id => nodeLabel(task, id, state)} executor={id => executorLabel(task, sessionId, id)} />
        </section>
        {stage && <section className="dsh-task-section dsh-task-card"><h3>节点详情 · {nodeLabel(task, stage.id, state)}</h3><h4>{stage.title}</h4><p className="dsh-task-muted">执行者：{executorLabel(task, sessionId, stage.id)}</p>
          <AttemptDetails task={task} nodeId={stage.id} state={state} />
          <p className="dsh-task-review">{stage.description ?? '暂无补充说明。'}</p>
          <Disclosure title={`验收标准 · ${stage.criterionIds.length} 项`}><ul>{task.criteria.filter(item => stage.criterionIds.includes(item.id)).map(item => <li key={item.id}>{item.text}<br /><small>{item.provenance
            ? `${SOURCE_LABEL[item.provenance.kind]} · ${item.provenance.reference === 'objective' ? '任务目标' : item.provenance.reference}` : '历史计划 · 来源未标注'}</small></li>)}</ul></Disclosure>
          <Disclosure title="执行与证据标识"><p className="dsh-task-meta">{stage.id}<br />执行 Session：{runsOf(task).find(run => run.id === stage.id)?.sessionId ?? sessionId}<br />尝试 {runsOf(task).find(run => run.id === stage.id)?.attempt ?? 1}</p>
            <p>依赖：{dependencies(task.stages, task.stages.indexOf(stage)).join('、') || '无依赖'}</p><p>写入范围：{stage.writePaths?.join('、') || '主 Agent 执行'}</p></Disclosure>
        </section>}
        <RepairPanel key={task.id} task={task} state={state} busy={busy} store={store} />
        {!reviewId && reviewSection}
        {(state.reviews?.length ?? 0) > 1 && <section className="dsh-task-section"><Disclosure title={`审查历史 · 最近 ${state.reviews?.length} 项`}>
          {state.reviews?.slice().reverse().map(item => <Disclosure key={`${item.stageId}:${item.cutoff}`} title={`${item.stageId} · ${VERDICT[item.verdict]} · ${headline(item.finding, 34)}`}><p className="dsh-task-review">{item.finding}</p></Disclosure>)}
        </Disclosure></section>}
      </>}
    </div>
    <div className="dsh-task-chat-body" role="tabpanel" id={`task-chat-${sessionId}`} aria-labelledby={`task-chat-tab-${sessionId}`} hidden={showHistory || tab !== 'consultation'}>
      <div className="dsh-task-conversation-toolbar"><span>讨论对象：{state?.draft && state.draft.status !== 'created' ? '新任务草案' : task ? '当前任务 / 新任务筹备' : '新任务'}</span>
        <div role="group" aria-label="发送方式"><Button size="sm" variant={mode === 'discussion' ? 'outline' : 'ghost'} disabled={modeBusy || !state?.live} aria-pressed={mode === 'discussion'} onClick={() => { void changeMode('discussion') }}>讨论</Button>
          <Button size="sm" variant={mode === 'direct' ? 'outline' : 'ghost'} disabled={modeBusy || !state?.live} aria-pressed={mode === 'direct'} onClick={() => { void changeMode('direct') }}>直接建任务</Button></div>
        <small>{mode === 'direct' ? '下一条完整目标将直接交给主 Agent 规划；执行前仍需批准计划。' : '先讨论或润色要求；普通消息不会创建任务。'}</small></div>
      {state?.draft && state.draft.status !== 'created' && <section className="dsh-task-draft" aria-label="任务草案"><div className="dsh-task-panel-heading"><strong>{state.draft.title}</strong><small>草案 v{state.draft.version}</small></div>
        <Disclosure title="查看完整要求"><p className="dsh-task-objective">{state.draft.requirements}</p></Disclosure>
        {state.draft.questions.length > 0 && <Disclosure title={`待确认 · ${state.draft.questions.length} 项`}><ul>{state.draft.questions.map((item, index) => <li key={index}>{item}</li>)}</ul></Disclosure>}
        <div className="dsh-task-draft-actions"><Button size="sm" variant="primary" disabled={!canCreate || busy || state.draft.questions.length > 0}
          onClick={() => { if (state.draft) void store.promote(state.draft.id, state.draft.version) }}>创建任务</Button><small>{!canCreate ? '草案已保存，当前任务结束后可创建。' : '在对话中描述需要修改的内容即可修订草案。'}</small></div></section>}
      {consultError && <p role="alert" className="dsh-task-error">{consultError}</p>}
      {consultation ? renderConsult(consultation) : <div className="dsh-task-empty"><p>{opening ? '正在连接督导对话…' : '了解当前进度，或明确提出暂停、恢复等操作。普通问询不会打断任务。'}</p>
        {!opening && <Button size="sm" variant="toolbar" disabled={!state?.live} onClick={openConsultation}>打开督导对话</Button>}
        {consultError && <p role="alert">{consultError}</p>}</div>}
    </div>
    {error && <p role="alert" className="dsh-task-error">{error}</p>}
    {task && !showHistory && tab === 'details' && ((state?.actions.length ?? 0) > 0 || task.phase === 'paused' || task.phase === 'awaiting-approval') && <footer className="dsh-task-footer"><Actions sessionId={sessionId} />
      {task.phase === 'paused' && <small className="dsh-task-muted">等待手动恢复</small>}
      {task.phase === 'awaiting-approval' && <small className="dsh-task-muted">也可在主会话输入“批准”</small>}
    </footer>}
  </div>
}
/** Review findings and applied reworks are notices; native main-Agent answers stay untouched. */
function ReviewNotes({ turn, open }: TailProps & { open: (params?: TaskNavigation) => void }): ReactNode {
  const milestones = turn.data.get('task-supervisor-milestones')
  return <>{milestones?.filter(item => item.reviewerSessionId || item.kind === 'rework').map(item => <section key={item.seq} className="dsh-task-review-note" aria-label={item.kind === 'rework' ? '任务返工记录' : 'Supervisor 审查摘要'}>
    <span className="dsh-task-dot" data-verdict={item.kind === 'rework' ? 'revise' : item.verdict} aria-hidden="true" />
    <div className="dsh-task-review-copy"><strong>{item.kind === 'rework' ? '任务督导' : 'Supervisor'} · {item.title}</strong><p>{headline(item.summary, 90)}</p></div>
    <Button size="sm" onClick={() => open(item.kind === 'rework' ? { nodeId: item.nodeId! } : { reviewerSessionId: item.reviewerSessionId! })}>{item.kind === 'rework' ? '查看返工' : '查看审查'}</Button>
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
