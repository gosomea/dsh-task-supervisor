/** The composer dock exposes task progress; node selection opens complete sidebar details. */
import { useState, type ReactNode } from 'react'
import { Button, DisclosureRow, IconChecklistOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PanelState } from './task-store.ts'
import type { TaskSnapshot } from '../state-schema.ts'
import { runsOf } from '../graph.ts'
import { TaskGraph } from './task-graph.tsx'
import { executionActors, executorLabel, headline, nodeLabel, nodeRework, progress, taskStatus } from './presentation.ts'

export interface TaskNavigation { view?: 'details' | 'consultation'; nodeId?: string; reviewerSessionId?: string }
function preference(key: string): boolean | null {
  try { const value = localStorage.getItem(key); return value === null ? null : value === 'open' } catch { return null }
}
export function TaskOverview({ sessionId, state, task, actions, error, open }: {
  sessionId: string; state: PanelState; task: TaskSnapshot; actions: ReactNode; error: string;
  open: (params?: TaskNavigation) => void
}) {
  const key = `dsh-task-graph:${sessionId}:${task.id}`
  const [choice, setChoice] = useState<boolean | null>(() => preference(key))
  const expanded = choice ?? task.phase !== 'complete'
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
      {task.stages.length ? <TaskGraph task={task} reworks={state.reworks} compact selected={stage?.id}
        select={nodeId => open({ nodeId })} label={id => nodeLabel(task, id, state)} executor={id => executorLabel(task, sessionId, id)} />
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
      {task.lastReview && <small title={task.lastReview.finding}>Supervisor · {headline(task.lastReview.finding, 80)}</small>}
    </div></div>
    {actions && <div className="dsh-task-inline-controls">{actions}</div>}
    {error && <p role="alert" className="dsh-task-error">{error}</p>}
  </section>
}
