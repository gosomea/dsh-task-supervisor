/** Native process checks exercise the actual OS policy and await owned-range teardown. */
import { Context } from '@deepseek-ai/cordis'
import LocalSandbox from '@deepseek-ai/dsh-sandbox-local'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, chmod, rm, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'
import { checkPolicy, runCheck } from '../../src/review-check.ts'

const contexts: Context[] = [], dirs: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  async function writable(dir: string) { await chmod(dir, 0o700); for (const name of await readdir(dir)) { const p = join(dir, name); if ((await lstat(p)).isDirectory()) await writable(p) } }
  for (const root of dirs.splice(0)) { await writable(root); await rm(root, { recursive: true, force: true }) }
})
const signal = new AbortController().signal
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-check-test-')); dirs.push(root)
  const workspace = join(root, 'source'), storage = join(root, 'evidence'); await mkdir(workspace); await mkdir(storage)
  await writeFile(join(workspace, 'code.mjs'), 'export const value = 7')
  const snapshot = await captureSnapshot(workspace, storage, { files: 100, bytes: 10000, excluded: ['.git'] }, signal)
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LocalSubprocess); await ctx.plugin(LocalSandbox)
  const program = await realpath(process.execPath)
  const policy = checkPolicy({ readRoots: ['/System', '/usr', '/bin', '/sbin', '/Library/Apple', '/opt/homebrew/Cellar'] })
  return { ctx, snapshot, policy, program, workspace }
}
it.skipIf(process.platform !== 'darwin')('permits check writes, denies source reads/writes and network, and scrubs the environment', async () => {
  const { ctx, snapshot, policy, program, workspace } = await fixture()
  const source = join(workspace, 'code.mjs')
  const script = `const fs = require('fs'); const net = require('net');
    fs.writeFileSync('../output/owned','ok');
    for (const action of [()=>fs.readFileSync(${JSON.stringify(source)}),()=>fs.writeFileSync(${JSON.stringify(source)},'bad')]) {try {action(); throw Error('escaped')} catch(e) {if(e.message==='escaped') throw e; console.log('denied',e.code)}}
    if(process.env.DSH_HOME || process.env.NODE_OPTIONS || Object.keys(process.env).some(k=>/KEY|SECRET|TOKEN|PASSWORD/.test(k))) throw Error('env leaked');
    const s=net.connect(9,'127.0.0.1'); s.on('error',e=>{if(!['EPERM','EACCES'].includes(e.code)) throw e; console.log('network-denied')});`
  const result = await runCheck(ctx, snapshot, SessionId('check-native-test'), [program, '-e', script], 'tree', policy, signal)
  expect(result.exitCode, result.stderr).toBe(0); expect(result.timedOut).toBe(false); expect(result.cancelled).toBe(false)
  expect(result.stdout).toContain('network-denied'); expect(result.changed).toEqual([])
  expect(await readFile(source, 'utf8')).toBe('export const value = 7')
  expect(await readFile(join(snapshot.check, 'output/owned'), 'utf8')).toBe('ok')
})
it.skipIf(process.platform !== 'darwin')('reports source modification independently of a zero command exit', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const result = await runCheck(ctx, snapshot, SessionId('check-mutation-test'), [program, '-e', "require('fs').writeFileSync('code.mjs','fixed')"], 'tree', policy, signal)
  expect(result.exitCode).toBe(0); expect(result.changed).toEqual(['code.mjs'])
})
it.skipIf(process.platform !== 'darwin')('terminates a command at its own deadline and records the timeout separately', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const result = await runCheck(ctx, snapshot, SessionId('check-timeout-test'), [program, '-e', 'setInterval(()=>{},1000)'], 'tree', { ...policy, commandMs: 150 }, signal)
  expect(result.timedOut).toBe(true); expect(result.cancelled).toBe(false)
})
