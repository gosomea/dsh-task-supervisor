/** Display the recorded report verbatim; no extra model request or primary message. */
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SupervisorTranslate } from './locales.ts'

export function ReviewReport({ finding, t }: { finding: string; t: SupervisorTranslate }) {
  return <div className="dsh-task-review-report"><MarkdownText text={finding} labels={{
    code: { copyLabel: t('copy'), copiedLabel: t('copied'), toolbarLabels: {
      codeLabel: t('code'), wrapLabel: t('wrap'), unwrapLabel: t('unwrap'),
    } }, footnotes: t('footnotes'),
  }} /></div>
}
