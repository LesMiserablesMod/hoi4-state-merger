import { describe, expect, it } from 'vitest'
import { boundaryRunsToPath, extractStateBoundaryRuns } from './boundaries'

describe('State boundary extraction', () => {
  it('merges contiguous grid edges into thin horizontal and vertical runs', () => {
    const pixels = Uint32Array.from([
      1, 1, 2,
      1, 1, 2,
    ])
    const runs = extractStateBoundaryRuns(pixels, 3, 2)
    const tuples = Array.from({ length: runs.length / 4 }, (_, index) =>
      [...runs.slice(index * 4, index * 4 + 4)],
    )
    expect(tuples).toContainEqual([2, 0, 2, 2])
    expect(tuples).toContainEqual([0, 0, 3, 0])
    expect(tuples).toContainEqual([0, 2, 3, 2])
    expect(boundaryRunsToPath(runs)).toContain('M2 0L2 2')
  })

  it('returns no boundary for an empty ocean grid', () => {
    expect(extractStateBoundaryRuns(new Uint32Array(4), 2, 2)).toHaveLength(0)
  })
})
