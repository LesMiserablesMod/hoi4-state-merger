export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface MapViewportTransform {
  fitScale: number
  scale: number
  translateX: number
  translateY: number
}

export const MIN_MAP_ZOOM = 0.5
export const MAX_MAP_ZOOM = 24

export function clampMapZoom(value: number): number {
  return Math.min(MAX_MAP_ZOOM, Math.max(MIN_MAP_ZOOM, value))
}

export function wheelZoom(currentZoom: number, deltaY: number): number {
  return clampMapZoom(currentZoom * Math.exp(-deltaY * 0.002))
}

export function mapViewportTransform(
  viewport: Size,
  bitmap: Size,
  zoom: number,
  pan: Point,
): MapViewportTransform {
  const fitScale = Math.min(
    1,
    viewport.width / Math.max(1, bitmap.width),
    viewport.height / Math.max(1, bitmap.height),
  )
  const scale = fitScale * zoom
  return {
    fitScale,
    scale,
    translateX: viewport.width / 2 + pan.x - bitmap.width * scale / 2,
    translateY: viewport.height / 2 + pan.y - bitmap.height * scale / 2,
  }
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
