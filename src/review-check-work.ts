/** Durable check admission and collection, separate from the reviewer's model turns. */
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { runCheck, readCheck, validateCheckInput, type CheckPolicy } from './review-check.ts'
import { checkRequest } from './check-channel.ts'
import { recordReview, type ReviewJob } from './review-records.ts'
import { CheckInputError } from './check-errors.ts'
import { chargeReviewBudget } from './review-budget.ts'
import type { CheckResult, VerificationState } from './verification-schema.ts'

type Request = NonNullable<VerificationState['requests']>[number]
function accept(job: ReviewJob, request: Request, result: CheckResult): void {
  if (result.id !== request.id || result.snapshotId !== request.snapshotId || result.cwd !== request.cwd || JSON.stringify(result.argv) !== JSON.stringify(request.argv)) throw new Error('CHECK_INFRASTRUCTURE: receipt identity mismatch')
  const { stdout: _out, stderr: _err, ...summary } = result
  if (!job.verification!.checks.some(item => item.id === result.id)) job.verification!.checks.push(summary)
  request.status = 'settled'; request.finishedAt = result.finishedAt
}

/** Recover only known identities. An interrupted native execution without a receipt stays unknown. */
export async function collectReviewChecks(ctx: Context, main: Agent, job: ReviewJob, policy: CheckPolicy, signal: AbortSignal): Promise<void> {
  const state = job.verification!
  for (const request of state.requests ?? []) {
    if (request.status === 'settled') continue
    try {
      let result: CheckResult
      try { result = await readCheck(state.snapshot, request.id) }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT') || !policy.gatewaySocket) throw error
        result = (await checkRequest(state.snapshot, request.sessionId, 'collect', request.argv, request.cwd, { ...policy, commandMs: request.commandMs }, signal, request.id))!
        await writeFile(join(state.snapshot.root, `check-${result.id}.json`), JSON.stringify(result), { flag: 'wx', mode: 0o600 })
      }
      accept(job, request, result)
    } catch (error) {
      request.status = 'unknown'; request.error = String(error).slice(0, 2048)
      await recordReview(ctx, main, { ...job, revision: ++job.revision })
      throw new Error(`CHECK_INFRASTRUCTURE: request ${request.id} has no confirmed receipt; do not rerun`, { cause: error })
    }
  }
  await recordReview(ctx, main, { ...job, revision: ++job.revision })
}

/** One check owns the mutable isolated copy at a time; disposal awaits its cleanup. */
export function createReviewCheckWork(ctx: Context, main: Agent, job: ReviewJob, sessionId: string, policy: CheckPolicy | undefined,
  parent: AbortSignal, phase: (mode: 'model' | 'checking') => void) {
  const stop = new AbortController(), signal = AbortSignal.any([parent, stop.signal])
  let work: Promise<void> | undefined
  let admitting = false
  const persist = () => recordReview(ctx, main, { ...job, revision: ++job.revision })
  return {
    pending: () => work !== undefined,
    async start(argv: string[], cwd: string, requestedMs?: number) {
      signal.throwIfAborted()
      validateCheckInput(argv, cwd)
      if (work || admitting) throw new CheckInputError('CHECK_PENDING: wait for the current receipt before admitting another check')
      if (!policy) throw new CheckInputError('CAPABILITY_UNAVAILABLE: command execution is not configured')
      if (requestedMs !== undefined && (!Number.isSafeInteger(requestedMs) || requestedMs < 1)) throw new CheckInputError('timeout_ms must be a positive integer')
      const remaining = Math.min(Date.parse(job.deadlineAt!) - Date.now(), job.budget ? job.budget.checksMs - job.budget.usedChecksMs : Infinity)
      const commandMs = Math.min(requestedMs ?? policy.commandMs, policy.commandMs, remaining)
      if (commandMs < 1) throw new CheckInputError('CHECK_BUDGET_EXHAUSTED: retain missing requirements as unverified')
      admitting = true
      try {
      const state = job.verification!
      const request: Request = { id: randomUUID(), snapshotId: state.snapshot.id, sessionId, argv, cwd, commandMs, status: 'queued', createdAt: new Date().toISOString() }
      state.requests = [...state.requests ?? [], request]
      await persist()
      phase('checking')
      request.status = 'running'
      await persist()
      work = (async () => {
        const limit = AbortSignal.timeout(Math.max(1, remaining))
        try {
          const result = await runCheck(ctx, state.snapshot, SessionId(sessionId), argv, cwd, { ...policy, commandMs }, AbortSignal.any([signal, limit]), request.id)
          accept(job, request, result)
          if (job.budget && !result.cancelled && !result.timedOut && !result.outputIncomplete) job.budget.progress++
        } catch (error) {
          request.status = 'unknown'; request.error = String(error).slice(0, 2048)
          throw error
        } finally {
          if (job.budget) chargeReviewBudget(job.budget, 'settled', Date.now())
          await persist()
        }
      })()
      // The owner consumes this rejection through wait/dispose, never an unhandled background promise.
      void work.catch(() => {})
      return { queued: true, checkId: request.id, snapshotId: request.snapshotId, commandMs, next: 'End this turn. The controller waits and delivers the receipt; do not poll or resubmit.' }
      } finally { admitting = false }
    },
    async wait() { const pending = work; try { await pending } finally { if (work === pending) work = undefined } },
    async dispose() { stop.abort(new Error('Review ended')); try { await work } finally { work = undefined } },
  }
}
