/** Read-only Git facts from an administrator-owned immutable capture, not from a model-selected repository. */
import { createHash } from 'node:crypto'
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import { within, type ArtifactSnapshot } from './artifact-snapshot.ts'

export interface GitCaptureLimits { files: number; bytes: number; outputBytes: number; commandMs: number }
export interface GitCaptureInput {
  /** Trusted caller has captured this directory behind its write barrier; never accept a model path here. */
  adminOwnedGitDir: string
  privateStorageRoot: string
  /** Frozen administrator-selected Git and its runtime closure; this module does not establish that freeze. */
  gitExecutable: string
  snapshot: ArtifactSnapshot
  limits?: Partial<GitCaptureLimits>
}
export interface GitEntry { path: string; mode: '100644' | '100755' | '120000'; objectId: string }
export interface GitDifference { path: string; before: GitEntry | null; after: GitEntry | null }
export interface GitCaptureAnalysis {
  objectFormat: 'sha1'
  head: { commit: string; tree: string; parents: string[] } | null
  index: GitEntry[]
  staged: GitDifference[]
  worktree: GitDifference[]
  untracked: string[]
  committedDifferences: GitDifference[]
  headMatchesCapturedArtifacts: boolean
  capturedScopeClean: boolean
  /** null when paths other than .git were excluded; clean never means the original world was atomically captured. */
  wholeWorkspaceClean: boolean | null
  scope: { excludedPaths: string[]; captureAtomicity: 'caller-owned'; source: 'administrator-git-copy-and-artifact-baseline' }
}
export class GitCaptureError extends Error {
  constructor(message: string, options?: ErrorOptions) { super(`GIT_CAPTURE: ${message}`, options); this.name = 'GitCaptureError' }
}
const sha = (value: string | Uint8Array, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex')
const oid = /^[a-f0-9]{40}$/
const safePath = (path: string) => path.length > 0 && !isAbsolute(path) && !path.includes('\0') && !path.includes('\\')
  && !path.includes('\ufffd') && path.split('/').every(part => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git')
async function directory(path: string) {
  if (!isAbsolute(path) || !(await lstat(path)).isDirectory() || await realpath(path) !== path) throw new GitCaptureError('directory is absent or redirected')
}
function limits(input: Partial<GitCaptureLimits> = {}): GitCaptureLimits {
  const result = { files: 100000, bytes: 1024 * 1024 * 1024, outputBytes: 16 * 1024 * 1024, commandMs: 60000, ...input }
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > (name === 'files' ? 1000000 : name === 'bytes' ? 2 * 1024 * 1024 * 1024 : name === 'outputBytes' ? 64 * 1024 * 1024 : 3600000)) throw new TypeError(`invalid Git capture ${name}`)
  }
  return result
}

/** Drop optional index caches so source fsmonitor/untracked/tree caches never affect the calculation. */
function cleanIndex(index: Buffer, maxEntries: number): Buffer {
  if (index.length < 32 || index.toString('ascii', 0, 4) !== 'DIRC' || sha(index.subarray(0, -20), 'sha1') !== index.subarray(-20).toString('hex')) throw new GitCaptureError('invalid index checksum or signature')
  const version = index.readUInt32BE(4), count = index.readUInt32BE(8)
  if (![2, 3].includes(version) || count > maxEntries) throw new GitCaptureError('unsupported index version or entry limit')
  let offset = 12
  for (let entry = 0; entry < count; entry++) {
    const start = offset
    if (offset + 62 > index.length - 20) throw new GitCaptureError('truncated index')
    const flags = index.readUInt16BE(offset + 60); offset += 62
    if (flags & 0x4000) {
      if (version !== 3 || offset + 2 > index.length - 20) throw new GitCaptureError('invalid extended index')
      offset += 2
    }
    const end = index.indexOf(0, offset)
    if (end < 0 || end >= index.length - 20) throw new GitCaptureError('unterminated index path')
    offset = start + Math.ceil((end + 1 - start) / 8) * 8
  }
  const entryEnd = offset
  while (offset < index.length - 20) {
    if (offset + 8 > index.length - 20) throw new GitCaptureError('truncated index extension')
    const name = index.toString('ascii', offset, offset + 4), size = index.readUInt32BE(offset + 4)
    if (!/^[A-Z][A-Za-z0-9]{3}$/.test(name)) throw new GitCaptureError(`unsupported required index extension ${name}`)
    offset += 8 + size
    if (offset > index.length - 20) throw new GitCaptureError('truncated index extension payload')
  }
  if (offset !== index.length - 20) throw new GitCaptureError('index extent differs')
  const entries = index.subarray(0, entryEnd)
  return Buffer.concat([entries, Buffer.from(sha(entries, 'sha1'), 'hex')])
}

