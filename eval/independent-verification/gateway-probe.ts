/** Keyless DSH profile fixture exercising the official task-to-check deployment. */
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'
import { checkPolicy, runCheck, recoverCheckContainers } from '../../src/review-check.ts'

export const name = 'independent-check-topology-probe'
export const inject = ['subprocess']
export interface Config {
  workspace: string
  storageRoot: string
  gatewaySocket: string
  image: string
  output: string
  deadlineMs: number
  argv: string[]
  runtimeLinkTargets: string[]
  cancelFlag?: string
  startedOutput?: string
  maxFiles: number
  maxBytes: number
}

/** Execute once under a supported DSH profile; the fixture sends no model requests. */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(new Error('topology probe deadline')), config.deadlineMs)
    let cancellation: ReturnType<typeof setInterval> | undefined
    const result: Record<string, unknown> = { modelRequests: 0, workspace: config.workspace }
    try {
      try { await access('/var/run/docker.sock'); result.dockerSocketMounted = true }
      catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; result.dockerSocketMounted = false }
      await writeFile(join(config.workspace, '.dsh-untracked-probe'), 'untracked artifact\n', { flag: 'wx' })
      const snapshot = await captureSnapshot(config.workspace, config.storageRoot,
        { files: config.maxFiles, bytes: config.maxBytes, excluded: ['.git'], runtimeLinkTargets: config.runtimeLinkTargets }, controller.signal)
      result.snapshot = { id: snapshot.id, entries: snapshot.entries.length, bytes: snapshot.entries.reduce((sum, entry) => sum + entry.bytes, 0),
        digest: snapshot.digest, untrackedCaptured: snapshot.entries.some(entry => entry.path === '.dsh-untracked-probe') }
      if (config.startedOutput) await writeFile(config.startedOutput, JSON.stringify({ snapshotId: snapshot.id }), { flag: 'wx', mode: 0o600 })
      const policy = checkPolicy({ gatewaySocket: config.gatewaySocket, commandMs: config.deadlineMs,
        container: { context: 'default', image: config.image, cpus: 2, memoryMiB: 8192, pids: 256 } })
      if (config.cancelFlag) cancellation = setInterval(() => {
        void access(config.cancelFlag!).then(() => controller.abort(new Error('observed command readiness; cancel fixture')),
          error => { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) controller.abort(error) })
      }, 50)
      const checked = await runCheck(ctx, snapshot, SessionId('keyless-official-topology'),
        config.argv, 'tree', policy, controller.signal)
      result.check = checked
      await recoverCheckContainers(ctx, snapshot, policy, AbortSignal.timeout(30000))
      result.recoveryAcknowledged = true
      result.originalUntrackedFile = await readFile(join(config.workspace, '.dsh-untracked-probe'), 'utf8') === 'untracked artifact\n'
    } catch (error) {
      result.error = String(error).replace(/https?:\/\/\S+/g, '[redacted URL]').slice(0, 2048)
    } finally {
      clearTimeout(timer)
      clearInterval(cancellation)
      await writeFile(config.output, JSON.stringify(result), { flag: 'wx', mode: 0o600 })
    }
    return () => controller.abort(new Error('topology probe disposed'))
  })
}
