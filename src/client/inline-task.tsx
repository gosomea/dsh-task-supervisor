/** The composer dock exposes task progress; node selection opens complete sidebar details. */
import { useState, type ReactNode } from 'react'
import { Button, DisclosureRow, IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from './task-store.ts'
import type { TaskSnapshot } from '../state-schema.ts'
import { runsOf } from '../graph.ts'
import { TaskGraph } from './task-graph.tsx'
import { displayedPlan, executionActors, executorLabel, headline, nodeLabel, nodeRework, progress, taskStatus } from './presentation.ts'
import { ReviewProgress } from './review-progress.tsx'
import type { SupervisorTranslate } from './locales.ts'

export interface TaskNavigation { view?: 'details' | 'consultation'; nodeId?: string; reviewerSessionId?: string }
function preference(key: string): boolean | null {
  try { const value = localStorage.getItem(key); return value === null ? null : value === 'open' } catch { return null }
}
export function TaskOverview({ sessionId, state, task, actions, error, open, t }: {
  sessionId: string; state: PanelState; task: TaskSnapshot; actions: ReactNode; error: string;
  open: (params?: TaskNavigation) => void
  t: SupervisorTranslate
}) {
  const key = `dsh-task-graph:${sessionId}:${task.id}`
  const [choice, setChoice] = useState<boolean | null>(() => preference(key))
  const expanded = choice ?? task.phase !== 'complete'
  const reviewJob = state.reviewJobs?.filter(job => job.taskId === task.id).at(-1)
  const plan = displayedPlan(state)!
  const graphTask = plan.task
  const stage = task.stages[task.stageIndex]
  const rework = stage ? nodeRework(task, stage.id, state.reworks) : undefined
  const actors = executionActors(task, sessionId)
  const mainNode = runsOf(task).find(run => !run.sessionId || run.sessionId === sessionId)
  function toggle() {
    setChoice(!expanded)
    try { localStorage.setItem(key, expanded ? 'closed' : 'open') } catch { /* Storage may be disabled; the local choice still applies. */ }
  }
  return <section className="dsh-task-inline" aria-label="任务督导概览">
    <div className="dsh-task-inline-head">
      <DisclosureRow className="dsh-task-overview-toggle" icon={<IconChecklistOutlineRegular />} title="任务督导"
        open={expanded} expandable expandOnRowClick keepContentWhenOpen onToggle={toggle}
        collapsedContent={<span className="dsh-task-overview-status">{taskStatus(state)} · {progress(task)}</span>} />
      <Button size="sm" onClick={() => open()}>查看详情</Button>
    </div>
    {expanded && <div className="dsh-task-inline-map">
      <ReviewProgress state={state} t={t} />
      {plan.proposal && <p className="dsh-task-muted">{plan.label} · {graphTask.stages.length} 个节点 · 尚未批准执行</p>}
      {graphTask.stages.length ? <TaskGraph task={graphTask} reworks={state.reworks} compact selected={stage?.id}
        select={nodeId => open({ nodeId })} label={id => plan.proposal ? plan.label : nodeLabel(task, id, state)} executor={id => executorLabel(task, sessionId, id)} />
        : <p className="dsh-task-muted">正在制定执行计划…</p>}
      <div className="dsh-task-participants" aria-label="参与 Agent"><span>参与</span>
        <Button size="sm" onClick={() => open(mainNode ? { nodeId: mainNode.id } : {})}>主 Agent</Button>
        {actors.map(actor => <Button size="sm" key={actor.sessionId} title={actor.nodeIds.map(id => task.stages.find(item => item.id === id)?.title ?? id).join('、')}
          onClick={() => open({ nodeId: actor.nodeIds[0]! })}>{actor.label}</Button>)}
        {(state.reviewing || task.lastReview) && <Button size="sm" onClick={() => open(!state.reviewing && task.lastReview?.reviewerSessionId ? { reviewerSessionId: task.lastReview.reviewerSessionId } : {})}>
          Supervisor{state.reviewing ? ' · 审查中' : ''}</Button>}
      </div>
    </div>}
    <div className="dsh-task-inline-summary"><div className="dsh-task-inline-copy">
      <p title={stage?.title ?? task.objective}>{stage ? `${nodeLabel(task, stage.id, state)} · ${executorLabel(task, sessionId, stage.id)} · ${headline(stage.title)}` : headline(task.objective)}</p>
      {rework && <small>{rework.stageId === stage?.id ? '返工原因' : '上游返工影响'}：{headline(rework.reason, 80)}</small>}
      {task.lastApproval?.source === 'policy' && task.lastApproval.planVersion === task.planVersion && <small>Supervisor · 本计划按你的预授权自动批准</small>}
      {task.phase === 'planning' && task.planning && <small title={task.planning.nextAction}>Supervisor · 下一项产出：{headline(task.planning.nextAction, 80)}</small>}
      {task.pauseReason === 'planning-stalled' && <small>规划检查未发现新进展，等待手动恢复。</small>}
      {task.recovery && <small>Supervisor · 生成截断后继续{task.phase === 'planning' ? '规划' : '任务'} · 无进展恢复 {task.recovery.noProgress} 次</small>}
      {task.pauseReason === 'recovery-stalled' && <small>连续恢复未产生可核实的新进展，等待手动恢复。</small>}
      {state.reviewing && reviewJob?.verification && <small>Supervisor · 已运行 {reviewJob.verification.checks.length} 次独立检查</small>}
      {!state.reviewing && task.lastReview && <small title={task.lastReview.finding}>Supervisor · {headline(task.lastReview.finding, 80)}</small>}
    </div></div>
    {state.repairs?.some(item => item.taskId === task.id && ['pending', 'confirmed'].includes(item.status)) && <div className="dsh-task-inline-summary"><span>修复提案待确认 · 任务仍为已完成</span><Button size="sm" variant="toolbar" onClick={() => open()}>查看影响范围</Button></div>}
    {actions && <div className="dsh-task-inline-controls">{actions}</div>}
    {error && <p role="alert" className="dsh-task-error">{error}</p>}
  </section>
}
