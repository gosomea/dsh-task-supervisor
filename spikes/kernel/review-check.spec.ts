/** Native process checks exercise the actual OS policy and await owned-range teardown. */
import { Context } from '@deepseek-ai/cordis'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mkdtemp, mkdir, writeFile, readFile, readdir, lstat, chmod, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { captureSnapshot } from '../../src/artifact-snapshot.ts'
import { checkPolicy, runCheck, recoverCheckContainers } from '../../src/review-check.ts'

const contexts: Context[] = [], dirs: string[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  async function writable(dir: string) { await chmod(dir, 0o700); for (const name of await readdir(dir)) { const p = join(dir, name); if ((await lstat(p)).isDirectory()) await writable(p) } }
  for (const root of dirs.splice(0)) { await writable(root); await rm(root, { recursive: true, force: true }) }
})
const signal = new AbortController().signal
async function fixture() {
  const root = await mkdtemp(join(process.env.DSH_CHECK_STORAGE_BASE ?? tmpdir(), 'dsh-check-test-')); dirs.push(root)
  const workspace = join(root, 'source'), storage = join(root, 'evidence'); await mkdir(workspace); await mkdir(storage)
  await writeFile(join(workspace, 'code.mjs'), 'export const value = 7')
  const snapshot = await captureSnapshot(workspace, storage, { files: 100, bytes: 10000, excluded: ['.git'] }, signal)
  const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LocalSubprocess)
  const program = 'node'
  const policy = checkPolicy({ container: { context: process.env.DSH_CHECK_DOCKER_CONTEXT ?? 'default', image: process.env.DSH_CHECK_DOCKER_IMAGE ?? ('sha256:' + '0'.repeat(64)), cpus: 1, memoryMiB: 512, pids: 64 } })
  return { ctx, snapshot, policy, program, workspace }
}
it.skipIf(!process.env.DSH_CHECK_DOCKER_IMAGE || !process.env.DSH_CHECK_DOCKER_CONTEXT)('permits check writes, denies source reads/writes and network, and scrubs the environment', async () => {
  const { ctx, snapshot, policy, program, workspace } = await fixture()
  const source = join(workspace, 'code.mjs')
  const script = `const fs = require('fs'); const net = require('net');
    fs.writeFileSync('../output/owned','ok');
    for (const action of [()=>fs.readFileSync(${JSON.stringify(source)}),()=>fs.writeFileSync(${JSON.stringify(source)},'bad')]) {try {action(); throw Error('escaped')} catch(e) {if(e.message==='escaped') throw e; console.log('denied',e.code)}}
    if(process.env.DSH_HOME || process.env.NODE_OPTIONS || Object.keys(process.env).some(k=>/KEY|SECRET|TOKEN|PASSWORD/.test(k))) throw Error('env leaked');
    const s=net.connect(9,'127.0.0.1'); s.on('error',e=>{if(!['EPERM','EACCES','ECONNREFUSED','ENETUNREACH'].includes(e.code)) throw e; console.log('network-denied')});`
  const result = await runCheck(ctx, snapshot, SessionId('check-native-test'), [program, '-e', script], 'tree', policy, signal)
  expect(result.exitCode, result.stderr).toBe(0); expect(result.timedOut).toBe(false); expect(result.cancelled).toBe(false)
  expect(result.stdout).toContain('network-denied'); expect(result.changed).toEqual([])
  expect(await readFile(source, 'utf8')).toBe('export const value = 7')
  expect(await readFile(join(snapshot.check, 'output/owned'), 'utf8')).toBe('ok')
})
it.skipIf(!process.env.DSH_CHECK_DOCKER_IMAGE || !process.env.DSH_CHECK_DOCKER_CONTEXT)('reports source modification independently of a zero command exit', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const result = await runCheck(ctx, snapshot, SessionId('check-mutation-test'), [program, '-e', "require('fs').writeFileSync('code.mjs','fixed')"], 'tree', policy, signal)
  expect(result.exitCode).toBe(0); expect(result.changed).toEqual(['code.mjs'])
})
it.skipIf(!process.env.DSH_CHECK_DOCKER_IMAGE || !process.env.DSH_CHECK_DOCKER_CONTEXT)('terminates a command at its own deadline and records the timeout separately', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const result = await runCheck(ctx, snapshot, SessionId('check-timeout-test'), [program, '-e', "console.log('READY');setInterval(()=>{},1000)"], 'tree', { ...policy, commandMs: 2000 }, signal)
  expect(result.stdout).toContain('READY'); expect(result.timedOut).toBe(true); expect(result.cancelled).toBe(false)
})

