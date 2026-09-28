/** Exercise the public native-log audit with independent fixture records. */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
it('audits recovery, timing windows and unknown annotation metrics', () => {
  const directory = fileURLToPath(new URL('../../eval/review-recovery/', import.meta.url))
  const output = execFileSync('python3', ['-m', 'unittest', '-v', 'test_summary.py'], { cwd: directory, encoding: 'utf8', stdio: 'pipe' })
  expect(output).toBe('')
})
