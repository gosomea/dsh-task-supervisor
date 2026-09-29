/** Pure consumption tests: no model, Docker, producer registration or production profile. */
import { createHash, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createProvenanceConsumer, type ProcessRequirement } from '../../src/provenance-findings.ts'
import type { ProvenanceReceipt, ProvenanceScope } from '../../src/provenance-schema.ts'
import type { CriterionFinding } from '../../src/verification-schema.ts'

const sha = (text: string) => createHash('sha256').update(text).digest('hex')
const digest = 'a'.repeat(64), oid = 'b'.repeat(40)
const signal = () => new AbortController().signal
const gitRequirement = { kind: 'git', criterionId: 'commit', requireWholeWorkspaceClean: true } as const
const executionRequirement: Extract<ProcessRequirement, { kind: 'execution' }> = { kind: 'execution', criterionId: 'run', runtimeId: 'node24-frozen',
  executableDigest: digest, runtimeClosureDigest: 'd'.repeat(64), argv: ['/eval/node24', 'verify.mjs'], cwd: '/workspace' }
type Consumer = ReturnType<typeof createProvenanceConsumer>
function fixture(kind: 'git' | 'execution' = 'git') {
  const worldId = randomUUID(), now = new Date().toISOString()
  const scope: ProvenanceScope = { id: randomUUID(), worldId, taskId: randomUUID(), taskRevision: 1, planVersion: 1,
    nodeId: 'n1', nodeAttempt: 1, reviewJobId: randomUUID(), cutoff: 42, snapshotId: randomUUID(), artifactDigest: digest }
  let currentScope = structuredClone(scope), stdout = 'tests passed\n', stderr = '', outputId = randomUUID()
  const { criterionId: _criterionId, ...executionFacts } = executionRequirement
  let receipt: ProvenanceReceipt = { schemaVersion: 1, id: randomUUID(), createdAt: now, scope: structuredClone(scope),
    world: { id: worldId, lease: 'private-lease', mainSessionId: 'session-main', backend: 'docker', daemonIdentity: 'unix:///private/docker.sock',
      containerId: 'c'.repeat(64), ownerLabel: { name: 'owner', value: 'private-owner' }, image: `sha256:${digest}`,
      workspaceIdentity: 'owned-workspace', cwd: '/workspace', deadlineAt: '2100-01-01T00:00:00.000Z' },
    body: kind === 'git' ? { status: 'available', evidence: { kind: 'git', head: oid, tree: 'e'.repeat(40), parents: [], base: null,
      indexMatchesHead: true, worktreeMatchesIndex: true, untracked: [], wholeWorkspaceClean: true, excluded: ['.git'], metadataDigest: digest,
      boundary: { kind: 'docker-paused', worldId, startedAt: now, finishedAt: now, released: true } } }
      : { status: 'available', evidence: { ...executionFacts, coverage: 'top-level-direct',
        startedAt: now, finishedAt: now, exitCode: 0, signal: null, timedOut: false, cancelled: false, outputIncomplete: false,
        stdoutDigest: sha(stdout), stderrDigest: sha(stderr), outputsId: outputId, rangeQuiescent: true, artifactsUnchanged: true } } }
  let readHook = () => {}, outputHook = () => {}, asserts = 0, revoked = false
  const source = { scope, assertCurrent: async () => { asserts++; if (revoked) throw new Error('lease or review invalidated'); return currentScope },
    readReceipt: async () => { readHook(); return receipt },
    readOutput: async (_receipt: Readonly<ProvenanceReceipt>, stream: 'stdout' | 'stderr') => { outputHook(); return { outputsId: outputId, text: stream === 'stdout' ? stdout : stderr } } }
  return { consumer: createProvenanceConsumer(source), source, scope,
    get receipt() { return receipt }, get asserts() { return asserts },
    replace: (value: ProvenanceReceipt) => { receipt = value }, move: (change: Partial<ProvenanceScope>) => { currentScope = { ...currentScope, ...change } },
    revoke: () => { revoked = true }, onRead: (hook: () => void) => { readHook = hook }, onOutput: (hook: () => void) => { outputHook = hook },
    changeOutput: (text: string, id = outputId) => { stdout = text; outputId = id }, stderr: (text: string) => { stderr = text } }
}
function finding(f: ReturnType<typeof fixture>, requirement: ProcessRequirement = gitRequirement, status: CriterionFinding['status'] = 'satisfied'): CriterionFinding {
  return { criterionId: requirement.criterionId, method: requirement.kind === 'execution' ? 'run' : 'read', status,
    finding: 'Examined independently captured facts.', evidenceIds: [`provenance:${f.receipt.id}`] }
}
async function readReceipt(f: ReturnType<typeof fixture>, limit = 6000) {
  let offset: number | null = 0
  while (offset !== null) offset = (await f.consumer.pageReceipt(f.receipt.id, offset, limit, signal())).nextOffset
}
async function readOutputs(f: ReturnType<typeof fixture>, limit = 6000) {
  for (const stream of ['stdout', 'stderr'] as const) {
    let offset: number | null = 0
    while (offset !== null) offset = (await f.consumer.pageOutput(f.receipt.id, stream, offset, limit, signal())).nextOffset
  }
}
const check = (f: ReturnType<typeof fixture>, requirement: ProcessRequirement = gitRequirement, status: CriterionFinding['status'] = 'satisfied', passing = true) =>
  f.consumer.validateFinding(requirement, finding(f, requirement, status), passing, signal())

