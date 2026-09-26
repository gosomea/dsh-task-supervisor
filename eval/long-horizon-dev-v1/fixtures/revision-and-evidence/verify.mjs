import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const rows = readFileSync('data.csv', 'utf8').trim().split('\n').slice(1)
const values = rows.map(row => Number(row.split(',')[1]))
const report = JSON.parse(readFileSync('report.json', 'utf8'))
assert.equal(report.count, values.length)
assert.equal(report.sum, values.reduce((total, value) => total + value, 0))
if (Object.hasOwn(report, 'max')) assert.equal(report.max, Math.max(...values))
console.log('verification passed')
