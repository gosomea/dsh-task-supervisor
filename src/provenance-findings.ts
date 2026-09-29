/** Pure process-evidence consumption. Construction is a controller capability, not model authentication. */
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { redact } from './evidence.ts'
import { findingSchema, type CriterionFinding } from './verification-schema.ts'
import { provenanceReceiptSchema, provenanceScopeSchema, publicProvenanceReceipt,
  type ProvenanceReceipt, type ProvenanceScope } from './provenance-schema.ts'

const digest = z.string().regex(/^[a-f0-9]{64}$/)
const oid = z.string().regex(/^[a-f0-9]{40}$/)
/** Selected from task constraints by the controller; never inferred from criterion text. */
export const processRequirementSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('artifact'), criterionId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('git'), criterionId: z.string().min(1), requireWholeWorkspaceClean: z.boolean(),
    head: oid.optional(), tree: oid.optional(), base: oid.nullable().optional() }).strict(),
  z.object({ kind: z.literal('execution'), criterionId: z.string().min(1), runtimeId: z.string().min(1),
    executableDigest: digest, runtimeClosureDigest: digest, argv: z.array(z.string()).min(1).max(256),
    cwd: z.string().min(1), stdoutDigest: digest.optional(), stderrDigest: digest.optional() }).strict(),
])
export type ProcessRequirement = z.infer<typeof processRequirementSchema>
export interface ProvenanceConsumerSource {
  scope: ProvenanceScope
  /** Return the actual controller-owned current scope; also enforce lease/identity admission. */
  assertCurrent(expected: Readonly<ProvenanceScope>, signal: AbortSignal): Promise<ProvenanceScope>
  /** Must use trusted seal admission, e.g. authority.read; arbitrary JSON is not an evidence source. */
  readReceipt(scope: Readonly<ProvenanceScope>, receiptId: string, signal: AbortSignal): Promise<ProvenanceReceipt>
  /** Resolve only the receipt-bound immutable capture, never a model path or supplied stdout string. */
  readOutput?(receipt: Readonly<ProvenanceReceipt>, stream: 'stdout' | 'stderr', signal: AbortSignal): Promise<{ outputsId: string; text: string }>
}
export class ProvenanceFindingError extends Error {
  constructor(message: string) { super(`PROVENANCE_FINDING: ${message}`); this.name = 'ProvenanceFindingError' }
}
function fail(message: string): never { throw new ProvenanceFindingError(message) }
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
type Reading = { digest: string; total: number; ranges: [number, number][] }
function full(reading: Reading | undefined): boolean {
  if (!reading) return false
  let end = 0
  for (const [start, stop] of [...reading.ranges].sort((a, b) => a[0] - b[0])) {
    if (start > end) return false
    end = Math.max(end, stop)
  }
  // An empty stream qualifies only after its actual page was read and capture digest checked.
  return reading.ranges.length > 0 && end === reading.total
}
function page(text: string, offset: number, limit: number) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > text.length
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 6000) fail('invalid page bounds')
  const end = Math.min(text.length, offset + limit)
  return { text: text.slice(offset, end), offset, totalChars: text.length, nextOffset: end < text.length ? end : null }
}

