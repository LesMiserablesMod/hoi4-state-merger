export interface Point {
  x: number
  y: number
}

export const MIN_MAP_ZOOM = 0.5
export const MAX_MAP_ZOOM = 24

export function clampMapZoom(value: number): number {
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, value))
}

export function wheelZoom(currentZoom: number, deltaY: number): number {
  return clampMapZoom(currentZoom * Math.exp(-deltaY * 0.002))
}

export function panForZoomAtPoint(
  currentPan: Point,
  pointerFromViewportCenter: Point,
  currentZoom: number,
  nextZoom: number,
): Point {
  const ratio = nextZoom / currentZoom
  return {
    x: pointerFromViewportCenter.x - (pointerFromViewportCenter.x - currentPan.x) * ratio,
    y: pointerFromViewportCenter.y - (pointerFromViewportCenter.y - currentPan.y) * ratio,
  }
}

export function bitmapPointFromClient(
  client: Point,
  canvasRect: { left: number; top: number; width: number; height: number },
  bitmapSize: { width: number; height: number },
): Point {
  const normalizedX = (client.x - canvasRect.left) / canvasRect.width
  const normalizedY = (client.y - canvasRect.top) / canvasRect.height
  return {
    x: Math.min(bitmapSize.width - 1, Math.max(0, Math.floor(normalizedX * bitmapSize.width))),
    y: Math.min(bitmapSize.height - 1, Math.max(0, Math.floor(normalizedY * bitmapSize.height))),
  }
}
