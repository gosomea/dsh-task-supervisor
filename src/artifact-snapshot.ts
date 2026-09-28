/** Immutable, bounded working-tree captures and private check copies. No Git commit is required. */
import { createHash, randomUUID } from 'node:crypto'
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export { snapshotSchema } from './verification-schema.ts'
import type { ArtifactSnapshot } from './verification-schema.ts'
export type { ArtifactSnapshot } from './verification-schema.ts'
export interface SnapshotLimits { files: number; bytes: number; excluded: string[] }

/** Whether a resolved host path lies inside the given directory. */
export function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')

/** Capture every non-excluded entry, rejecting outside links and concurrent changes. */
async function scan(root: string, limits: SnapshotLimits, signal: AbortSignal, destination?: string) {
  const entries: ArtifactSnapshot['entries'] = []
  let bytes = 0
  async function visit(directory: string, prefix: string) {
    for (const name of (await readdir(directory)).sort()) {
      signal.throwIfAborted()
      const path = prefix ? `${prefix}/${name}` : name
      if (limits.excluded.some(excluded => path === excluded || path.startsWith(`${excluded}/`))) continue
      if (entries.length >= limits.files) throw new Error('SNAPSHOT_LIMIT: entry limit exceeded; capture is incomplete')
      const source = join(directory, name), stat = await lstat(source), mode = stat.mode & 0o777
      if (stat.isSymbolicLink()) {
        const target = await readlink(source)
        if (isAbsolute(target) || !within(root, await realpath(source))) throw new Error(`SNAPSHOT_LINK: external or absolute link ${path}`)
        entries.push({ path, kind: 'link', hash: hash(target), bytes: 0, mode, target })
        if (destination) { await mkdir(join(destination, prefix), { recursive: true }); await symlink(target, join(destination, path)) }
      } else if (stat.isDirectory()) {
        entries.push({ path, kind: 'directory', hash: '', bytes: 0, mode })
        if (destination) await mkdir(join(destination, path), { recursive: true, mode: 0o700 })
        await visit(source, path)
      } else if (stat.isFile()) {
        if (stat.size > limits.bytes - bytes) throw new Error('SNAPSHOT_LIMIT: byte limit exceeded; capture is incomplete')
        const handle = await open(source, 'r')
        let content: Buffer
        try {
          const buffer = Buffer.alloc(Math.min(stat.size + 1, limits.bytes - bytes + 1))
          let offset = 0
          while (offset < buffer.byteLength) { signal.throwIfAborted(); const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset); if (!bytesRead) break; offset += bytesRead }
          content = buffer.subarray(0, offset)
        } finally { await handle.close() }
        const after = await lstat(source)
        if (!after.isFile() || after.ino !== stat.ino || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('SNAPSHOT_CHANGED: file changed while reading')
        bytes += content.byteLength
        if (bytes > limits.bytes) throw new Error('SNAPSHOT_LIMIT: byte limit exceeded')
        entries.push({ path, kind: 'file', hash: hash(content), bytes: content.byteLength, mode })
        if (destination) await writeFile(join(destination, path), content, { flag: 'wx', mode: mode & 0o700 })
      } else throw new Error(`SNAPSHOT_SPECIAL: unsupported file ${path}`)
    }
  }
  await visit(root, '')
  const paths = new Set(entries.map(entry => entry.path))
  for (const entry of entries) if (entry.kind === 'link') {
    const target = relative(root, await realpath(join(root, entry.path))).split(sep).join('/')
    if (!paths.has(target)) throw new Error(`SNAPSHOT_LINK: link ${entry.path} targets an excluded entry`)
  }
  return { entries, digest: hash(JSON.stringify(entries)) }
}

async function scanDirectories(root: string): Promise<string[]> {
  const paths: string[] = []
  for (const name of await readdir(root)) { const path = join(root, name); if ((await lstat(path)).isDirectory()) paths.push(...await scanDirectories(path)) }
  paths.push(root)
  return paths
}

