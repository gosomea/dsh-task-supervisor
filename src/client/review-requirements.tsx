/** The main report and sidebar refer to the same durable requirement outcomes. */
import type { ReviewJob } from '../review-schema.ts'
import type { SupervisorTranslate } from './locales.ts'
import { Disclosure } from './disclosure.tsx'

export function ReviewRequirements({ job, t }: { job: ReviewJob; t: SupervisorTranslate }) {
  const results = job.decision?.requirements
  if (!job.decision || !['plan', 'stage', 'completion'].includes(job.kind)) return null
  if (!results) return <p className="dsh-task-muted">{t('legacyRequirementResults')}</p>
  return <Disclosure title={`${t('requirementResults')} · ${results.length}`}>
    {results.map(result => <Disclosure key={result.id} title={`${t(`requirementStatus.${result.status}`)} · ${result.requirement}`}>
      <p>{t('requirementSource')}: {result.source.kind} · {result.source.reference} · {t(result.basis === 'explicit' ? 'explicitRequirement' : 'derivedRequirement')}</p>
      <p>{t('checkMethod')}: {t(`checkMethod.${result.method}`)}<br />{result.finding}</p>
      <p>{t('coverage')}: {result.coverage}<br />{t('limitations')}: {result.limitations || '—'}</p>
      <ul aria-label={t('evidence')}>{result.evidence.map((item, index) => <li key={index}>{item.kind === 'session'
        ? `seq ${item.seq} · ${item.ranges.map(range => range.join('–')).join(', ')} / ${item.total}${item.truncated ? ` · ${t('partialPages')}` : ''}`
        : item.kind === 'artifact' ? `${item.path} · ${item.hash} · snapshot ${item.snapshotId}` : `${item.argv.join(' ')} · ${item.checkId} · snapshot ${item.snapshotId}`}</li>)}</ul>
    </Disclosure>)}
  </Disclosure>
}
