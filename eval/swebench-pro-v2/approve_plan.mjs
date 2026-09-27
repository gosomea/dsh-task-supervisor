// Answer exactly one native DSH plan review through the real Web client.
import { readFileSync, writeFileSync } from 'node:fs'

const [hostLog, publicPortText, sessionTitle, receiptPath] = process.argv.slice(2)
const publicPort = Number(publicPortText)
const playwrightEntry = process.env.PLAYWRIGHT_ENTRY
const chromePath = process.env.CHROME_PATH
if (!hostLog || !publicPort || !sessionTitle || !receiptPath || !playwrightEntry || !chromePath) {
  throw new Error('Usage: PLAYWRIGHT_ENTRY=... CHROME_PATH=... node approve_plan.mjs <host-log> <public-port> <session-title> <receipt-path>')
}
const { chromium } = await import(playwrightEntry)
const urls = [...readFileSync(hostLog, 'utf8').matchAll(/http:\/\/127\.0\.0\.1:\d+\/\?token=([^\s\x1b]+)/g)]
if (urls.length === 0) throw new Error('Missing private Host startup token')
const token = urls.at(-1)[1]
const browser = await chromium.launch({ headless: true, executablePath: chromePath })
try {
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${publicPort}/?token=${token}`, { waitUntil: 'domcontentloaded' })
  await page.getByText(sessionTitle, { exact: true }).first().click({ timeout: 30_000 })
  const review = page.locator('[data-plan-review-key]')
  await review.waitFor({ state: 'visible', timeout: 3_000_000 })
  const approve = review.getByRole('button', { name: /^(同意执行|Approve)$/ })
  await approve.click()
  await review.waitFor({ state: 'hidden', timeout: 30_000 })
  writeFileSync(receiptPath, JSON.stringify({ sessionTitle, approvedAtUnix: Math.floor(Date.now() / 1000), decision: 'approve' }, null, 2) + '\n')
  console.log('Approved one native plan review')
} finally {
  await browser.close()
}
