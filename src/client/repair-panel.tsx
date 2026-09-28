/** Explicit impact confirmation separates a repair proposal from execution authority. */
import { useState } from 'react'
import { Button, Checkbox, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TaskSnapshot } from '../state-schema.ts'
import type { PanelState, createTaskStore } from './task-store.ts'
import { Disclosure } from './disclosure.tsx'
import { headline } from './presentation.ts'

type Store = ReturnType<typeof createTaskStore>
export function RepairPanel({ task, state, busy, store }: { task: TaskSnapshot; state: PanelState; busy: boolean; store: Store }) {
  const [editing, setEditing] = useState(false)
  const [reason, setReason] = useState('')
  const [roots, setRoots] = useState<string[]>([])
  const proposal = state.repairs?.findLast(item => item.taskId === task.id && ['pending', 'confirmed'].includes(item.status))
  const stale = proposal && proposal.taskRevision !== task.revision
  const activeConflict = state.task && !['complete', 'cleared'].includes(state.task.phase)
  const available = state.live && task.enabled && state.task?.enabled && !activeConflict
  const title = (id: string) => task.stages.find(node => node.id === id)?.title ?? id
  return <>
    {task.phase === 'complete' && <section className="dsh-task-section dsh-task-card" aria-label="完成后的修复">
      <h3>完成后的修复</h3>
      {proposal ? <>
        <p className="dsh-task-meta">{proposal.source === 'main-agent' ? '主 Agent 提出的修复' : proposal.source === 'consultation' ? '督导对话提出的修复' : proposal.source === 'user' ? '用户提出的修复' : '修复提案 · 来源未记录'}</p><strong>{proposal.title}</strong><p className="dsh-task-review">{proposal.reason}</p>
        <p>直接返工：{proposal.rootNodeIds.map(title).join('、')}</p>
        <p>需要重新验收：{proposal.affectedNodeIds.map(title).join('、')}</p>
        <p className="dsh-task-muted">确认后回到原任务与 DAG，开启第 {(task.acceptanceCycle ?? 1) + 1} 轮验收。此前的验收记录保留；未受影响节点保留通过。</p>
        <Disclosure title="提案依据与版本"><p>任务版本 {proposal.taskRevision} · {new Date(proposal.proposedAt).toLocaleString()}<br />主会话证据：{proposal.evidenceSeqs.join('、') || '用户直接描述'}<br />已核对工作区 {proposal.artifact.files} 个文件；确认时重新核对内容。</p></Disclosure>
        <div className="dsh-task-actions"><Button size="sm" variant="primary" disabled={busy || !available || !!stale}
          onClick={() => { void store.repair('confirm-repair', task, { proposalId: proposal.id }) }}>确认重开并修复</Button>
          <Button size="sm" variant="ghost" disabled={busy || !state.live}
            onClick={() => { void store.repair('decline-repair', task, { proposalId: proposal.id }) }}>暂不修复</Button>
          <Button size="sm" variant="toolbar" disabled={busy || !state.live} onClick={() => setEditing(!editing)}>更新提案</Button></div>
        {stale && <p role="status">任务版本已变化，请更新提案后再确认。</p>}
        {activeConflict && <p role="status">另一项任务正在占用执行名额；结束后再确认，此提案不会自动排队。</p>}
        {!task.enabled && <p role="status">督导已关闭，需要先明确启用。</p>}
      </> : <><p className="dsh-task-muted">发现原目标中的缺陷时，先提出修复范围；确认前保留“已完成”。新功能可在督导对话中筹备新任务。</p>
        <Button size="sm" variant="toolbar" disabled={!state.live || busy || task.stages.length === 0} onClick={() => setEditing(!editing)}>提出修复</Button></>}
      {editing && <form className="dsh-task-repair-form" onSubmit={event => { event.preventDefault(); void store.repair('propose-repair', task,
        { title: headline(reason, 80), reason, rootNodeIds: roots, evidenceSeqs: [] }).then(ok => { if (ok) setEditing(false) }) }}>
        <label>缺陷与修复原因<Input value={reason} required maxLength={10000} placeholder="描述已完成任务中发现的问题" onChange={event => setReason(event.target.value)} /></label>
        <fieldset><legend>直接受影响的节点</legend>{task.stages.map(node => <Checkbox key={node.id} label={node.title} checked={roots.includes(node.id)} disabled={busy}
          onChange={checked => setRoots(checked ? [...roots, node.id] : roots.filter(id => id !== node.id))} />)}</fieldset>
        <Button type="submit" size="sm" variant="outline" disabled={busy || !reason.trim() || roots.length === 0}>生成影响提案</Button>
      </form>}
    </section>}
    {(task.repairHistory?.length ?? 0) > 0 && <section className="dsh-task-section dsh-task-card"><Disclosure title={`验收与修复历史 · ${task.repairHistory!.length} 次重开`}>
      {task.repairHistory!.slice().reverse().map(cycle => <Disclosure key={cycle.proposalId} title={`第 ${cycle.previousCycle} 轮已完成 → 第 ${cycle.previousCycle + 1} 轮修复`}>
        <p>{cycle.reason}</p><p>用户确认：{new Date(cycle.confirmedAt).toLocaleString()} · 日志 seq {cycle.confirmationSeq}</p>
        <p>重新验收：{cycle.affectedNodeIds.map(title).join('、')}</p>
        <p className="dsh-task-review">此前完成审查：{cycle.previousReview?.finding ?? '旧记录未保存完成审查内容'}</p>
        <p className="dsh-task-meta">此前审查 Session：{cycle.previousReview?.reviewerSessionId ?? '未记录'}</p>
      </Disclosure>)}
    </Disclosure></section>}
  </>
}
