/** Composition regression for a DSH checkout that supplies Agent Teams. */
import kernel from '../kernel/vitest.config.mjs'

export default { ...kernel, test: { ...kernel.test, include: ['spikes/team-compat/**/*.spec.ts'] } }
