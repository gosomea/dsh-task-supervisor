/** Display actual inspection protocol and evidence scope without wrapping main answers. */
import type { ReviewJob } from '../review-records.ts'
import { Disclosure } from './disclosure.tsx'
import type { SupervisorKey, SupervisorTranslate } from './locales.ts'
import { ReviewRequirements } from './review-requirements.tsx'

export function inspectionPhase(job: ReviewJob): SupervisorKey {
  if (job.status === 'queued') return 'reviewQueuedAction'
  if (job.decision) return 'phaseDecision'
  if (!job.verification) return 'phaseLog'
  if (job.verification.phase === 'comparison') return 'phaseComparison'
  return job.checkProtocol && !job.verification.checkPlan?.length ? 'phasePlan' : 'phaseIndependent'
}
export function ReviewInspection({ job, t }: { job: ReviewJob; t: SupervisorTranslate }) {
  const state = job.verification
  const checks = state?.checkPlan?.flatMap(entry => entry.checks) ?? []
  const findings = job.decision?.checks ?? state?.checkFindings ?? []
  const phase = inspectionPhase(job)
  const phases: SupervisorKey[] = job.checkProtocol ? ['phasePlan', 'phaseIndependent', 'phaseComparison', 'phaseDecision'] : state ? ['phaseIndependent', 'phaseComparison', 'phaseDecision'] : ['phaseLog', 'phaseDecision']
  return <section className="dsh-task-section" aria-label={t('reviewProcess')}>
    <h3>{t('reviewProcess')} · {t(phase)}</h3>
    <p className="dsh-task-muted">{t(state ? 'independentScope' : 'logScope')}{state && ` · ${t('executedChecks')} ${state.checks.length}`} · {t('sessionEvidenceBoundary')}</p>
    <ol className="dsh-task-review-phases" aria-label={t('reviewProcess')}>{phases.map(name => <li key={name} aria-current={name === phase ? 'step' : undefined}>{t(name)}</li>)}</ol>
    <ReviewRequirements job={job} t={t} />
    {!job.decision?.requirements && checks.length ? <Disclosure title={`要求检查 · ${checks.length} 项`}>
      {checks.map(check => {
        const result = findings.find(item => item.checkId === check.id)
        return <Disclosure key={check.id} title={`${result ? { satisfied: '已满足', failed: '未满足', unverified: '未验证' }[result.status] : '待检查'} · ${check.fact}`}>
          <p>依据：{check.source.kind} · {check.source.reference} · {check.basis === 'explicit' ? '明确要求' : '推导假设'}</p>
          <p>方法：{{ read: '读取产物', run: '独立运行', visual: '观察（当前不可用）', log: '对照原始执行记录（非独立运行）' }[check.method]}<br />预期：{check.expected}<br />检查范围：{check.coverage}</p>
          {result && <p>结果：{result.finding}<br />实际覆盖：{result.coverage}<br />局限：{result.limitations || '未声明额外局限'}<br />证据：{result.evidenceIds.join('、') || '无独立证据'}</p>}
        </Disclosure>
      })}
    </Disclosure> : state && <p className="dsh-task-muted">{job.checkProtocol ? '正在按原始要求制定检查方案。' : '旧版作业未记录逐项检查方案，保留原有证据级别。'}</p>}
    {state && <Disclosure title="产物与能力范围"><p>快照 {state.snapshot.id}<br />已读取 {state.readFiles.length} 个文件 · 已运行 {state.checks.length} 个检查<br />本轮没有独立浏览器观察能力。</p></Disclosure>}
  </section>
}
