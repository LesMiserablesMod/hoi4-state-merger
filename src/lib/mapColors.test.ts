import { describe, expect, it } from 'vitest'
import { buildStateColorTable, displayRgbForPixel } from './mapColors'

describe('State map colours', () => {
  it('uses the first listed Province RGB as a stable State representative', () => {
    const colors = buildStateColorTable(
      [[0x112233, 20], [0x445566, 21], [0x778899, 30]],
      [[20, 2], [21, 2], [30, 3]],
    )
    expect(colors[2] - 1).toBe(0x112233)
    expect(colors[3] - 1).toBe(0x778899)
  })

  it('gives merged Provinces the keeper colour without changing their map RGB', () => {
    const colors = buildStateColorTable(
      [[0x112233, 20], [0x445566, 30]],
      [[20, 2], [30, 2]],
    )
    expect(displayRgbForPixel(0x112233, 2, colors, 'state')).toBe(0x112233)
    expect(displayRgbForPixel(0x445566, 2, colors, 'state')).toBe(0x112233)
    expect(displayRgbForPixel(0x445566, 2, colors, 'province')).toBe(0x445566)
  })

  it('falls back to the original pixel RGB outside a known State', () => {
    expect(displayRgbForPixel(0xaabbcc, 0, new Uint32Array(), 'state')).toBe(0xaabbcc)
  })
})
