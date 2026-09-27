/** Task language and bounded continuation context, restored from durable state. */
import { acceptedNodes, readyNodes, runsOf } from './graph.ts'
import type { TaskSnapshot } from './state.ts'

export function resolveLanguage(objective: string, configured = 'auto', fallback = 'zh-CN'): string {
  if (configured !== 'auto') return Intl.getCanonicalLocales(configured)[0] ?? fallback
  const prose = objective.replace(/```[\s\S]*?```/gu, '').replace(/`[^`]*`/gu, '')
  if (/[\u3040-\u30ff]/u.test(prose)) return 'ja'
  if (/[\uac00-\ud7af]/u.test(prose)) return 'ko'
  if (/\p{Script=Han}/u.test(prose)) return 'zh-CN'
  if (/[a-z]{3}/iu.test(prose)) return 'en'
  return Intl.getCanonicalLocales(fallback)[0] ?? 'zh-CN'
}

export function languagePolicy(task: TaskSnapshot): string {
  const language = task.responseLanguage ?? resolveLanguage(task.objective)
  return `Task response language: ${language}. Write user-facing plans, progress reports, review findings, and final answers in this language. `
    + 'Preserve code, paths, identifiers, and protocol enum values. English tool output or automated messages do not change this preference. '
    + 'An explicit language request from the user takes precedence.'
}

function excerpt(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}… [summary truncated; use task_status for the full record]`
}

export function continuationContext(task: TaskSnapshot, instruction: string): string {
  const stage = task.stages[task.stageIndex]
  return [
    languagePolicy(task),
    `Task ${task.id}; requirements v${task.requirementsVersion}; plan v${task.planVersion}; state v${task.revision}.`,
    `Objective (full): ${task.objective}`,
    `Accepted nodes: ${acceptedNodes(task).join(', ') || 'none'}.`,
    task.stages.length === 0 ? 'No plan submitted yet; inspect and submit a plan before execution. Preserve requested node counts. dependsOn requires predecessor review passes; integrate worker outputs before reporting their nodes, never in a successor blocked on that review. Objective criteria use provenance {kind: user, reference: objective}.'
      : stage === undefined ? 'All planned stages accepted; request whole-task completion review.'
      : `Current node: ${stage.id} — ${stage.title}${stage.description ? `\nDetails: ${excerpt(stage.description, 2000)}` : ''}`,
    `Ready nodes: ${readyNodes(task).join(', ') || 'none'}. Node attempts: ${JSON.stringify(runsOf(task))}`,
    `Current acceptance: ${JSON.stringify(task.criteria.filter(item => stage?.criterionIds.includes(item.id)))}`,
    task.lastReview === null ? 'No independent review yet.'
      : `Latest independent review: ${task.lastReview.stageId}; ${task.lastReview.verdict}; evidence cutoff ${task.lastReview.cutoff}.\n${excerpt(task.lastReview.finding, 1600)}`,
    'Only accepted nodes are verified. Inspect existing work before repeating uncertain effects. Original user constraints remain authoritative. Use task_status for full plan and findings.',
    `Next action: ${instruction}`,
  ].join('\n\n')
}


/** Controller-generated notices use the same persisted language as model findings. */
export function interruptedReviewFinding(task: TaskSnapshot, error?: unknown): string {
  const language = (task.responseLanguage ?? resolveLanguage(task.objective)).split('-')[0]
  const notices: Record<string, string> = {
    zh: '审查尚未完成；恢复后请重新提交证据。',
    ja: 'レビューは未完了です。再開後に証拠を再提出してください。',
    ko: '검토가 완료되지 않았습니다. 재개 후 근거를 다시 제출하세요.',
  }
  const notice = notices[language ?? ''] ?? 'The review did not finish; resubmit its evidence after resuming.'
  return error === undefined ? notice : `${notice}\n${String(error)}`
}
