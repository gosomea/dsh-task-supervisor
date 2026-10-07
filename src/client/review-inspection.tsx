/** Display actual inspection protocol and evidence scope without wrapping main answers. */
import type { ReviewJob } from '../review-records.ts'
import { Disclosure } from './disclosure.tsx'

export function inspectionPhase(job: ReviewJob): string {
  if (job.status === 'queued') return '已提交 · 等待控制器'
  if (job.decision) return '裁决'
  if (!job.verification) return '日志审查'
  if (job.verification.phase === 'comparison') return '对照汇报'
  return job.checkProtocol && !job.verification.checkPlan?.length ? '制定检查' : '独立检查'
}
export function ReviewInspection({ job }: { job: ReviewJob }) {
  const state = job.verification
  const checks = state?.checkPlan?.flatMap(entry => entry.checks) ?? []
  const findings = job.decision?.checks ?? state?.checkFindings ?? []
  const phase = inspectionPhase(job)
  const phases = job.checkProtocol ? ['制定检查', '独立检查', '对照汇报', '裁决'] : state ? ['独立检查', '对照汇报', '裁决'] : ['日志审查', '裁决']
  return <section className="dsh-task-section" aria-label="审查过程">
    <h3>审查过程 · {phase}</h3>
    <p className="dsh-task-muted">{state ? '独立产物审查 · 快照读取' : '日志审查 · 核对主 Session 记录'}{state && ` · 实际运行 ${state.checks.length} 次`}。独立 Session 本身不代表已独立验证。</p>
    <ol className="dsh-task-review-phases" aria-label="审查阶段">{phases.map(name => <li key={name} aria-current={name === phase ? 'step' : undefined}>{name}</li>)}</ol>
    {checks.length ? <Disclosure title={`要求检查 · ${checks.length} 项`}>
      {checks.map(check => {
        const result = findings.find(item => item.checkId === check.id)
        return <Disclosure key={check.id} title={`${result ? { satisfied: '已满足', failed: '未满足', unverified: '未验证' }[result.status] : '待检查'} · ${check.fact}`}>
          <p>依据：{check.source.kind} · {check.source.reference} · {check.basis === 'explicit' ? '明确要求' : '推导假设'}</p>
          <p>方法：{{ read: '读取产物', run: '独立运行', visual: '观察（当前不可用）' }[check.method]}<br />预期：{check.expected}<br />检查范围：{check.coverage}</p>
          {result && <p>结果：{result.finding}<br />实际覆盖：{result.coverage}<br />局限：{result.limitations || '未声明额外局限'}<br />证据：{result.evidenceIds.join('、') || '无独立证据'}</p>}
        </Disclosure>
      })}
    </Disclosure> : state && <p className="dsh-task-muted">{job.checkProtocol ? '正在按原始要求制定检查方案。' : '旧版作业未记录逐项检查方案，保留原有证据级别。'}</p>}
    {state && <Disclosure title="产物与能力范围"><p>快照 {state.snapshot.id}<br />已读取 {state.readFiles.length} 个文件 · 已运行 {state.checks.length} 个检查<br />本轮没有独立浏览器观察能力。</p></Disclosure>}
  </section>
}
