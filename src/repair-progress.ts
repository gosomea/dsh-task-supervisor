/** Content and actually acquired verification outputs identify repair progress, never clocks. */
import { createHash } from 'node:crypto'
import type { ReviewJob } from './review-schema.ts'
import { readCheck } from './review-check.ts'

export async function repairProgress(job: ReviewJob, paths?: string[]): Promise<string | null> {
  const state = job.verification
  if (!state) return null
  const entries = state.snapshot.entries.filter(entry => !paths?.length || paths.some(path => entry.path === path || entry.path.startsWith(`${path}/`)))
    .map(entry => [entry.path, entry.kind, entry.hash, entry.mode]).sort()
  const checks = new Set<string>()
  for (const summary of state.checks) {
    if (summary.snapshotId !== state.snapshot.id || summary.cancelled || summary.timedOut || summary.outputIncomplete) continue
    if (!state.readChecks.some(read => read.id === summary.id)) continue
    const actual = await readCheck(state.snapshot, summary.id)
    // Keep actual output, not generated IDs, wall time, container names or model findings.
    checks.add(JSON.stringify([actual.argv, actual.cwd, actual.exitCode, actual.stdout, actual.stderr]))
  }
  return createHash('sha256').update(JSON.stringify([entries, [...checks].sort()])).digest('hex')
}