/** Copy only bounded Git data. The source config, hooks, attributes and logs are never imported. */
async function copyMetadata(source: string, destination: string, bound: GitCaptureLimits, signal: AbortSignal) {
  await directory(source)
  let files = 0, bytes = 0
  async function copy(relative: string) {
    signal.throwIfAborted()
    const from = join(source, relative), to = join(destination, relative), before = await lstat(from)
    if (++files > bound.files || relative.length > 4096) throw new GitCaptureError('metadata entry or path limit exceeded')
    if (before.isSymbolicLink()) throw new GitCaptureError('symbolic metadata is unsupported')
    if (before.isDirectory()) {
      await mkdir(to, { recursive: true, mode: 0o700 })
      for (const name of (await readdir(from)).sort()) {
        const next = `${relative}/${name}`
        if (relative === 'refs' && name === 'replace' || next === 'objects/info/alternates' || next === 'objects/info/http-alternates') throw new GitCaptureError('external or replacement objects are unsupported')
        if (relative === 'objects/info') {
          const info = await lstat(join(source, next))
          if (!['packs', 'commit-graph'].includes(name) || !info.isFile() || ++files > bound.files || info.size > bound.bytes - bytes) throw new GitCaptureError('unsupported object info metadata')
          bytes += info.size
          continue // Optional acceleration/advertisement data is never needed or imported.
        }
        if (relative === 'objects' && !/^(?:[a-f0-9]{2}|pack|info)$/.test(name)) throw new GitCaptureError('unsupported object storage')
        if (relative === 'objects/pack' && !/^pack-[a-f0-9]{40}\.(?:pack|idx|rev|bitmap|keep)$/.test(name)) throw new GitCaptureError('unsupported pack metadata')
        if (/^objects\/[a-f0-9]{2}$/.test(relative) && !/^[a-f0-9]{38}$/.test(name)) throw new GitCaptureError('unsupported object format')
        if (relative.startsWith('refs') && !safePath(next)) throw new GitCaptureError('unsafe reference path')
        await copy(next)
      }
    } else {
      if (!before.isFile() || before.size > bound.bytes - bytes) throw new GitCaptureError('metadata limits or file type differ')
      bytes += before.size
      await copyFile(from, to)
      const after = await lstat(from)
      if (!after.isFile() || before.ino !== after.ino || before.size !== after.size || before.ctimeMs !== after.ctimeMs || before.mtimeMs !== after.mtimeMs) throw new GitCaptureError('captured metadata changed while copying')
    }
  }
  const names = await readdir(source)
  for (const name of names) {
    if ((await lstat(join(source, name))).isSymbolicLink()) throw new GitCaptureError('symbolic metadata is unsupported')
    if (['commondir', 'shallow', 'reftable', 'grafts'].includes(name) || name.startsWith('sharedindex.')) throw new GitCaptureError('unsupported linked, shallow, split-index or reftable repository')
  }
  if (!names.includes('HEAD') || !names.includes('objects')) throw new GitCaptureError('HEAD or object store is missing; gitfiles are unsupported')
  if (names.includes('info') && (await readdir(join(source, 'info'))).includes('grafts')) throw new GitCaptureError('grafted history is unsupported')
  for (const name of ['HEAD', 'packed-refs', 'index', 'refs', 'objects']) if (names.includes(name)) await copy(name)
  await validateReferences(destination, bound, signal)
  if (names.includes('index')) await writeFile(join(destination, 'index'), cleanIndex(await readFile(join(destination, 'index')), bound.files))
  // These are administrator literals, never source-controlled configuration.
  await writeFile(join(destination, 'config'), '[core]\nrepositoryformatversion = 0\nbare = true\nfilemode = true\nattributesfile = /dev/null\n', { flag: 'wx', mode: 0o600 })
}