it.skipIf(!process.env.DSH_CHECK_DOCKER_IMAGE || !process.env.DSH_CHECK_DOCKER_CONTEXT)('preserves structured arguments and excludes host baseline, credentials and Docker control sockets', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const literal = "space ' \" $(touch /check/output/INJECTED) `touch /check/output/BACKTICK`"
  const script = `const fs=require('fs'),assert=require('assert');assert.equal(process.argv[1],${JSON.stringify(literal)});
    for(const p of [${JSON.stringify(snapshot.baseline)},'/var/run/docker.sock','/Users/yuqixian/.dsh/.credentials.yaml']) assert.equal(fs.existsSync(p),false);
    assert.throws(()=>fs.writeFileSync('/outside','bad')); console.log('boundaries verified');`
  const result = await runCheck(ctx, snapshot, SessionId('check-argv'), [program, '-e', script, literal], 'tree', policy, signal)
  expect(result.exitCode, result.stderr).toBe(0); expect(result.changed).toEqual([])
  expect(await readdir(join(snapshot.check, 'output'))).toEqual([])
})
it.skipIf(!process.env.DSH_CHECK_DOCKER_IMAGE || !process.env.DSH_CHECK_DOCKER_CONTEXT)('removes a container with a surviving detached child before publishing evidence', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const script = "const c=require('child_process').spawn('node',['-e',\"setInterval(()=>{},1000)\"],{detached:true,stdio:'ignore'});c.unref();console.log('spawned',c.pid)"
  const result = await runCheck(ctx, snapshot, SessionId('check-child'), [program, '-e', script], 'tree', { ...policy, commandMs: 2000 }, signal)
  expect(result.stdout).toContain('spawned'); expect(result.runtime?.kind).toBe('docker')
  // runCheck publishes only after daemon-side removal and a negative identity lookup.
  expect(result.cancelled).toBe(false)
})

it.skipIf(!process.env.DSH_CHECK_DOCKER_IMAGE || !process.env.DSH_CHECK_DOCKER_CONTEXT)('recovers an interrupted owned daemon resource from its durable identity', async () => {
  const { ctx, snapshot, policy, program } = await fixture()
  const result = await runCheck(ctx, snapshot, SessionId('check-recovery'), [program, '-e', '0'], 'tree', policy, signal)
  const id = result.id, ledger = JSON.parse(await readFile(join(snapshot.root, `container-${id}.json`), 'utf8')) as { name: string; endpoint: string }
  const docker = await ctx.subprocess.resolveExecutable('docker', { PATH: policy.path }, signal)
  async function command(args: string[]) {
    const handle = ctx.subprocess.spawn({ argv: [docker, '--host', ledger.endpoint, ...args], cwd: snapshot.check, signal, graceMs: policy.graceMs, stdio: { stdin: 'ignore', stdout: { maxBytes: 10000 }, stderr: { maxBytes: 10000 } } })
    const outcome = await handle.done; expect(outcome.exitCode).toBe(0)
    return handle.collected.stdout!.readFrom(0).text
  }
  await command(['create', '--name', ledger.name, '--label', `dsh.supervisor.snapshot=${snapshot.id}`, '--pull', 'never', '--network', 'none', policy.container.image, 'node', '-e', 'setInterval(()=>{},1000)'])
  // Simulate a crash after durable admission and before completion publication.
  await rm(join(snapshot.root, `removed-${id}.json`))
  try {
    await command(['start', ledger.name])
    await recoverCheckContainers(ctx, snapshot, policy, signal)
    expect(await command(['container', 'ls', '-aq', '--filter', `name=^/${ledger.name}$`])).toBe('')
    expect(JSON.parse(await readFile(join(snapshot.root, `removed-${id}.json`), 'utf8')).recovery).toBe(true)
  } finally { await recoverCheckContainers(ctx, snapshot, policy, signal) }
})