/** Make a private baseline and a separate writable check tree; at most two capture retries. */
export async function captureSnapshot(workspace: string, storage: string, limits: SnapshotLimits, signal: AbortSignal): Promise<ArtifactSnapshot> {
  for (const value of [limits.files, limits.bytes]) if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('snapshot bounds must be positive integers')
  workspace = await realpath(workspace); storage = await realpath(storage)
  if (within(workspace, storage) || within(storage, workspace)) throw new Error('SNAPSHOT_LOCATION: storage and workspace must be separate')
  if (limits.excluded.some(path => !path || isAbsolute(path) || path.split('/').some(part => part === '..' || part === '.'))) throw new TypeError('snapshot exclusions must be relative entry paths')
  for (let attempt = 0; attempt < 3; attempt++) {
    const root = await mkdtemp(join(storage, 'review-')); await chmod(root, 0o700)
    const baseline = join(root, 'baseline'), check = join(root, 'check'), tree = join(check, 'tree')
    await mkdir(baseline); await mkdir(tree, { recursive: true })
    try {
      const before = await scan(workspace, limits, signal, baseline), after = await scan(workspace, limits, signal)
      if (before.digest !== after.digest) throw new Error('SNAPSHOT_CHANGED: workspace changed during capture')
      for (const entry of before.entries) {
        const target = join(tree, entry.path)
        if (entry.kind === 'directory') await mkdir(target, { recursive: true })
        else if (entry.kind === 'link') await symlink(entry.target!, target)
        else { await copyFile(join(baseline, entry.path), target); await chmod(target, entry.mode & 0o700) }
      }
      for (const dir of ['home', 'tmp', 'probes', 'output']) await mkdir(join(check, dir))
      for (const entry of [...before.entries].reverse()) if (entry.kind !== 'link') await chmod(join(baseline, entry.path), entry.kind === 'directory' ? 0o500 : entry.mode & 0o500)
      await chmod(baseline, 0o500)
      const snapshot: ArtifactSnapshot = { id: randomUUID(), workspace, root, baseline, check, digest: before.digest, entries: before.entries, excluded: [...limits.excluded] }
      await writeFile(join(root, 'manifest.json'), JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 })
      return snapshot
    } catch (error) {
      // Baseline directories may already be read-only when manifest persistence fails.
      for (const entry of (await scanDirectories(root)).reverse()) await chmod(entry, 0o700)
      await rm(root, { recursive: true, force: true })
      if (signal.aborted || !(error instanceof Error) || !error.message.startsWith('SNAPSHOT_CHANGED') || attempt === 2) throw error
    }
  }
  throw new Error('SNAPSHOT_CHANGED: capture retries exhausted')
}

/** Recheck the original tree before applying an acceptance decision. */
export async function snapshotFresh(snapshot: ArtifactSnapshot, limits: SnapshotLimits, signal: AbortSignal): Promise<boolean> {
  return (await scan(snapshot.workspace, { ...limits, excluded: snapshot.excluded }, signal)).digest === snapshot.digest
}

/** Changed or missing captured source entries invalidate checks even when the command exits zero. */
export async function changedArtifacts(snapshot: ArtifactSnapshot): Promise<string[]> {
  const changed: string[] = []
  for (const entry of snapshot.entries) {
    const path = join(snapshot.check, 'tree', entry.path)
    try {
      const stat = await lstat(path)
      if (entry.kind === 'file' ? !stat.isFile() || stat.size !== entry.bytes || !within(join(snapshot.check, 'tree'), await realpath(path)) || hash(await readFile(path)) !== entry.hash || (stat.mode & 0o777) !== (entry.mode & 0o700)
        : entry.kind === 'directory' ? !stat.isDirectory()
        : !stat.isSymbolicLink() || await readlink(path) !== entry.target) changed.push(entry.path)
    } catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') changed.push(entry.path); else throw error }
  }
  const captured = new Set(snapshot.entries.map(entry => entry.path))
  async function visit(directory: string, prefix = ''): Promise<void> {
    for (const name of await readdir(directory)) {
      const relative = prefix ? `${prefix}/${name}` : name
      if (!captured.has(relative)) { changed.push(relative); continue }
      if ((await lstat(join(directory, name))).isDirectory()) await visit(join(directory, name), relative)
    }
  }
  await visit(join(snapshot.check, 'tree'))
  return [...new Set(changed)]
}

/** Resolve model-supplied paths without allowing links or traversal out of a private subtree. */
export async function reviewPath(root: string, path: string): Promise<string> {
  if (isAbsolute(path) || path.split(/[\\/]/).includes('..')) throw new Error('REVIEW_PATH: use a relative path inside the check directory')
  const candidate = resolve(root, path)
  if (!within(root, await realpath(candidate))) throw new Error('REVIEW_PATH: link leaves the check directory')
  return candidate
}
