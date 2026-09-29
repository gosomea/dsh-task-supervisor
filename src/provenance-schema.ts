/** Administrator-produced process evidence. A schema is not producer authentication. */
import { z } from 'zod'

const id = z.string().uuid()
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const time = z.iso.datetime({ offset: true })
const oid = z.string().regex(/^[a-f0-9]{40}$/)

export const worldBindingSchema = z.object({
  id, lease: z.string().min(1).max(256), mainSessionId: z.string().min(1),
  backend: z.literal('docker'), daemonIdentity: z.string().min(1),
  containerId: digest, ownerLabel: z.object({ name: z.string().min(1), value: z.string().min(1) }).strict(),
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/), workspaceIdentity: z.string().min(1),
  cwd: z.string().min(1), deadlineAt: time,
}).strict()
export type WorldBinding = z.infer<typeof worldBindingSchema>

export const provenanceScopeSchema = z.object({
  id, worldId: id, taskId: id, taskRevision: z.number().int().positive(),
  planVersion: z.number().int().nonnegative(), nodeId: z.string().min(1).nullable(),
  nodeAttempt: z.number().int().positive().nullable(), reviewJobId: id,
  cutoff: z.number().int().nonnegative(), snapshotId: id, artifactDigest: digest,
}).strict().refine(value => (value.nodeId === null) === (value.nodeAttempt === null), 'node and attempt must be bound together')
export type ProvenanceScope = z.infer<typeof provenanceScopeSchema>

// Only a trusted provider can attest this boundary. Repeated hashes and Agent idle are insufficient.
const boundary = z.object({ kind: z.enum(['docker-paused', 'native-exclusive']),
  worldId: id, startedAt: time, finishedAt: time, released: z.literal(true),
}).strict()

export const gitProvenanceSchema = z.object({ kind: z.literal('git'),
  head: oid, tree: oid, parents: z.array(oid), base: oid.nullable(),
  indexMatchesHead: z.boolean(), worktreeMatchesIndex: z.boolean(),
  untracked: z.array(z.string()), wholeWorkspaceClean: z.boolean().nullable(),
  excluded: z.array(z.string()), metadataDigest: digest, boundary,
}).strict()

export const executionProvenanceSchema = z.object({ kind: z.literal('execution'),
  coverage: z.literal('top-level-direct'), runtimeId: z.string().min(1),
  executableDigest: digest, runtimeClosureDigest: digest,
  argv: z.array(z.string().max(16384)).min(1).max(256), cwd: z.string().min(1),
  startedAt: time, finishedAt: time, exitCode: z.number().int().nullable(), signal: z.string().nullable(),
  timedOut: z.boolean(), cancelled: z.boolean(), outputIncomplete: z.boolean(),
  stdoutDigest: digest, stderrDigest: digest, outputsId: id,
  rangeQuiescent: z.literal(true), artifactsUnchanged: z.boolean(),
}).strict()

export const provenanceBodySchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), evidence: z.discriminatedUnion('kind', [gitProvenanceSchema, executionProvenanceSchema]) }).strict(),
  z.object({ status: z.literal('unavailable'), kind: z.enum(['git', 'execution']), reason: z.string().min(1).max(4096) }).strict(),
])
export type ProvenanceBody = z.infer<typeof provenanceBodySchema>

export const provenanceReceiptSchema = z.object({ schemaVersion: z.literal(1), id, createdAt: time,
  scope: provenanceScopeSchema, world: worldBindingSchema, body: provenanceBodySchema,
}).strict().superRefine((value, ctx) => {
  if (value.scope.worldId !== value.world.id) ctx.addIssue({ code: 'custom', message: 'foreign world binding' })
  const body = value.body
  if (Date.parse(value.createdAt) > Date.parse(value.world.deadlineAt)) ctx.addIssue({ code: 'custom', message: 'receipt was created after lease expiry' })
  if (body.status === 'available' && body.evidence.kind === 'git' && body.evidence.boundary.worldId !== value.world.id) {
    ctx.addIssue({ code: 'custom', message: 'foreign capture boundary' })
  }
  if (body.status === 'available') {
    const interval = body.evidence.kind === 'git' ? body.evidence.boundary : body.evidence
    if (Date.parse(interval.startedAt) > Date.parse(interval.finishedAt) || Date.parse(interval.finishedAt) > Date.parse(value.createdAt)) {
      ctx.addIssue({ code: 'custom', message: 'invalid process evidence interval' })
    }
  }
})
export type ProvenanceReceipt = z.infer<typeof provenanceReceiptSchema>
