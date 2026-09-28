/** Snapshot behavior includes uncommitted inputs and rejects unsafe or stale captures. */
import { mkdtemp, mkdir, readFile, readlink, writeFile, symlink, rm, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { captureSnapshot, changedArtifacts, snapshotFresh, reviewPath } from '../../src/artifact-snapshot.ts'

const dirs: string[] = []
afterEach(async () => {
  for (const root of dirs.splice(0)) {
    const { readdir, lstat } = await import('node:fs/promises')
    async function writable(dir: string) { await chmod(dir, 0o700); for (const name of await readdir(dir)) { const p = join(dir, name); if ((await lstat(p)).isDirectory()) await writable(p) } }
    await writable(root); await rm(root, { recursive: true, force: true })
  }
})
const limits = { files: 100, bytes: 10000, excluded: ['.git'] }
const signal = new AbortController().signal
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-snapshot-test-')); dirs.push(root)
  const workspace = join(root, 'workspace'), storage = join(root, 'storage')
  await mkdir(workspace); await mkdir(storage)
  await writeFile(join(workspace, 'untracked.mjs'), 'export const value = 7\n')
  await mkdir(join(workspace, '.git')); await writeFile(join(workspace, '.git', 'config'), 'private git metadata')
  return { root, workspace, storage }
}
it('captures the real tree, records exclusions, and keeps a distinct baseline and writable copy', async () => {
  const { workspace, storage } = await fixture()
  const snapshot = await captureSnapshot(workspace, storage, limits, signal)
  expect(snapshot.entries.map(entry => entry.path)).toEqual(['untracked.mjs'])
  expect(snapshot.excluded).toEqual(['.git'])
  await writeFile(join(snapshot.check, 'tree/untracked.mjs'), 'changed')
  expect(await readFile(join(snapshot.baseline, 'untracked.mjs'), 'utf8')).toContain('value = 7')
  expect(await readFile(join(workspace, 'untracked.mjs'), 'utf8')).toContain('value = 7')
  expect(await changedArtifacts(snapshot)).toEqual(['untracked.mjs'])
  expect(await snapshotFresh(snapshot, limits, signal)).toBe(true)
  await writeFile(join(workspace, 'new-file'), 'new')
  expect(await snapshotFresh(snapshot, limits, signal)).toBe(false)
})
it('materializes relative internal links without granting access to outside dependencies', async () => {
  const { root, workspace, storage } = await fixture()
  await symlink('untracked.mjs', join(workspace, 'link'))
  const snapshot = await captureSnapshot(workspace, storage, limits, signal)
  expect(await readFile(join(snapshot.check, 'tree/link'), 'utf8')).toContain('value = 7')
  await writeFile(join(root, 'secret'), 'secret'); await symlink('../secret', join(workspace, 'outside'))
  await expect(captureSnapshot(workspace, storage, limits, signal)).rejects.toThrow('SNAPSHOT_LINK')
})
it('does not silently omit files beyond bounds or follow links into excluded content', async () => {
  const { workspace, storage } = await fixture()
  await expect(captureSnapshot(workspace, storage, { ...limits, bytes: 1 }, signal)).rejects.toThrow('SNAPSHOT_LIMIT')
  await symlink('.git/config', join(workspace, 'alias'))
  await expect(captureSnapshot(workspace, storage, limits, signal)).rejects.toThrow('excluded')
})
it('preserves dangling internal links and detects changes to their targets', async () => {
  const { workspace, storage } = await fixture()
  await mkdir(join(workspace, 'fixtures'))
  await symlink('INVALID', join(workspace, 'fixtures/synlink_invalid'))
  await symlink('fixtures/synlink_invalid', join(workspace, 'alias'))
  const snapshot = await captureSnapshot(workspace, storage, limits, signal)
  expect(await readlink(join(snapshot.baseline, 'fixtures/synlink_invalid'))).toBe('INVALID')
  expect(await readlink(join(snapshot.check, 'tree/alias'))).toBe('fixtures/synlink_invalid')
  expect(await changedArtifacts(snapshot)).toEqual([])
  expect(await snapshotFresh(snapshot, limits, signal)).toBe(true)
  await writeFile(join(workspace, 'fixtures/INVALID'), 'new target')
  expect(await snapshotFresh(snapshot, limits, signal)).toBe(false)
})
it.each([
  ['outside-dangling', '../missing'],
  ['excluded-dangling', '.git/missing'],
  ['absolute-dangling', '/missing'],
  ['self-cycle', 'self-cycle'],
])('rejects unsafe absent targets and cycles: %s', async (name, target) => {
  const { workspace, storage } = await fixture()
  await symlink(target, join(workspace, name))
  await expect(captureSnapshot(workspace, storage, limits, signal)).rejects.toThrow('SNAPSHOT_LINK')
})
it('rejects traversal through a captured directory link into excluded content', async () => {
  const { workspace, storage } = await fixture()
  await mkdir(join(workspace, 'fixtures'))
  await symlink('fixtures', join(workspace, 'directory-alias'))
  await symlink('directory-alias/../.git/missing', join(workspace, 'unsafe'))
  await expect(captureSnapshot(workspace, storage, limits, signal)).rejects.toThrow('excluded')
})
it.skipIf(process.platform === 'win32')('preserves backslashes as filename characters on POSIX hosts', async () => {
  const { workspace, storage } = await fixture()
  await writeFile(join(workspace, '.git\\fixture'), 'public fixture')
  await writeFile(join(workspace, 'name\\..\\fixture'), 'literal dots')
  await symlink('.git\\fixture', join(workspace, 'alias'))
  const snapshot = await captureSnapshot(workspace, storage, limits, signal)
  expect(await readFile(join(snapshot.check, 'tree/alias'), 'utf8')).toBe('public fixture')
  expect(await readFile(await reviewPath(join(snapshot.check, 'tree'), 'name\\..\\fixture'), 'utf8')).toBe('literal dots')
})
it('rejects a cycle spanning two captured links', async () => {
  const { workspace, storage } = await fixture()
  await symlink('second', join(workspace, 'first'))
  await symlink('first', join(workspace, 'second'))
  await expect(captureSnapshot(workspace, storage, limits, signal)).rejects.toThrow('cyclic')
})
it('rejects model traversal and link escapes in the private check tree', async () => {
  const { root, workspace, storage } = await fixture()
  const snapshot = await captureSnapshot(workspace, storage, limits, signal)
  await symlink(root, join(snapshot.check, 'escape'))
  await expect(reviewPath(snapshot.check, 'escape')).rejects.toThrow('leaves')
  await expect(reviewPath(snapshot.check, '../baseline')).rejects.toThrow('relative')
})
