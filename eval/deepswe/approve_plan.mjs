// Use the native Web question carrier; no Plan API or state mutation bypass.
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, linkSync, unlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const { chromium } = await import(config.playwrightEntry)
const now = () => Date.now() / 1000
const writeExclusive = (name, value) => {
  const temporary = join(config.journal, `.${name}.${randomUUID()}`)
  const file = openSync(temporary, 'wx', 0o600)
  try {
    try { writeFileSync(file, JSON.stringify(value, null, 2) + '\n'); fsyncSync(file) } finally { closeSync(file) }
    linkSync(temporary, join(config.journal, name))
    const directory = openSync(config.journal, 'r')
    try { fsyncSync(directory) } finally { closeSync(directory) }
  } finally { unlinkSync(temporary) }
}
const urls = [...readFileSync(config.hostLog, 'utf8').matchAll(/http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s\x1b]+)/g)]
if (!urls.length) throw new Error('Missing private Host authentication URL')
const browser = await chromium.launch({ headless: true, executablePath: config.chromePath })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${config.port}/?token=${urls.at(-1)[1]}`, { waitUntil: 'domcontentloaded' })
  await page.getByText(config.sessionTitle, { exact: true }).first().click({ timeout: 30_000 })
  writeExclusive('plan-client-ready.json', { schemaVersion: 1, sessionId: config.sessionId, atUnix: now() })
  const review = page.locator('[data-plan-review-key]')
  const remainingMs = () => Math.max(1, Math.min(2_147_483_647, (config.deadlineAtUnix - now()) * 1000))
  await review.waitFor({ state: 'visible', timeout: remainingMs() })
  if (now() >= config.deadlineAtUnix) throw new Error('Task deadline reached before initial approval')
  const requestKey = await review.getAttribute('data-plan-review-key')
  // Reserve before the click; loss of its acknowledgement cannot trigger retry.
  writeExclusive('approval-intent.json', { schemaVersion: 1, action: 'approval', sessionId: config.sessionId,
    requestKey, atUnix: now(), transport: 'native-plan-question-web' })
  await review.getByRole('button', { name: /^(同意执行|Approve)$/ }).click({ timeout: remainingMs() })
  await review.waitFor({ state: 'hidden', timeout: Math.min(30_000, remainingMs()) })
  writeExclusive('approval-receipt.json', { schemaVersion: 1, sessionId: config.sessionId, requestKey,
    atUnix: now(), decision: 'approve', transport: 'native-plan-question-web' })
  // Keep the question transport alive for later requests; no further answer.
  while (now() < config.deadlineAtUnix) await new Promise(resolve => setTimeout(resolve, 1000))
} finally {
  await browser.close()
}
