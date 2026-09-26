import { strict as assert } from 'node:assert'
import { parseSpec } from './parse.mjs'

assert.deepEqual(parseSpec('a=1,b=2'), { a: '1', b: '2' })
assert.deepEqual(parseSpec(' a = 1 , a = 2 '), { a: '2' })
assert.deepEqual(parseSpec(''), {})
