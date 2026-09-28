/** Read-only, provider-bound workspace identity for repair confirmation freshness. */
import { createHash } from 'node:crypto'
import type { FileSystem, FsTarget } from '@deepseek-ai/dsh-fs'
import { TaskActionError, type ArtifactStamp } from './repairs.ts'

export async function artifactIdentity(fs: FileSystem, cwd: string, signal: AbortSignal,
  limits = { files: 10000, bytes: 256 * 1024 * 1024 }): Promise<ArtifactStamp> {
  const root = await fs.resolve(cwd, { cwd, signal })
  if ((await fs.stat(root, signal))?.type !== 'directory') throw new TaskActionError('ARTIFACT_UNAVAILABLE', 'Bind an existing task workspace.')
  async function capture() {
    const digest = createHash('sha256')
    let files = 0, bytes = 0, entries = 0
    async function visit(directory: FsTarget, prefix: string) {
      signal.throwIfAborted()
      const listing = (await fs.listDir(directory, signal)).sort((a, b) => a.name.localeCompare(b.name, 'en'))
      for (const entry of listing) {
        if (prefix === '' && entry.name === '.git') continue
        const path = prefix ? `${prefix}/${entry.name}` : entry.name
        if (++entries > limits.files) throw new TaskActionError('ARTIFACT_LIMIT', 'Workspace entry count exceeds repair identity limits; no files were silently omitted.')
        const info = await fs.lstat(path, { cwd }, signal)
        if (!info || info.type === 'symlink' || info.type === 'other' || !fs.contains(root, entry.target)) {
          throw new TaskActionError('ARTIFACT_UNSUPPORTED', `Cannot safely fingerprint ${path}; links and special files require an explicit dependency policy.`)
        }
        digest.update(JSON.stringify([path, info.type, String(info.version)]))
        if (info.type === 'directory') await visit(entry.target, path)
        else {
          let content: Uint8Array
          try { content = await fs.readBytes(entry.target, signal, limits.bytes - bytes) }
          catch (error) {
            if (error instanceof Error && 'code' in error && error.code === 'FS_TOO_LARGE') throw new TaskActionError('ARTIFACT_LIMIT', 'Workspace byte count exceeds repair identity limits.')
            throw error
          }
          bytes += content.byteLength; files++
          if (bytes > limits.bytes) throw new TaskActionError('ARTIFACT_LIMIT', 'Workspace byte count exceeds repair identity limits.')
          digest.update(createHash('sha256').update(content).digest())
          if ((await fs.lstat(path, { cwd }, signal))?.version !== info.version) throw new TaskActionError('ARTIFACT_CHANGED', 'Workspace changed while reading; refresh the proposal.')
        }
      }
    }
    await visit(root, '')
    return { workspaceKey: String(root.targetKey), digest: digest.digest('hex'), files, bytes }
  }
  const before = await capture(), after = await capture()
  if (before.digest !== after.digest) throw new TaskActionError('ARTIFACT_CHANGED', 'Workspace changed during capture; refresh the proposal.')
  return after
}
