/** Current attempts keep the prior acceptance and rework cause available beside the node. */
import { runsOf } from '../graph.ts'
import type { TaskSnapshot } from '../state-schema.ts'
import type { PanelState } from './task-store.ts'
import { headline, nodeRework } from './presentation.ts'
import { Disclosure } from './disclosure.tsx'

export function AttemptDetails({ task, nodeId, state }: { task: TaskSnapshot; nodeId: string; state: PanelState }) {
  const run = runsOf(task).find(item => item.id === nodeId)
  const records = state.reworks?.filter(record => record.planVersion === task.planVersion && record.nodes.some(node => node.id === nodeId)) ?? []
  const latest = nodeRework(task, nodeId, records)
  return <>
    <p className="dsh-task-muted">当前第 {run?.attempt ?? 1} 次尝试</p>
    {latest && <p className="dsh-task-muted">{run?.status === 'passed' ? '本次返工已通过独立审查。'
      : run?.status === 'reviewing' ? '正在对本次返工进行独立审查。'
        : latest.stageId === nodeId ? '因发现问题重新执行，修复后需要再次审查。' : `因上游节点 ${task.stages.find(stage => stage.id === latest.stageId)?.title ?? latest.stageId} 返工，需要重新执行和审查。`}</p>}
    {latest && <p>返工原因：{headline(latest.reason, 140)}</p>}
    {records.length > 0 && <Disclosure title={`返工记录 · ${records.length} 次`}>
      {records.slice().reverse().map(record => {
        const prior = record.nodes.find(node => node.id === nodeId)!
        const review = prior.status === 'passed' ? state.reviews?.findLast(item => item.stageId === nodeId
          && item.verdict === 'pass' && prior.reviewSeq !== undefined && item.cutoff < prior.reviewSeq) : undefined
        return <div key={record.seq}>
          <p><strong>第 {prior.attempt} 次{prior.status === 'passed' ? '已通过' : '执行'} → 第 {prior.nextAttempt} 次</strong><br />主 Agent 发起 · {new Date(record.time).toLocaleString()}<br />日志 seq {record.callSeq} → {record.seq}</p>
          <p className="dsh-task-review">{record.reason}</p>
          <p>影响节点：{record.nodes.map(node => task.stages.find(stage => stage.id === node.id)?.title ?? node.id).join('、')}</p>
          {review && <Disclosure title="此前通过的审查"><p className="dsh-task-review">{review.finding}</p><p className="dsh-task-meta">审查 Session：{review.reviewerSessionId ?? '未记录'}</p></Disclosure>}
        </div>
      })}
    </Disclosure>}
  </>
}