describe('process receipt consumption', () => {
  it('requires complete public receipt reading and exposes no private world binding', async () => {
    const f = fixture(), view = await f.consumer.pageReceipt(f.receipt.id, 0, 20, signal())
    await expect(check(f)).rejects.toThrow('completely read')
    await readReceipt(f, 97)
    expect(await check(f)).toEqual({ status: 'satisfied' })
    const full = await f.consumer.pageReceipt(f.receipt.id, 0, 6000, signal())
    for (const value of [f.receipt.world.containerId, f.receipt.world.daemonIdentity, f.receipt.world.lease, f.receipt.world.ownerLabel.value]) expect(full.text).not.toContain(value)
    expect(view.evidenceId).toBe(`provenance:${f.receipt.id}`)
  })

  it('does not mistake the final page or a gap for complete receipt coverage', async () => {
    const f = fixture(), first = await f.consumer.pageReceipt(f.receipt.id, 0, 10, signal())
    await f.consumer.pageReceipt(f.receipt.id, first.totalChars - 10, 10, signal())
    await expect(check(f)).rejects.toThrow('completely read')
  })

  it('rejects every changed current binding, including after receipt callback awaits', async () => {
    for (const change of [{ id: randomUUID() }, { worldId: randomUUID() }, { taskId: randomUUID() }, { taskRevision: 2 },
      { planVersion: 2 }, { nodeId: 'n2' }, { nodeAttempt: 2 }, { reviewJobId: randomUUID() }, { cutoff: 43 },
      { snapshotId: randomUUID() }, { artifactDigest: 'f'.repeat(64) }]) {
      const f = fixture(); f.onRead(() => f.move(change))
      await expect(readReceipt(f)).rejects.toThrow('foreign or stale current scope')
    }
  })

  it('rejects foreign receipt identity/scope rather than trusting the supplied evidence ID', async () => {
    for (const change of [{ id: randomUUID() }, { scope: { ...fixture().scope } }]) {
      const f = fixture(); f.replace({ ...f.receipt, ...change })
      await expect(f.consumer.pageReceipt(randomUUID(), 0, 6000, signal())).rejects.toThrow()
    }
    const f = fixture(), original = f.receipt.id
    f.replace({ ...f.receipt, scope: { ...f.scope, artifactDigest: 'f'.repeat(64) } })
    await expect(f.consumer.pageReceipt(original, 0, 6000, signal())).rejects.toThrow('foreign or stale receipt')
  })

  it('detects a changed receipt after previously complete reading', async () => {
    const f = fixture(); await readReceipt(f)
    const value = structuredClone(f.receipt); value.createdAt = new Date(Date.parse(value.createdAt) + 1).toISOString(); f.replace(value)
    await expect(check(f)).rejects.toThrow('changed after inspection')
  })

  it('honors controller invalidation for read, validation and callback completion', async () => {
    const f = fixture(); await readReceipt(f); f.revoke()
    await expect(check(f)).rejects.toThrow('invalidated')
    const g = fixture(); g.onRead(() => g.revoke())
    await expect(readReceipt(g)).rejects.toThrow('invalidated')
  })

  it('keeps absent and unavailable proof unverified without treating it as failure or success', async () => {
    const f = fixture(); f.replace({ ...f.receipt, body: { status: 'unavailable', kind: 'git', reason: 'no producer' } }); await readReceipt(f)
    await expect(check(f)).rejects.toThrow('must remain unverified')
    await expect(check(f, gitRequirement, 'failed', false)).rejects.toThrow('must remain unverified')
    const unknown: CriterionFinding = { criterionId: 'commit', method: 'read', status: 'unverified', finding: 'No trusted producer.', evidenceIds: [] }
    expect(await f.consumer.validateFinding(gitRequirement, unknown, false, signal())).toEqual({ status: 'unverified' })
    await expect(f.consumer.validateFinding(gitRequirement, unknown, true, signal())).rejects.toThrow('cannot pass')
  })

  it('rejects substitution for artifact behavior, the wrong domain, method or check/file IDs', async () => {
    const f = fixture(); await readReceipt(f)
    await expect(check(f, { kind: 'artifact', criterionId: 'commit' })).rejects.toThrow('cannot replace artifact')
    await expect(check(f, executionRequirement)).rejects.toThrow('domain differs')
    await expect(f.consumer.validateFinding(gitRequirement, { ...finding(f), method: 'run' }, true, signal())).rejects.toThrow('method differs')
    for (const id of ['file:README.md', randomUUID()]) await expect(f.consumer.validateFinding(gitRequirement, { ...finding(f), evidenceIds: [id] }, true, signal())).rejects.toThrow('receipt IDs')
  })

  it('does not infer process requirements from natural-language findings or HEAD changing', async () => {
    const f = fixture(); await readReceipt(f)
    await expect(check(f, { ...gitRequirement, head: 'f'.repeat(40) })).rejects.toThrow('not supported')
    await expect(check(f, { ...gitRequirement, tree: 'f'.repeat(40) })).rejects.toThrow('not supported')
    await expect(check(f, { ...gitRequirement, base: 'f'.repeat(40) })).rejects.toThrow('not supported')
    expect(await check(f, { ...gitRequirement, head: oid, tree: 'e'.repeat(40), base: null })).toEqual({ status: 'satisfied' })
  })

  it('distinguishes dirty facts from excluded unknown workspace state', async () => {
    for (const change of [{ indexMatchesHead: false }, { worktreeMatchesIndex: false }, { untracked: ['new.mjs'] }, { wholeWorkspaceClean: false }]) {
      const f = fixture(); if (f.receipt.body.status === 'available' && f.receipt.body.evidence.kind === 'git') Object.assign(f.receipt.body.evidence, change)
      await readReceipt(f); await expect(check(f)).rejects.toThrow('not supported')
      expect(await check(f, gitRequirement, 'failed', false)).toEqual({ status: 'failed' })
    }
    const f = fixture(); if (f.receipt.body.status === 'available' && f.receipt.body.evidence.kind === 'git') f.receipt.body.evidence.wholeWorkspaceClean = null
    await readReceipt(f); await expect(check(f)).rejects.toThrow('unknown')
    await expect(check(f, gitRequirement, 'failed', false)).rejects.toThrow('unknown')
    expect(await check(f, { ...gitRequirement, requireWholeWorkspaceClean: false })).toEqual({ status: 'satisfied' })
  })

  it('admits exact successful direct execution only after reading both captured streams, including empty stderr', async () => {
    const f = fixture('execution'); await readReceipt(f)
    await expect(check(f, executionRequirement)).rejects.toThrow('both complete')
    await f.consumer.pageOutput(f.receipt.id, 'stdout', 0, 6000, signal())
    await expect(check(f, executionRequirement)).rejects.toThrow('both complete')
    await readOutputs(f, 3)
    expect(await check(f, executionRequirement)).toEqual({ status: 'satisfied' })
    expect(f.asserts).toBeGreaterThan(10)
  })

  it('does not admit execution output gaps or reads injected into a new consumer', async () => {
    const f = fixture('execution'); await readReceipt(f); await readOutputs(f)
    const other: Consumer = createProvenanceConsumer(f.source)
    await expect(other.validateFinding(executionRequirement, finding(f, executionRequirement), true, signal())).rejects.toThrow('completely read')
    const g = fixture('execution'); await readReceipt(g)
    const p = await g.consumer.pageOutput(g.receipt.id, 'stdout', 0, 1, signal())
    await g.consumer.pageOutput(g.receipt.id, 'stdout', p.totalChars - 1, 1, signal()); await g.consumer.pageOutput(g.receipt.id, 'stderr', 0, 1, signal())
    await expect(check(g, executionRequirement)).rejects.toThrow('both complete')
  })

  it('binds output to actual capture ID and hashes, not shell text claiming success', async () => {
    for (const wrongId of [false, true]) {
      const f = fixture('execution'); await readReceipt(f)
      f.changeOutput(wrongId ? 'tests passed\n' : 'echo tests passed; success!', wrongId ? randomUUID() : undefined)
      await expect(readOutputs(f)).rejects.toThrow('actual captured stream')
    }
    const f = fixture('execution'); await readReceipt(f); await readOutputs(f); f.changeOutput('forged after read')
    await expect(check(f, executionRequirement)).rejects.toThrow('actual captured stream')
  })

  it('redacts stdout/stderr JSON and serialized argv without substituting redacted bytes for capture digests', async () => {
    const f = fixture('execution'), token = 'FAKE_TEST_TOKEN_123456'
    const stdout = JSON.stringify({ api_key: token, result: 'passed' }), stderr = JSON.stringify({ apiKey: token, warning: 'none' })
    const argv = ['/eval/node24', 'verify.mjs', JSON.stringify({ api_key: token })]
    f.changeOutput(stdout); f.stderr(stderr)
    if (f.receipt.body.status !== 'available' || f.receipt.body.evidence.kind !== 'execution') throw new Error('fixture domain')
    Object.assign(f.receipt.body.evidence, { stdoutDigest: sha(stdout), stderrDigest: sha(stderr), argv })
    await readReceipt(f, 11)
    const receiptView = await f.consumer.pageReceipt(f.receipt.id, 0, 6000, signal())
    expect(receiptView.text).not.toContain(token); expect(receiptView.text).toContain('[redacted]')
    for (const stream of ['stdout', 'stderr'] as const) {
      let offset: number | null = 0, joined = ''
      while (offset !== null) { const view = await f.consumer.pageOutput(f.receipt.id, stream, offset, 3, signal()); joined += view.text; offset = view.nextOffset }
      expect(joined).not.toContain(token); expect(joined).toContain('[redacted]')
      expect(joined).toContain(stream === 'stdout' ? 'passed' : 'none')
    }
    expect(await check(f, { ...executionRequirement, argv, stdoutDigest: sha(stdout), stderrDigest: sha(stderr) })).toEqual({ status: 'satisfied' })
    f.changeOutput(JSON.stringify({ api_key: '[redacted]', result: 'passed' }))
    await expect(check(f, { ...executionRequirement, argv })).rejects.toThrow('actual captured stream')
  })

  it('rechecks current scope after execution-output awaits', async () => {
    const f = fixture('execution'); await readReceipt(f); f.onOutput(() => f.move({ nodeAttempt: 2 }))
    await expect(readOutputs(f)).rejects.toThrow('foreign or stale current scope')
  })

  it('cannot claim the intended executable from a matching version string or different argv/runtime closure', async () => {
    for (const change of [{ runtimeId: 'node24-unfrozen' }, { executableDigest: 'f'.repeat(64) }, { runtimeClosureDigest: 'f'.repeat(64) },
      { argv: ['/bin/sh', '-c', 'echo node24 success'] }, { cwd: '/other' }]) {
      const f = fixture('execution'); if (f.receipt.body.status === 'available') Object.assign(f.receipt.body.evidence, change)
      await readReceipt(f); await expect(check(f, executionRequirement)).rejects.toThrow('identity is unverified')
      await expect(check(f, executionRequirement, 'failed', false)).rejects.toThrow('identity is unverified')
    }
  })

  it('admits an actual nonzero outcome only as failed and preserves incomplete/changed outcomes as unknown', async () => {
    const f = fixture('execution'); if (f.receipt.body.status === 'available' && f.receipt.body.evidence.kind === 'execution') f.receipt.body.evidence.exitCode = 1
    await readReceipt(f); await readOutputs(f)
    await expect(check(f, executionRequirement)).rejects.toThrow('not supported')
    expect(await check(f, executionRequirement, 'failed', false)).toEqual({ status: 'failed' })
    for (const change of [{ timedOut: true }, { cancelled: true }, { outputIncomplete: true }, { artifactsUnchanged: false }, { exitCode: null }]) {
      const g = fixture('execution'); if (g.receipt.body.status === 'available') Object.assign(g.receipt.body.evidence, change)
      await readReceipt(g); await expect(check(g, executionRequirement)).rejects.toThrow('unverified')
      await expect(check(g, executionRequirement, 'failed', false)).rejects.toThrow('unverified')
    }
  })

  it('requires trusted output capability and honors explicit captured output digests', async () => {
    const f = fixture('execution'); delete (f.source as { readOutput?: unknown }).readOutput
    await readReceipt(f); await expect(check(f, executionRequirement)).rejects.toThrow('output is unavailable')
    const g = fixture('execution'); await readReceipt(g); await readOutputs(g)
    await expect(check(g, { ...executionRequirement, stdoutDigest: sha('expected other output') })).rejects.toThrow('not supported')
    expect(await check(g, { ...executionRequirement, stdoutDigest: sha('tests passed\n'), stderrDigest: sha('') })).toEqual({ status: 'satisfied' })
  })

  it('rejects invalid pagination, duplicate references, unsupported visual methods and criterion mismatches', async () => {
    const f = fixture(); await readReceipt(f)
    for (const [offset, limit] of [[-1, 1], [999999, 1], [0, 0], [0, 6001]]) await expect(f.consumer.pageReceipt(f.receipt.id, offset!, limit!, signal())).rejects.toThrow('bounds')
    await expect(f.consumer.validateFinding(gitRequirement, { ...finding(f), evidenceIds: [finding(f).evidenceIds[0]!, finding(f).evidenceIds[0]!] }, true, signal())).rejects.toThrow('distinct')
    await expect(f.consumer.validateFinding(gitRequirement, { ...finding(f), method: 'visual' }, true, signal())).rejects.toThrow('method differs')
    await expect(f.consumer.validateFinding(gitRequirement, { ...finding(f), criterionId: 'other' }, true, signal())).rejects.toThrow('criterion requirement')
  })
})
