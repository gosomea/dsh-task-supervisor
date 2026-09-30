/** Requirement-driven preparation, reusing the plugin's snapshot and check runner. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { mkdir } from 'node:fs/promises'
import { captureSnapshot } from './artifact-snapshot.ts'
import { runCheck } from './review-check.ts'
import type { VerificationPolicy } from './verification.ts'

export type VerificationCapability = 'read' | 'run' | 'visual'
export interface VerificationNeeds { capabilities: VerificationCapability[]; programs?: string[] }

/** Capability descriptions specify limits, not task categories or proof of requirement satisfaction. */
export function reviewCapabilities(policy?: VerificationPolicy) {
  return [
    { id: 'read', configured: !!policy, scope: 'Read immutable captured artifact content and manifest; does not prove observable behavior.' },
    { id: 'run', configured: !!policy?.checks, scope: 'Execute structured argv in an isolated snapshot copy; no network, browser or source edits. Installed toolchain must be checked.' },
    { id: 'visual', configured: false, scope: 'Independent browser/visual observation is unavailable in this release.' },
  ]
}

/** Run before dispatch for declared needs, or before approval for needs discovered during plan review. */
export async function prepareCapabilities(ctx: Context, main: Agent, policy: VerificationPolicy | undefined,
  needs: VerificationNeeds, signal: AbortSignal): Promise<void> {
  const missing = needs.capabilities.filter(id => !reviewCapabilities(policy).find(item => item.id === id)?.configured)
  if (missing.length) throw new Error(`CAPABILITY_UNAVAILABLE: required independent verification: ${missing.join(', ')}; no log fallback`)
  if (!needs.capabilities.length) return
  const fs = ctx.get('fs'), cwd = main.session.header.cwd
  if (!fs || !cwd || !policy) throw new Error('CAPABILITY_UNAVAILABLE: artifact filesystem/workspace is unavailable')
  const root = await fs.resolve(cwd, { cwd, signal }), workspace = fs.processPath(root)
  if (fs.processPathFromHostPath(workspace) !== workspace) throw new Error('CAPABILITY_UNAVAILABLE: snapshot needs a host-backed filesystem')
  if (!needs.capabilities.includes('run')) return
  if (!policy.checks || !ctx.get('subprocess')) throw new Error('CAPABILITY_UNAVAILABLE: independent command runner is unavailable')
  const programs = [...new Set(needs.programs ?? [])]
  if (programs.length > 32 || programs.some(name => !/^[A-Za-z0-9][A-Za-z0-9_.+-]{0,100}$/.test(name))) throw new Error('verification programs must be bounded executable names')
  await mkdir(policy.storage, { recursive: true, mode: 0o700 })
  const snapshot = await captureSnapshot(workspace, policy.storage, policy.limits, signal)
  const result = await runCheck(ctx, snapshot, main.id, programs.length ? ['which', ...programs] : ['true'], 'tree', policy.checks, signal)
  if (result.exitCode !== 0 || result.timedOut || result.cancelled || result.outputIncomplete || result.changed.length) {
    throw new Error(`CAPABILITY_UNAVAILABLE: runtime/toolchain preflight failed (${programs.join(', ') || 'runtime'}); evidence ${result.id}`)
  }
}
