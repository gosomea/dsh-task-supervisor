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
import { displayedPlan, executorLabel, nodeLabel, headline, progress, taskStatus, VERDICT } from './presentation.ts'
import { ReviewProgress } from './review-progress.tsx'
import { Button, Menu, Modal, IconEllipsisOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { Disclosure } from './disclosure.tsx'
import { TaskOverview, type TaskNavigation } from './inline-task.tsx'
import { RepairPanel } from './repair-panel.tsx'
import { AttemptDetails } from './attempt-details.tsx'
import { ReviewInspection } from './review-inspection.tsx'
import { CSS } from './styles.ts'
import { draftDefinition, type DraftCard } from './draft-events.ts'
import { zh, en, type SupervisorTranslate } from './locales.ts'

const PANEL_ID = 'dsh-task-supervisor/sidebar'
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap { 'task-supervisor': TaskNavigation }
}
interface PanelProps { sessionId: string }
interface TailProps extends PanelProps { turn: { data: { get(key: 'task-supervisor-milestones'): readonly Milestone[] | undefined; get(key: 'task-supervisor-drafts'): readonly DraftCard[] | undefined } } }
interface ClientContext {
  locale: { register(namespace: string, dictionaries: { zh: typeof zh; en: typeof en }): () => void; bind(namespace: string): SupervisorTranslate }
  sidebarRight: { openTab(kind: string, options?: { params: TaskNavigation }): void }
  sessions: ISessions
  effect(factory: () => (() => void) | void, label?: string): void
  uiConversation: { events: { register(definition: typeof milestoneDefinition | typeof draftDefinition): () => void } }
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

export const inject = ['sessions', 'slots', 'sidebarRightTabs', 'sidebarRight', 'uiSession', 'uiConversation', 'locale']
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
  if (state?.entryActive) return <div className="dsh-task-actions"><span>任务规划 · 等待输入目标</span><Button size="sm" variant="toolbar" onClick={() => open({ view: 'details' })}>查看详情</Button></div>
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
function ReviewLog({ sessionId, reviewerSessionId, active = false }: { sessionId: string; reviewerSessionId: string; active?: boolean }) {
  const [records, setRecords] = useState<Array<{ seq: number; type: string; data: unknown }>>([])
  const [error, setError] = useState('')
  useEffect(() => {
    const abort = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined; setError(''); setRecords([])
    const load = () => fetch(`/api/task-supervisor?sessionId=${encodeURIComponent(sessionId)}&view=review-log&reviewerSessionId=${encodeURIComponent(reviewerSessionId)}`,
      { signal: abort.signal, cache: 'no-store' }).then(async response => {
        const body = await response.json() as { events?: typeof records; error?: string }
        if (!response.ok || !body.events) throw new Error(body.error ?? '无法读取审查原始记录')
        if (!abort.signal.aborted) { setRecords(body.events); setError('') }
      }).catch(error => { if (!abort.signal.aborted) setError(String(error)) })
        .finally(() => { if (active && !abort.signal.aborted) timer = setTimeout(() => { void load() }, 2000) })
    void load()
    return () => { abort.abort(); clearTimeout(timer) }
  }, [sessionId, reviewerSessionId, active])
  return <section className="dsh-task-section" aria-label="只读审查原始记录"><h3>原始审查记录 · 只读</h3>
    <p className="dsh-task-meta">{reviewerSessionId} · 最近 100 条记录，长文本按证据协议截断</p>
    {error && <p role="alert">{error}</p>}{records.map(record => <Disclosure key={record.seq} title={`seq ${record.seq} · ${record.type}`}>
      <pre className="dsh-task-log-record">{JSON.stringify(record, null, 2)}</pre></Disclosure>)}</section>
}
function TaskPanel({ sessionId, navigation, renderConsult, t }: PanelProps & {
  navigation: ReturnType<ConsultationPanelProps['useTabInfo']>['tab']['navigation']; renderConsult: (id: string) => ReactNode; t: SupervisorTranslate
}): ReactNode {
  const { state, error, busy, store } = useTask(sessionId)
  const [tab, setTab] = useState<'details' | 'consultation'>('details')
  const [showHistory, setShowHistory] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<TaskHistoryEntry[] | null>(null)
  const [historySelection, setHistorySelection] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
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
  const plan = state ? displayedPlan(state) : null
  const graphTask = plan?.task ?? task
  const index = Math.max(0, graphTask?.stages.findIndex(item => item.id === selected) ?? -1)
  const stage = graphTask?.stages[selected === null ? graphTask.stageIndex : index]
  const review = reviewId ? state?.reviews?.find(item => item.reviewerSessionId === reviewId) : task?.lastReview
  const reviewJob = state?.reviewJobs?.filter(item => item.taskId === task?.id).findLast(item => reviewId ? item.reviewerSessionId === reviewId : true)
  const historicalTask = historyEntries?.find(entry => entry.task.id === historySelection)
  useEffect(() => {
    if (showHistory && historySelection === task?.id && task && !['complete', 'cleared'].includes(task.phase)) {
      setShowHistory(false); setHistorySelection(null); setTab('details'); setSelected(null)
    }
  }, [showHistory, historySelection, task?.id, task?.phase])
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
        setConsultation(body.consultationSessionId)
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
  useEffect(() => {
    if (state?.live && !task) openConsultation()
  }, [state?.live, task?.id])
  function closeHistory() { setShowHistory(false); setHistorySelection(null) }
  function selectHistory(id: string | null) {
    setHistorySelection(id)
    if (historyBody.current) historyBody.current.scrollTop = 0
  }
  return <div className="dsh-task-panel">
    <header className="dsh-task-panel-header">
      <div className="dsh-task-panel-navigation">
        {showHistory ? <Button size="sm" variant="toolbar" onClick={closeHistory}>{t('back')}</Button> : <div className="dsh-task-tabs" role="tablist" aria-label="督导视图">
          <button type="button" role="tab" id={`task-chat-tab-${sessionId}`} aria-controls={`task-chat-${sessionId}`} aria-selected={tab === 'consultation'} onClick={openConsultation}>{t('chat')}</button>
          <button type="button" role="tab" id={`task-details-tab-${sessionId}`} aria-controls={`task-details-${sessionId}`} aria-selected={tab === 'details'} onClick={() => setTab('details')}>{t('details')}</button>
        </div>}
        <Menu open={menuOpen} align="end" portal autoFocus onClose={() => setMenuOpen(false)}
          anchor={<Button size="sm" variant="toolbar" aria-label={t('more')} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}><IconEllipsisOutlineRegular /></Button>}
          items={[{ id: 'history', label: t('history') }, { id: 'help', label: t('help') }]}
          onSelect={id => { setMenuOpen(false); if (id === 'history') openHistory(); else setHelpOpen(true) }} />
      </div>
      <div className="dsh-task-status" role="status"><span>{showHistory ? t('ended') : state?.entryActive ? t('waiting') : state ? task ? `${taskStatus(state)}${task.stages.length ? ` · ${progress(task)}` : ''}` : t('idle') : t('reading')}</span>
        {showHistory && <span>{historyEntries?.length ?? 0}</span>}</div>
    </header>
    <Modal open={helpOpen} onClose={() => setHelpOpen(false)} title={t('help')} closeLabel={t('close')}><p>{t('helpText')}</p></Modal>
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
      {state && <ReviewProgress state={state} />}
      {reviewId && !review && <div className="dsh-task-evidence-chat"><ReviewLog sessionId={sessionId} reviewerSessionId={reviewId} active={state?.reviewing === true && state.reviewActivity?.sessionId === reviewId} /></div>}
      {!reviewId && state?.reviewing && reviewJob?.reviewerSessionId && <Button size="sm" variant="toolbar" onClick={() => setReviewId(reviewJob.reviewerSessionId!)}>查看实时审查记录</Button>}
      {reviewId && reviewSection}
      {task && <section className="dsh-task-section"><p className="dsh-task-meta">计划 v{task.planVersion} · 要求 v{task.requirementsVersion}</p><h3>执行批准</h3><p>{task.approvalPolicy?.mode === 'after-review' && task.approvalPolicy.mainSessionId === sessionId && task.approvalPolicy.requirementsVersion === task.requirementsVersion ? '按你的设置：计划通过独立审查后自动执行' : '手动批准计划后执行'}</p>{task.approvalPolicy && <small className="dsh-task-meta">来源：{task.approvalPolicy.source === 'profile' ? 'DSH profile 设置' : '用户任务设置'} · 授权事件 seq {task.approvalPolicy.grantSeq}</small>}{task.lastApproval?.source === 'policy' && task.lastApproval.planVersion === task.planVersion && <p>本计划按预授权自动批准 · 授权 seq {task.lastApproval.authorizationSeq} · 审查作业 {task.lastApproval.reviewJobId}</p>}</section>}
      {task?.planning && task.planning.requirementsVersion === task.requirementsVersion && <section className="dsh-task-section"><h3>规划进展 · Supervisor</h3><p>{task.planning.nextAction}</p><Disclosure title={`已确认 ${task.planning.facts.length} 项 · 待核对 ${task.planning.unknowns.length} 项`}><h4>已确认事实</h4><ul>{task.planning.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul><h4>未决问题</h4><ul>{task.planning.unknowns.map((question, i) => <li key={i}>{question}</li>)}</ul><p className="dsh-task-meta">要求 v{task.planning.requirementsVersion} · 截至 seq {task.planning.cutoff} · 证据 {task.planning.evidenceSeqs.join(', ')} · 连续无进展 {task.planning.noProgress} 次</p></Disclosure></section>}
      {task?.pauseReason === 'planning-stalled' && <p role="status">独立规划检查未发现新的相关进展，已暂停。检查未决问题后可手动恢复。</p>}
      {task?.recovery && <section className="dsh-task-section"><Disclosure title="生成截断后的续行记录"><p>原回合 {task.recovery.turn} · 结束事件 seq {task.recovery.endSeq} · 连续无进展 {task.recovery.noProgress} 次</p><p className="dsh-task-review">{task.recovery.instruction}</p></Disclosure></section>}
      {task?.pauseReason === 'recovery-stalled' && <p role="status">连续恢复未产生可核实的新进展，已暂停。检查现状后可手动恢复或修改目标。</p>}
      {task?.reviewFault && <section className="dsh-task-fault" role="alert"><h3>审查故障 · 尚未形成有效决定</h3><p>任务已暂停，已保存审查现场。重试只恢复审查；后续执行仍需明确恢复。</p><Disclosure title="诊断详情"><p>错误：{task.reviewFault.code}<br />{task.reviewFault.message}<br />尝试 {task.reviewFault.attempt} · 原证据截止 {task.reviewFault.cutoff}<br />错误事件 {task.reviewFault.errorSeq ?? '无'} · 审查 Session {task.reviewFault.reviewerSessionId ?? '尚未创建'}</p>{task.reviewFault.reviewerSessionId && <Button size="sm" variant="toolbar" onClick={() => setReviewId(task.reviewFault!.reviewerSessionId!)}>查看审查原始对话</Button>}</Disclosure></section>}
      {state?.reviewVerification && <p className="dsh-task-muted">续行控制：Supervisor · 原生 Goal／Plan 可用于规划，不代替任务批准与验收。<br />验收模式：{state.reviewVerification === 'independent' ? '独立产物验证' : '日志证据审查'} · 计划与进展采用日志审查</p>}
      {reviewJob && <ReviewInspection job={reviewJob} />}
      {state?.entryActive ? <p>已进入任务规划。下一条主会话消息将作为任务目标；提交计划后等待批准。使用 /task off 取消。</p> : !task ? <p>未启用任务督导。输入 /task &lt;目标&gt; 开始规划，或在督导对话中整理草案。</p> : <>
        <section className="dsh-task-section"><h3>任务目标</h3><Disclosure title={headline(task.objective, 72)}><p className="dsh-task-objective">{task.objective}</p></Disclosure></section>
        <section className="dsh-task-section"><h3>{plan?.proposal ? `${plan.label} · 尚未批准执行` : '执行计划'} · {graphTask!.stages.length} 个节点</h3>
          {graphTask!.stages.length ? <TaskGraph task={graphTask!} reworks={state.reworks} selected={stage?.id} select={setSelected} label={id => plan?.proposal ? plan.label : nodeLabel(task, id, state)} executor={id => executorLabel(task, sessionId, id)} /> : <p className="dsh-task-muted">主 Agent 正在准备计划，尚未提交节点。</p>}
        </section>
        {stage && <section className="dsh-task-section dsh-task-card"><h3>节点详情 · {plan?.proposal ? plan.label : nodeLabel(task, stage.id, state)}</h3><h4>{stage.title}</h4><p className="dsh-task-muted">{plan?.proposal ? '拟由主 Agent 执行 · 尚未开始' : `执行者：${executorLabel(task, sessionId, stage.id)}`}</p>
          {!plan?.proposal && <AttemptDetails task={task} nodeId={stage.id} state={state} />}
          <p className="dsh-task-review">{stage.description ?? '暂无补充说明。'}</p>
          <Disclosure title={`验收标准 · ${stage.criterionIds.length} 项`}><ul>{graphTask!.criteria.filter(item => stage.criterionIds.includes(item.id)).map(item => <li key={item.id}>{item.text}<br /><small>{item.provenance
            ? `${SOURCE_LABEL[item.provenance.kind]} · ${item.provenance.reference === 'objective' ? '任务目标' : item.provenance.reference}` : '历史计划 · 来源未标注'}</small></li>)}</ul></Disclosure>
          <Disclosure title="执行与证据标识"><p className="dsh-task-meta">{stage.id}<br />执行 Session：{runsOf(task).find(run => run.id === stage.id)?.sessionId ?? sessionId}<br />尝试 {runsOf(task).find(run => run.id === stage.id)?.attempt ?? 1}</p>
            <p>依赖：{dependencies(graphTask!.stages, graphTask!.stages.indexOf(stage)).join('、') || '无依赖'}</p><p>写入范围：{stage.writePaths?.join('、') || '主 Agent 执行'}</p></Disclosure>
        </section>}
        <RepairPanel key={task.id} task={task} state={state} busy={busy} store={store} />
        {!reviewId && reviewSection}
        {(state.reviews?.length ?? 0) > 1 && <section className="dsh-task-section"><Disclosure title={`审查历史 · 最近 ${state.reviews?.length} 项`}>
          {state.reviews?.slice().reverse().map(item => <Disclosure key={`${item.stageId}:${item.cutoff}`} title={`${item.stageId} · ${VERDICT[item.verdict]} · ${headline(item.finding, 34)}`}><p className="dsh-task-review">{item.finding}</p></Disclosure>)}
        </Disclosure></section>}
      </>}
    </div>
    <div className="dsh-task-chat-body" role="tabpanel" id={`task-chat-${sessionId}`} aria-labelledby={`task-chat-tab-${sessionId}`} hidden={showHistory || tab !== 'consultation'}>
      {state?.draft && state.draft.status !== 'created' && <button type="button" className="dsh-task-draft-link"
        onClick={() => document.getElementById(`task-draft-${sessionId}-${state.draft!.id}-${state.draft!.version}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })}>
        {t('currentDraft')} · {headline(state.draft.title, 40)}</button>}
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
function DraftProposal({ draft, sessionId, t }: { draft: DraftCard; sessionId: string; t: SupervisorTranslate }) {
  const { state, busy, error, store } = useTask(draft.mainSessionId)
  if (sessionId !== draft.sourceSessionId) return null
  const current = state?.draft
  const latest = current?.id === draft.id && current.version === draft.version && current.status === 'draft'
  const created = current?.id === draft.id && current.status === 'created'
  const available = latest && state?.live && (!state.task || ['complete', 'cleared'].includes(state.task.phase))
  return <section id={`task-draft-${draft.mainSessionId}-${draft.id}-${draft.version}`} className="dsh-task-draft" aria-label={t('draft')}>
    <strong>{draft.title}</strong>
    <Disclosure title={t('requirements')}><p className="dsh-task-objective">{draft.requirements}</p></Disclosure>
    {draft.questions.length > 0 && <Disclosure title={`${t('questions')} · ${draft.questions.length}`}><ul>{draft.questions.map((question, index) => <li key={index}>{question}</li>)}</ul></Disclosure>}
    <div className="dsh-task-draft-actions">{latest ? <><Button size="sm" variant="primary" disabled={!available || busy || draft.questions.length > 0}
      onClick={() => { void store.promote(draft.id, draft.version) }}>{t('create')}</Button>
      {(!available || draft.questions.length > 0) && <small>{t(!available ? 'blocked' : 'unresolved')}</small>}</> : <small>{t(created ? 'created' : 'older')}</small>}</div>
    {error && <p role="alert">{error}</p>}
  </section>
}
function DraftNotes({ sessionId, turn, t }: TailProps & { t: SupervisorTranslate }) {
  return <>{turn.data.get('task-supervisor-drafts')?.map(draft => <DraftProposal key={`${draft.id}:${draft.version}`} draft={draft} sessionId={sessionId} t={t} />)}</>
}
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('task-supervisor', { zh, en }))
  const t = ctx.locale.bind('task-supervisor')
  const open = (params: TaskNavigation = {}) => ctx.sidebarRight.openTab('task-supervisor', { params })
  const Panel = (props: ConsultationPanelProps) => {
    const { tab } = props.useTabInfo()
    return <TaskPanel key={props.sessionId} sessionId={props.sessionId} navigation={tab.navigation} t={t}
      renderConsult={id => <ConsultationHost id={id} sessions={ctx.sessions} SessionProvider={props.SessionProvider} renderSlot={props.renderSlot} />} />
  }
  const Inline = (props: PanelProps) => <InlineTask {...props} open={open} />
  const Notes = (props: TailProps) => <><ReviewNotes {...props} open={open} /><DraftNotes {...props} t={t} /></>
  ctx.effect(() => ctx.slots.inject('task-supervisor.consultation', () => ctx.slots.register({ name: 'task-supervisor.consultation' }, ConsultationConversation)))
  ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({ name: 'conversation.input.dock', id: `${PANEL_ID}/current` }, Inline)))
  ctx.effect(() => ctx.uiConversation.events.register(milestoneDefinition), 'task-supervisor:milestones')
  ctx.effect(() => ctx.uiConversation.events.register(draftDefinition), 'task-supervisor:drafts')
  ctx.effect(() => { const style = document.createElement('style'); style.dataset.pluginCss = 'dsh-task-supervisor'; style.textContent = CSS + GRAPH_CSS
    document.head.append(style); return () => { style.remove() } })
  ctx.effect(() => ctx.sidebarRightTabs.register({ id: PANEL_ID, kind: 'task-supervisor', priority: 'extension', title: () => '任务督导',
    guide: [{ id: 'task-supervisor', order: 5, title: () => '任务督导', description: () => '查看任务详情或与督导对话' }] }))
  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PANEL_ID,
    children: { 'task-supervisor.consultation': { kind: 'single', scope: 'session' } } }, Panel)))
  ctx.effect(() => ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({ name: 'conversation.chat.turnTail', id: `${PANEL_ID}/milestones` }, Notes)))
}
