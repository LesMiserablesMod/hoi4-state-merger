export function extractStateBoundaryRuns(
  statePixels: Uint32Array,
  width: number,
  height: number,
): Uint32Array {
  if (width <= 0 || height <= 0 || statePixels.length !== width * height) return new Uint32Array()
  const runs: number[] = []

  const stateAt = (x: number, y: number): number => {
    if (x < 0 || x >= width || y < 0 || y >= height) return 0
    return statePixels[y * width + x]
  }

  for (let edgeY = 0; edgeY <= height; edgeY += 1) {
    let start = -1
    for (let x = 0; x <= width; x += 1) {
      const above = x < width ? stateAt(x, edgeY - 1) : 0
      const below = x < width ? stateAt(x, edgeY) : 0
      const boundary = x < width && above !== below && (above !== 0 || below !== 0)
      if (boundary && start < 0) start = x
      if (!boundary && start >= 0) {
        runs.push(start, edgeY, x, edgeY)
        start = -1
      }
    }
  }

  for (let edgeX = 0; edgeX <= width; edgeX += 1) {
    let start = -1
    for (let y = 0; y <= height; y += 1) {
      const left = y < height ? stateAt(edgeX - 1, y) : 0
      const right = y < height ? stateAt(edgeX, y) : 0
      const boundary = y < height && left !== right && (left !== 0 || right !== 0)
      if (boundary && start < 0) start = y
      if (!boundary && start >= 0) {
        runs.push(edgeX, start, edgeX, y)
        start = -1
      }
    }
  }

  return Uint32Array.from(runs)
}

export function boundaryRunsToPath(runs: Uint32Array): string {
  const commands: string[] = []
  for (let index = 0; index + 3 < runs.length; index += 4) {
    commands.push(`M${runs[index]} ${runs[index + 1]}L${runs[index + 2]} ${runs[index + 3]}`)
  }
  return commands.join('')
}