/** Internal reading coverage cannot be injected by the caller. No Host/profile or model tool is installed. */
export function createProvenanceConsumer(source: ProvenanceConsumerSource) {
  const scope = provenanceScopeSchema.parse(source.scope)
  const receiptReads = new Map<string, Reading>(), outputReads = new Map<string, Reading>()
  const receiptLimit = 2 * 1024 * 1024, outputLimit = 16 * 1024 * 1024
  async function current(signal: AbortSignal) {
    signal.throwIfAborted()
    const observed = provenanceScopeSchema.parse(await source.assertCurrent(structuredClone(scope), signal))
    signal.throwIfAborted()
    if (!same(observed, scope)) fail('foreign or stale current scope')
  }
  async function receipt(id: string, signal: AbortSignal) {
    await current(signal)
    if (!z.uuid().safeParse(id).success) fail('invalid receipt identity')
    const value = provenanceReceiptSchema.parse(await source.readReceipt(structuredClone(scope), id, signal))
    await current(signal)
    if (value.id !== id || !same(value.scope, scope)) fail('foreign or stale receipt binding')
    const encoded = JSON.stringify(value)
    if (Buffer.byteLength(encoded) > receiptLimit) fail('receipt exceeds the consumption bound')
    const boundDigest = hash(encoded), prior = receiptReads.get(id)
    if (prior && prior.digest !== boundDigest) fail('receipt changed after inspection')
    return { value, boundDigest }
  }
  function record(map: Map<string, Reading>, key: string, digest: string, text: string, view: ReturnType<typeof page>) {
    const prior = map.get(key)
    if (prior && (prior.digest !== digest || prior.total !== text.length)) fail('captured evidence changed after inspection')
    const reading = prior ?? { digest, total: text.length, ranges: [] }
    reading.ranges.push([view.offset, view.offset + view.text.length])
    map.set(key, reading)
  }
  async function capturedOutput(value: ProvenanceReceipt, stream: 'stdout' | 'stderr', signal: AbortSignal) {
    const readOutput = source.readOutput
    if (value.body.status !== 'available' || value.body.evidence.kind !== 'execution' || !readOutput) fail('trusted execution output is unavailable')
    const evidence = value.body.evidence
    await current(signal)
    const output = await readOutput(structuredClone(value), stream, signal)
    await current(signal)
    const expected = stream === 'stdout' ? evidence.stdoutDigest : evidence.stderrDigest
    if (typeof output.text !== 'string' || Buffer.byteLength(output.text) > outputLimit
      || output.outputsId !== evidence.outputsId || hash(output.text) !== expected) fail('output does not match the actual captured stream')
    return { text: redact(output.text), digest: expected }
  }
  async function validate(requirementValue: ProcessRequirement, findingValue: CriterionFinding, passing: boolean, signal: AbortSignal) {
    await current(signal)
    const requirement = processRequirementSchema.parse(requirementValue), finding = findingSchema.parse(findingValue)
    if (finding.criterionId !== requirement.criterionId) fail('criterion requirement differs')
    if (passing && finding.status !== 'satisfied') fail('unverified or failed criteria cannot pass')
    if (finding.status === 'unverified') { await current(signal); return { status: 'unverified' as const } }
    if (requirement.kind === 'artifact') fail('process receipts cannot replace artifact verification')
    if (finding.method !== (requirement.kind === 'git' ? 'read' : 'run')) fail('process evidence method differs')
    if (!finding.evidenceIds.length || new Set(finding.evidenceIds).size !== finding.evidenceIds.length) fail('verified process findings require distinct receipt evidence')
    for (const evidenceId of finding.evidenceIds) {
      if (!evidenceId.startsWith('provenance:')) fail('process findings require provenance receipt IDs')
      const id = evidenceId.slice('provenance:'.length), captured = await receipt(id, signal)
      if (!full(receiptReads.get(id))) fail('receipt has not been completely read')
      const body = captured.value.body
      if (body.status !== 'available') fail('unavailable process evidence must remain unverified')
      const evidence = body.evidence
      if (evidence.kind !== requirement.kind) fail('receipt evidence domain differs')
      let satisfied: boolean
      if (evidence.kind === 'git' && requirement.kind === 'git') {
        if (requirement.requireWholeWorkspaceClean && evidence.wholeWorkspaceClean === null) fail('whole-workspace state is unknown')
        satisfied = evidence.indexMatchesHead && evidence.worktreeMatchesIndex && evidence.untracked.length === 0
          && (!requirement.requireWholeWorkspaceClean || evidence.wholeWorkspaceClean === true)
          && (requirement.head === undefined || requirement.head === evidence.head)
          && (requirement.tree === undefined || requirement.tree === evidence.tree)
          && (requirement.base === undefined || requirement.base === evidence.base)
      } else if (evidence.kind === 'execution' && requirement.kind === 'execution') {
        if (evidence.runtimeId !== requirement.runtimeId || evidence.executableDigest !== requirement.executableDigest
          || evidence.runtimeClosureDigest !== requirement.runtimeClosureDigest || evidence.cwd !== requirement.cwd || !same(evidence.argv, requirement.argv)) fail('intended execution identity is unverified')
        if (evidence.timedOut || evidence.cancelled || evidence.outputIncomplete || !evidence.artifactsUnchanged
          || evidence.exitCode === null) fail('execution outcome or current artifacts are unverified')
        for (const stream of ['stdout', 'stderr'] as const) {
          const output = await capturedOutput(captured.value, stream, signal), read = outputReads.get(`${id}:${stream}`)
          if (!read || read.digest !== output.digest || read.total !== output.text.length || !full(read)) fail('read both complete captured output streams')
        }
        satisfied = evidence.exitCode === 0 && evidence.signal === null
          && (requirement.stdoutDigest === undefined || requirement.stdoutDigest === evidence.stdoutDigest)
          && (requirement.stderrDigest === undefined || requirement.stderrDigest === evidence.stderrDigest)
      } else return fail('receipt evidence domain differs')
      if ((finding.status === 'satisfied') !== satisfied) fail('finding status is not supported by the captured process facts')
    }
    await current(signal)
    return { status: finding.status }
  }
  return {
    async pageReceipt(id: string, offset: number, limit: number, signal: AbortSignal) {
      const captured = await receipt(id, signal), text = redact(JSON.stringify(publicProvenanceReceipt(captured.value)))
      const view = page(text, offset, limit)
      await current(signal)
      record(receiptReads, id, captured.boundDigest, text, view)
      return { evidenceId: `provenance:${id}`, ...view }
    },
    async pageOutput(id: string, stream: 'stdout' | 'stderr', offset: number, limit: number, signal: AbortSignal) {
      if (stream !== 'stdout' && stream !== 'stderr') fail('unknown captured output stream')
      const captured = await receipt(id, signal), output = await capturedOutput(captured.value, stream, signal)
      const view = page(output.text, offset, limit)
      await current(signal)
      record(outputReads, `${id}:${stream}`, output.digest, output.text, view)
      return { evidenceId: `provenance:${id}`, stream, ...view }
    },
    validateFinding: validate,
  }
}