/** References are data: do not let symbolic paths or replacement refs redirect object interpretation. */
async function validateReferences(root: string, bound: GitCaptureLimits, signal: AbortSignal) {
  const headPath = join(root, 'HEAD'), stat = await lstat(headPath)
  if (!stat.isFile() || stat.size > 4096) throw new GitCaptureError('invalid HEAD file')
  const head = (await readFile(headPath, 'utf8')).trim()
  if (!oid.test(head) && !(head.startsWith('ref: refs/heads/') && safePath(head.slice(5)))) throw new GitCaptureError('unsupported HEAD reference')
  async function refs(path: string) {
    for (const name of await readdir(path)) {
      signal.throwIfAborted()
      const child = join(path, name), info = await lstat(child)
      if (info.isDirectory()) await refs(child)
      else if (!info.isFile() || info.size > 128 || !oid.test((await readFile(child, 'utf8')).trim())) throw new GitCaptureError('unsupported symbolic or malformed reference')
    }
  }
  try { await refs(join(root, 'refs')) } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
  try {
    const info = await lstat(join(root, 'packed-refs'))
    if (!info.isFile() || info.size > bound.outputBytes) throw new GitCaptureError('packed references exceed limits')
    for (const line of (await readFile(join(root, 'packed-refs'), 'utf8')).split('\n')) {
      if (!line || line.startsWith('#')) continue
      if (/^\^[a-f0-9]{40}$/.test(line)) continue
      const match = /^([a-f0-9]{40}) (refs\/[\s\S]+)$/.exec(line)
      if (!match || !safePath(match[2]!) || match[2]!.startsWith('refs/replace/')) throw new GitCaptureError('unsupported packed reference')
    }
  } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error }
}

