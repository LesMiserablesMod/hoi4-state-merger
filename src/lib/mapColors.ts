export type MapFillMode = 'state' | 'province'

/**
 * Build a compact State -> RGB lookup table. The first Province listed for a
 * State supplies its representative colour, so a merged State keeps the
 * keeper's original map colour when its Province list is appended.
 *
 * Values are stored as RGB + 1 so zero can mean "no representative colour".
 */
export function buildStateColorTable(
  definitionEntries: Array<[number, number]>,
  provinceStateEntries: Array<[number, number]>,
): Uint32Array {
  const provinceColors = new Map<number, number>()
  for (const [rgb, province] of definitionEntries) provinceColors.set(province, rgb)

  const maxState = provinceStateEntries.reduce((maximum, [, state]) => Math.max(maximum, state), 0)
  const colors = new Uint32Array(maxState + 1)
  for (const [province, state] of provinceStateEntries) {
    if (state <= 0 || colors[state] !== 0) continue
    const rgb = provinceColors.get(province)
    if (rgb !== undefined) colors[state] = rgb + 1
  }
  return colors
}

export function displayRgbForPixel(
  mapRgb: number,
  state: number,
  stateColors: Uint32Array,
  fillMode: MapFillMode,
): number {
  const encodedStateColor = stateColors[state] ?? 0
  return fillMode === 'state' && encodedStateColor !== 0 ? encodedStateColor - 1 : mapRgb
}
