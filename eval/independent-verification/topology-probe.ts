/** Keyless native runner probe inside the official image; no Agent or benchmark solution. */
import { mkdtemp, mkdir, access, readFile, readlink } from 'node:fs/promises'
import { join } from 'node:path'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'
import { checkPolicy, runCheck } from '../../src/review-check.ts'

// Absolute imports select the mounted, already-built Linux Host rather than macOS dependencies.
const { Context } = await import('/dsh/vendor/cordis/lib/index.js')
const { default: LocalSubprocess } = await import('/dsh/packages/subprocess/subprocess-local/lib/index.js')
const { SessionId } = await import('/dsh/packages/core/session/lib/index.js')
const ctx = new Context()
const signal = AbortSignal.timeout(Number(process.argv[5] ?? 45000))
const limits = { files: Number(process.argv[3] ?? 10000), bytes: Number(process.argv[4] ?? 256 * 1024 * 1024), excluded: ['.git'] }
const workspace = process.argv[6] ?? '/app'
const result: Record<string, unknown> = { modelRequests: 0, dockerSocketMounted: false, limits, workspace }
await ctx.plugin(LocalSubprocess)
try {
  try { await access('/var/run/docker.sock'); result.dockerSocketMounted = true } catch { /* Expected absence in the protected outer container. */ }
  try {
    const docker = await ctx.subprocess.resolveExecutable('docker', { PATH: process.env.PATH ?? '' }, signal)
    result.dockerExecutable = docker
  } catch (error) { result.dockerExecutable = null; result.dockerError = error instanceof Error ? error.message : String(error) }
  const root = await mkdtemp('/tmp/independent-topology-')
  await mkdir(join(root, 'evidence'), { mode: 0o700 })
  try {
    const snapshot = await captureSnapshot(workspace, join(root, 'evidence'), limits, signal)
    const links = snapshot.entries.filter(entry => entry.kind === 'link')
    const linksPreserved = (await Promise.all(links.map(async entry =>
      await readlink(join(snapshot.check, 'tree', entry.path)) === entry.target
      && await readlink(join(snapshot.baseline, entry.path)) === entry.target))).every(Boolean)
    result.snapshot = { captured: true, entries: snapshot.entries.length, bytes: snapshot.entries.reduce((sum, entry) => sum + entry.bytes, 0), digest: snapshot.digest, links: links.length, linksPreserved }
    try {
      const policy = checkPolicy({ container: { context: 'default', image: process.argv[2]!, cpus: 1, memoryMiB: 4096, pids: 256 } })
      const checked = await runCheck(ctx, snapshot, SessionId('keyless-topology-probe'), ['/bin/true'], 'tree', policy, signal)
      result.check = { executed: true, exitCode: checked.exitCode, timedOut: checked.timedOut, changed: checked.changed }
    } catch (error) { result.check = { executed: false, error: error instanceof Error ? error.message : String(error) } }
  } catch (error) { result.snapshot = { captured: false, error: error instanceof Error ? error.message : String(error) } }
  result.mountInfoReadable = (await readFile('/proc/self/mountinfo', 'utf8')).length > 0
} finally {
  await ctx.fiber.dispose()
}
console.log(JSON.stringify(result))
