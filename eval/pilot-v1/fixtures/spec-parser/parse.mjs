export function parseSpec(text) {
  const result = {}
  for (const entry of text.split(',')) {
    if (!entry.trim()) continue
    const [key, value] = entry.split('=')
    result[key.trim()] = value.trim()
  }
  return result
}
