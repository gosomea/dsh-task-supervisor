/** Both task surfaces explain who is working, measured activity and the next handoff. */
import { useEffect, useState } from 'react'
import type { PanelState } from './task-store.ts'

export function ReviewProgress({ state }: { state: PanelState }) {
  const [now, setNow] = useState(Date.now)
  const job = state.reviewJobs?.findLast(item => item.taskId === state.task?.id && ['queued', 'started', 'repairing', 'submitted'].includes(item.status))
  const active = state.reviewing && job
  useEffect(() => {
    if (!active) return
    setNow(Date.now()); const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job?.id, state.reviewing])
  if (!active) {
    if (state.task?.phase === 'awaiting-approval') return <p className="dsh-task-next" role="status">计划审查通过，等待你批准后执行。</p>
    if (state.task?.pauseReason === 'review-fault') return <p className="dsh-task-next" role="status">审查发生故障，任务已暂停。点击“重试审查”恢复，尚未验收通过。</p>
    return null
  }
  const activity = state.reviewActivity?.jobId === job.id ? state.reviewActivity : null
  const seconds = Math.max(0, Math.floor((now - Date.parse(job.attemptStartedAt ?? job.startedAt)) / 1000))
  const elapsed = `${Math.floor(seconds / 60)}分${seconds % 60}秒`
  const action = job.status === 'queued' ? '已提交，等待控制器接手' : activity?.action === 'reading' ? '正在读取要求与证据'
    : activity?.action === 'checking' ? '正在运行独立检查' : activity?.action === 'deciding' ? '正在提交裁决'
      : activity?.action === 'settled' || job.status === 'submitted' ? '裁决正在保存与应用' : '审查者正在分析'
  const idleSeconds = activity?.lastActivityAt ? Math.max(0, Math.floor((now - activity.lastActivityAt) / 1000)) : null
  return <div className="dsh-task-review-progress" role="status" aria-live="off">
    <p><span className="dsh-task-activity-dot" aria-hidden="true" />Supervisor · {action} · 已用 {elapsed}</p>
    <small>{activity && `已完成 ${activity.reads} 次证据读取${activity.errors ? ` · ${activity.errors} 次工具失败已记录` : ''} · `}{idleSeconds !== null && idleSeconds >= 30 ? `最近记录更新于 ${idleSeconds} 秒前 · ` : ''}{job.deadlineAt && `本次截止 ${new Date(job.deadlineAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</small>
    <small>{job.kind === 'plan' ? '主 Agent 等待裁决；通过后等待执行批准，需要修订则返回规划。' : job.kind === 'planning' ? '主 Agent 等待规划检查，结束后接续规划。' : '主 Agent 等待审查结果，通过后才可推进依赖节点。'}</small>
  </div>
}
