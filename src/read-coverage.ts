/** Actual successful pages must cover one contiguous stored original. */
export function complete(ranges: [number, number][], total: number): boolean {
  let end = 0
  for (const [start, stop] of [...ranges].sort((a, b) => a[0] - b[0])) {
    if (start > end) return false
    end = Math.max(end, stop)
  }
  return end >= total
}