async function gitRunner(ctx: Context, executable: string, root: string, gitdir: string, bound: GitCaptureLimits, signal: AbortSignal) {
  const subprocess = ctx.get('subprocess')
  if (!subprocess) throw new GitCaptureError('native subprocess is unavailable')
  if (!isAbsolute(executable) || !(await lstat(executable)).isFile() || await realpath(executable) !== executable) throw new GitCaptureError('trusted Git executable must be an absolute resolved regular file')
  const env: NodeJS.ProcessEnv = Object.fromEntries(Object.keys(process.env).map(key => [key, undefined]))
  Object.assign(env, { HOME: root, XDG_CONFIG_HOME: root, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_SYSTEM: '/dev/null', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0',
    GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0' })
  return async (args: string[], allowFailure = false) => {
    signal.throwIfAborted()
    const handle = subprocess.spawn({ argv: [executable, '--no-pager', '--literal-pathspecs', `--git-dir=${gitdir}`, ...args],
      cwd: root, env, signal: AbortSignal.any([signal, AbortSignal.timeout(bound.commandMs)]), graceMs: 1000,
      stdio: { stdin: 'ignore', stdout: { maxBytes: bound.outputBytes }, stderr: { maxBytes: bound.outputBytes } } })
    try {
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0), stderr = handle.collected.stderr?.readFrom(0)
      if (!stdout || !stderr || stdout.lossy || stderr.lossy || outcome.signal || !allowFailure && outcome.exitCode !== 0) throw new GitCaptureError(`Git plumbing failed (${outcome.exitCode ?? outcome.signal ?? 'unknown'})`)
      signal.throwIfAborted()
      return { text: stdout.text, code: outcome.exitCode }
    } finally {
      handle.terminate()
      if (!await handle.waitForExit(AbortSignal.timeout(10000))) throw new GitCaptureError('native Git range did not reach quiescence')
    }
  }
}
function entries(text: string, index: boolean): GitEntry[] {
  if (text && !text.endsWith('\0')) throw new GitCaptureError('incomplete Git path output')
  const result: GitEntry[] = []
  for (const line of text ? text.slice(0, -1).split('\0') : []) {
    const match = /^(100644|100755|120000) (?:blob |)([a-f0-9]{40})(?: ([0-3])|)\t([\s\S]+)$/.exec(line)
    if (!match || !safePath(match[4]!) || index && match[3] !== '0' || !index && match[3] !== undefined) throw new GitCaptureError('unsupported Git mode, conflict, object or path')
    result.push({ mode: match[1] as GitEntry['mode'], objectId: match[2]!, path: match[4]! })
  }
  if (new Set(result.map(item => item.path)).size !== result.length) throw new GitCaptureError('duplicate Git paths')
  return result.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
}
function differences(before: GitEntry[], after: GitEntry[], excluded: string[] = []): GitDifference[] {
  const left = new Map(before.map(item => [item.path, item])), right = new Map(after.map(item => [item.path, item]))
  return [...new Set([...left.keys(), ...right.keys()])].sort().filter(path => !excluded.some(item => path === item || path.startsWith(item + '/')))
    .filter(path => left.get(path)?.objectId !== right.get(path)?.objectId || left.get(path)?.mode !== right.get(path)?.mode)
    .map(path => ({ path, before: left.get(path) ?? null, after: right.get(path) ?? null }))
}
async function artifacts(snapshot: ArtifactSnapshot, bound: GitCaptureLimits, signal: AbortSignal): Promise<GitEntry[]> {
  await directory(snapshot.baseline)
  if (snapshot.entries.length > bound.files || sha(JSON.stringify(snapshot.entries)) !== snapshot.digest || !snapshot.excluded.every(path => path === '.git' || safePath(path))) throw new GitCaptureError('snapshot manifest or scope differs')
  const result: GitEntry[] = []; let bytes = 0
  const seen = new Set<string>()
  for (const entry of snapshot.entries) {
    signal.throwIfAborted()
    if (!safePath(entry.path) || seen.has(entry.path) || snapshot.excluded.some(path => entry.path === path || entry.path.startsWith(path + '/'))) throw new GitCaptureError('invalid captured path')
    seen.add(entry.path)
    const path = join(snapshot.baseline, entry.path), stat = await lstat(path)
    if (entry.kind === 'directory') { if (!stat.isDirectory() || await realpath(path) !== path) throw new GitCaptureError('captured directory is redirected'); continue }
    let content: Buffer, mode: GitEntry['mode']
    if (entry.kind === 'link') {
      if (!stat.isSymbolicLink() || await readlink(path) !== entry.target) throw new GitCaptureError('captured link differs')
      content = Buffer.from(entry.target!, 'utf8'); mode = '120000'
    } else {
      if (!stat.isFile() || await realpath(path) !== path || !within(snapshot.baseline, path) || stat.size !== entry.bytes || stat.size > bound.bytes - bytes || (stat.mode & 0o100) !== (entry.mode & 0o100)) throw new GitCaptureError('captured file differs or exceeds limit')
      content = await readFile(path); mode = entry.mode & 0o100 ? '100755' : '100644'
    }
    bytes += content.length
    if (bytes > bound.bytes || sha(content) !== entry.hash) throw new GitCaptureError('captured content digest differs')
    result.push({ path: entry.path, mode, objectId: sha(Buffer.concat([Buffer.from(`blob ${content.length}\0`), content]), 'sha1') })
  }
  async function verifyEntries(root: string, prefix = ''): Promise<void> {
    for (const name of await readdir(root)) {
      signal.throwIfAborted()
      const path = prefix ? `${prefix}/${name}` : name
      if (!seen.has(path)) throw new GitCaptureError('baseline contains an uncaptured entry')
      if ((await lstat(join(root, name))).isDirectory()) await verifyEntries(join(root, name), path)
    }
  }
  await verifyEntries(snapshot.baseline)
  return result
}

/** Compute relations only. Caller owns source capture atomicity, immutable runtime and original-world authorization. */
export async function analyzeGitCapture(ctx: Context, input: GitCaptureInput, signal: AbortSignal): Promise<GitCaptureAnalysis> {
  const bound = limits(input.limits)
  await directory(input.privateStorageRoot)
  if (within(input.adminOwnedGitDir, input.privateStorageRoot) || within(input.snapshot.baseline, input.privateStorageRoot)) throw new GitCaptureError('private analysis storage overlaps captured data')
  const root = await mkdtemp(join(input.privateStorageRoot, 'git-analysis-'))
  try {
    const gitdir = join(root, 'metadata'); await mkdir(gitdir, { mode: 0o700 })
    await copyMetadata(input.adminOwnedGitDir, gitdir, bound, signal)
    const git = await gitRunner(ctx, input.gitExecutable, root, gitdir, bound, signal)
    const resolved = await git(['rev-parse', '--verify', 'HEAD^{commit}'], true)
    let head: GitCaptureAnalysis['head'] = null, tree: GitEntry[] = []
    if (resolved.code === 0) {
      const commit = resolved.text.trim()
      if (!oid.test(commit)) throw new GitCaptureError('unsupported HEAD identity')
      const header = (await git(['cat-file', 'commit', commit])).text.split('\n\n', 1)[0]!.split('\n')
      const treeId = header[0]?.slice(5), parents = header.filter(line => line.startsWith('parent ')).map(line => line.slice(7))
      if (!header[0]?.startsWith('tree ') || !treeId || !oid.test(treeId) || parents.some(parent => !oid.test(parent))) throw new GitCaptureError('invalid commit headers')
      head = { commit, tree: treeId, parents }
      tree = entries((await git(['ls-tree', '-r', '-z', '--full-tree', commit])).text, false)
    } else {
      const text = (await readFile(join(gitdir, 'HEAD'), 'utf8')).trim()
      if (!/^ref: refs\/heads\/[A-Za-z0-9_./-]+$/.test(text) || !safePath(text.slice(5))) throw new GitCaptureError('missing or malformed detached HEAD')
      const refs = await git(['show-ref'], true)
      if (refs.code !== 1 || refs.text) throw new GitCaptureError('HEAD failed to resolve in a nonempty repository')
    }
    // Validates captured objects and referenced index/tree blobs, not merely names printed by ls-tree.
    await git(['fsck', '--strict', '--no-reflogs', '--no-dangling'])
    const index = entries((await git(['ls-files', '--stage', '-z'])).text, true), baseline = await artifacts(input.snapshot, bound, signal)
    if (tree.length > bound.files || index.length > bound.files) throw new GitCaptureError('Git path count exceeds the analysis limit')
    const staged = differences(tree, index), worktree = differences(index, baseline, input.snapshot.excluded)
    const committedDifferences = differences(tree, baseline, input.snapshot.excluded)
    const tracked = new Set(index.map(item => item.path)), untracked = baseline.filter(item => !tracked.has(item.path)).map(item => item.path).sort()
    const capturedScopeClean = head !== null && staged.length === 0 && worktree.length === 0 && untracked.length === 0
    return { objectFormat: 'sha1', head, index, staged, worktree, untracked, committedDifferences,
      headMatchesCapturedArtifacts: head !== null && committedDifferences.length === 0, capturedScopeClean,
      wholeWorkspaceClean: input.snapshot.excluded.some(path => path !== '.git') ? null : capturedScopeClean,
      scope: { excludedPaths: [...input.snapshot.excluded], captureAtomicity: 'caller-owned', source: 'administrator-git-copy-and-artifact-baseline' } }
  } catch (error) {
    if (error instanceof GitCaptureError || signal.aborted) throw error
    throw new GitCaptureError('metadata or snapshot could not be analyzed', { cause: error })
  } finally { await rm(root, { recursive: true, force: true }) }
}
