import { parseSpec } from './parse.mjs'

const text = process.argv[2] ?? ''
console.log(JSON.stringify(parseSpec(text)))
