/** Real Git repositories exercise raw-object comparison without source hooks or worktree filters. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { execFileSync } from 'node:child_process'
import { chmod, cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'
import { analyzeGitCapture, GitCaptureError } from '../../src/provenance-git.ts'

const roots: string[] = [], contexts: Context[] = []
const signal = new AbortController().signal
async function writable(path: string): Promise<void> {
  const stat = await lstat(path)
  if (stat.isSymbolicLink()) return
  if (stat.isDirectory()) { await chmod(path, 0o700); for (const child of await readdir(path)) await writable(join(path, child)) }
  else await chmod(path, 0o600)
}
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) { await writable(root); await rm(root, { recursive: true, force: true }) }
})
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-provenance-git-'))); roots.push(root)
  const workspace = join(root, 'workspace'), storage = join(root, 'snapshots'), privateStorageRoot = join(root, 'analysis')
  for (const path of [workspace, storage, privateStorageRoot]) await mkdir(path)
  const gitExecutable = await realpath(execFileSync('which', ['git'], { encoding: 'utf8' }).trim())
  const git = (...args: string[]) => execFileSync(gitExecutable, ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', ...args], { cwd: workspace, encoding: 'utf8', env: { PATH: process.env.PATH, HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  git('init', '--initial-branch=main')
  await writeFile(join(workspace, 'a.txt'), 'base\n'); git('add', 'a.txt'); git('commit', '-m', 'base')
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LocalSubprocess)
  let captureId = 0
  async function input(excluded = ['.git']) {
    const adminOwnedGitDir = join(root, `git-capture-${++captureId}`)
    await cp(join(workspace, '.git'), adminOwnedGitDir, { recursive: true, dereference: false })
    const snapshot = await captureSnapshot(workspace, storage, { files: 2000, bytes: 1024 * 1024, excluded }, signal)
    return { adminOwnedGitDir, snapshot, privateStorageRoot, gitExecutable }
  }
  const analyze = async (excluded?: string[]) => analyzeGitCapture(ctx, await input(excluded), signal)
  return { root, workspace, storage, privateStorageRoot, gitExecutable, ctx, git, input, analyze }
}

it('proves clean HEAD/tree/index/raw snapshot relation and cleans private analysis directories', async () => {
  const f = await fixture(), parent = f.git('rev-parse', 'HEAD')
  await writeFile(join(f.workspace, 'b.txt'), 'next\n'); f.git('add', '.'); f.git('commit', '-m', 'second')
  const result = await f.analyze()
  expect(result.head).toEqual({ commit: f.git('rev-parse', 'HEAD'), tree: f.git('rev-parse', 'HEAD^{tree}'), parents: [parent] })
  expect(result.wholeWorkspaceClean).toBe(true); expect(result.headMatchesCapturedArtifacts).toBe(true)
  expect(result.scope.captureAtomicity).toBe('caller-owned'); expect(await readdir(f.privateStorageRoot)).toEqual([])
})
it('distinguishes staged, unstaged, deleted and untracked bytes from the committed tree', async () => {
  const f = await fixture()
  await writeFile(join(f.workspace, 'a.txt'), 'staged\n'); f.git('add', 'a.txt')
  await writeFile(join(f.workspace, 'a.txt'), 'unstaged\n'); await writeFile(join(f.workspace, 'new.txt'), 'untracked\n')
  const result = await f.analyze()
  expect(result.staged.map(item => item.path)).toEqual(['a.txt'])
  expect(result.worktree.map(item => item.path)).toEqual(['a.txt', 'new.txt'])
  expect(result.untracked).toEqual(['new.txt']); expect(result.headMatchesCapturedArtifacts).toBe(false)
  expect(result.wholeWorkspaceClean).toBe(false)
  await rm(join(f.workspace, 'a.txt'))
  expect((await f.analyze()).worktree.find(item => item.path === 'a.txt')?.after).toBeNull()
})
it('does not treat staged correct output or an unborn repository as committed', async () => {
  const f = await fixture()
  await writeFile(join(f.workspace, 'a.txt'), 'correct new output\n'); f.git('add', 'a.txt')
  const staged = await f.analyze()
  expect(staged.worktree).toEqual([]); expect(staged.headMatchesCapturedArtifacts).toBe(false); expect(staged.wholeWorkspaceClean).toBe(false)
  await rm(join(f.workspace, '.git'), { recursive: true }); f.git('init', '--initial-branch=main'); f.git('add', '.')
  const unborn = await f.analyze()
  expect(unborn.head).toBeNull(); expect(unborn.headMatchesCapturedArtifacts).toBe(false); expect(unborn.wholeWorkspaceClean).toBe(false)
})
it('never claims whole-workspace clean when the snapshot omits non-Git paths', async () => {
  const f = await fixture()
  await writeFile(join(f.workspace, 'hidden.txt'), 'tracked\n'); f.git('add', '.'); f.git('commit', '-m', 'hidden')
  await writeFile(join(f.workspace, 'hidden.txt'), 'modified but excluded\n')
  const result = await f.analyze(['.git', 'hidden.txt'])
  expect(result.capturedScopeClean).toBe(true); expect(result.wholeWorkspaceClean).toBeNull()
})
it('compares raw bytes despite source clean filters, attributes and configuration executable hooks', async () => {
  const f = await fixture(), marker = join(f.root, 'executed')
  await writeFile(join(f.workspace, '.gitattributes'), '*.txt filter=evil\n')
  f.git('config', 'filter.evil.clean', `touch '${marker}'; cat`)
  f.git('config', 'core.fsmonitor', `touch '${marker}'`)
  f.git('config', 'diff.external', `touch '${marker}'`)
  await writeFile(join(f.workspace, '.git/hooks/post-checkout'), `#!/bin/sh\ntouch '${marker}'\n`)
  await chmod(join(f.workspace, '.git/hooks/post-checkout'), 0o700)
  // Attributes themselves are untracked; neither filter nor hooks are used by raw blob comparison.
  const result = await f.analyze()
  expect(result.untracked).toEqual(['.gitattributes'])
  expect(await readdir(f.root)).not.toContain('executed')
})
it('detects raw worktree bytes that a source clean filter would normalize to a committed blob', async () => {
  const f = await fixture(), marker = join(f.root, 'filter-executed')
  await writeFile(join(f.workspace, '.gitattributes'), '*.txt filter=normalize\n')
  f.git('config', 'filter.normalize.clean', 'printf normalized')
  f.git('add', '.'); f.git('commit', '-m', 'filtered blob')
  // A status implementation using the source filter could call this clean. This analyzer must not.
  f.git('config', 'filter.normalize.clean', `touch '${marker}'; printf normalized`)
  const result = await f.analyze()
  expect(result.staged).toEqual([])
  expect(result.worktree.map(item => item.path)).toEqual(['a.txt'])
  expect(result.headMatchesCapturedArtifacts).toBe(false)
  expect(await readdir(f.root)).not.toContain('filter-executed')
})
it.skipIf(process.platform === 'win32')('checks executable modes and symlink blobs without following their target', async () => {
  const f = await fixture()
  await writeFile(join(f.workspace, 'script'), 'echo ok\n'); await chmod(join(f.workspace, 'script'), 0o755)
  await symlink('a.txt', join(f.workspace, 'link')); f.git('add', '.'); f.git('commit', '-m', 'modes')
  expect((await f.analyze()).wholeWorkspaceClean).toBe(true)
  await chmod(join(f.workspace, 'script'), 0o644)
  expect((await f.analyze()).worktree.find(item => item.path === 'script')?.before?.mode).toBe('100755')
})
it('accepts bounded packed objects and packed refs without importing repository config', async () => {
  const f = await fixture(); f.git('gc', '--prune=now')
  const result = await f.analyze()
  expect(result.wholeWorkspaceClean).toBe(true)
})
it('rejects alternates, commondir, split index, metadata links and malformed HEAD before analysis', async () => {
  const f = await fixture()
  for (const [path, content] of [['objects/info/alternates', f.workspace], ['commondir', f.workspace], ['sharedindex.' + '0'.repeat(40), 'bad'], ['HEAD', 'ref: ../../outside']] as const) {
    const value = await f.input(); await mkdir(join(value.adminOwnedGitDir, path.split('/').slice(0, -1).join('/')), { recursive: true })
    await writeFile(join(value.adminOwnedGitDir, path), content)
    await expect(analyzeGitCapture(f.ctx, value, signal)).rejects.toBeInstanceOf(GitCaptureError)
    expect(await readdir(f.privateStorageRoot)).toEqual([])
  }
  if (process.platform !== 'win32') {
    const value = await f.input(); await rm(join(value.adminOwnedGitDir, 'index')); await symlink(join(f.workspace, '.git/index'), join(value.adminOwnedGitDir, 'index'))
    await expect(analyzeGitCapture(f.ctx, value, signal)).rejects.toThrow('symbolic metadata')
  }
})
it('fails closed on missing referenced objects and corrupted index checksums', async () => {
  const f = await fixture(), value = await f.input(), head = f.git('rev-parse', 'HEAD')
  await rm(join(value.adminOwnedGitDir, 'objects', head.slice(0, 2), head.slice(2)))
  await expect(analyzeGitCapture(f.ctx, value, signal)).rejects.toBeInstanceOf(GitCaptureError)
  const corrupt = await f.input(), index = await readFile(join(corrupt.adminOwnedGitDir, 'index')); index[20] = index[20]! ^ 1
  await writeFile(join(corrupt.adminOwnedGitDir, 'index'), index)
  await expect(analyzeGitCapture(f.ctx, corrupt, signal)).rejects.toThrow('index checksum')
  expect(await readdir(f.privateStorageRoot)).toEqual([])
})
it('rejects snapshot tampering and metadata limits while cleaning all temporary analysis data', async () => {
  const f = await fixture(), value = await f.input()
  await chmod(join(value.snapshot.baseline, 'a.txt'), 0o600); await writeFile(join(value.snapshot.baseline, 'a.txt'), 'fake\n')
  await expect(analyzeGitCapture(f.ctx, value, signal)).rejects.toBeInstanceOf(GitCaptureError)
  await expect(analyzeGitCapture(f.ctx, { ...await f.input(), limits: { bytes: 1 } }, signal)).rejects.toThrow('limits')
  expect(await readdir(f.privateStorageRoot)).toEqual([])
})
