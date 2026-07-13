export function parseDefinition(text: string): Map<number, number> {
  const result = new Map<number, number>()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(';')
    if (parts.length < 4) continue
    const id = Number(parts[0])
    const red = Number(parts[1])
    const green = Number(parts[2])
    const blue = Number(parts[3])
    if (![id, red, green, blue].every(Number.isFinite)) continue
    result.set((red << 16) | (green << 8) | blue, id)
  }
  return result
}
