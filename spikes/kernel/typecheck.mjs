/** Check the experiment with DSH's strict host options and declared project references. */
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const project = fileURLToPath(new URL('../..', import.meta.url))
const source = resolve(process.env.DSH_SOURCE ?? resolve(project, '../../deepseek-harness'))
const requireFromDsh = createRequire(resolve(source, 'package.json'))
const ts = requireFromDsh('typescript')

let failed = false
for (const side of ['host', 'client']) {
  const configPath = resolve(source, `tsconfig.${side}.json`)
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'))
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, source, undefined, configPath)
  const options = { ...parsed.options, composite: false, incremental: false, noEmit: true,
    jsx: ts.JsxEmit.ReactJSX, typeRoots: [resolve(source, 'scripts/types'), resolve(source, 'node_modules/@types')],
    paths: { ...parsed.options.paths, vitest: [resolve(requireFromDsh.resolve('vitest/package.json'), '../dist/index.d.ts')] } }
  const program = ts.createProgram({ rootNames: side === 'host' ? [
    resolve(project, 'spikes/kernel/capabilities.spec.ts'), resolve(project, 'spikes/kernel/supervisor.spec.ts'), resolve(project, 'src/index.ts'),
    resolve(project, 'spikes/kernel/artifact-snapshot.spec.ts'), resolve(project, 'spikes/kernel/review-check.spec.ts'), resolve(project, 'spikes/kernel/verification.spec.ts'),
    resolve(project, 'src/check-gateway.ts'), resolve(project, 'spikes/kernel/check-gateway.spec.ts'),
    resolve(project, 'eval/independent-verification/gateway-probe.ts'),
    resolve(project, 'eval/independent-verification/process-provenance-probe.ts'),
    resolve(project, 'eval/deepswe/profile-probe.ts'),
    resolve(project, 'src/process-provenance.ts'), resolve(project, 'spikes/kernel/provenance-store.spec.ts'),
    resolve(project, 'spikes/kernel/provenance-git.spec.ts'),
    resolve(project, 'spikes/kernel/provenance-docker.spec.ts'),
    resolve(project, 'spikes/kernel/provenance-probe.spec.ts'),
  ] : [resolve(project, 'src/client/index.tsx'), ...parsed.fileNames.filter(path => path.endsWith('css-modules.d.ts'))],
    options, projectReferences: parsed.projectReferences })
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  if (diagnostics.length) {
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => project, getNewLine: () => '\n',
    }))
    failed = true
  } else process.stdout.write(`Kernel ${side} strict typecheck passed.\n`)
}
if (failed) process.exitCode = 1
