import { describe, expect, it } from 'vitest'
import {
  bitmapPointFromClient, mapViewportTransform, MAX_MAP_ZOOM, panForZoomAtPoint, wheelZoom,
} from './viewport'

describe('map viewport zoom', () => {
  it('keeps the map coordinate under the pointer fixed while zooming', () => {
    const pointer = { x: 180, y: -70 }
    const before = { zoom: 2, pan: { x: 30, y: 10 } }
    const nextZoom = 4
    const nextPan = panForZoomAtPoint(before.pan, pointer, before.zoom, nextZoom)
    const contentBefore = {
      x: (pointer.x - before.pan.x) / before.zoom,
      y: (pointer.y - before.pan.y) / before.zoom,
    }
    const contentAfter = {
      x: (pointer.x - nextPan.x) / nextZoom,
      y: (pointer.y - nextPan.y) / nextZoom,
    }
    expect(contentAfter.x).toBeCloseTo(contentBefore.x)
    expect(contentAfter.y).toBeCloseTo(contentBefore.y)
  })

  it('supports 2400% zoom and clamps further wheel input', () => {
    expect(wheelZoom(4, -10_000)).toBe(MAX_MAP_ZOOM)
    expect(MAX_MAP_ZOOM).toBe(24)
  })

  it('maps a transformed canvas click to the exact bitmap pixel', () => {
    const rect = { left: -630, top: -245, width: 2880, height: 1440 }
    expect(bitmapPointFromClient(
      { x: rect.left + 42.5 * 4, y: rect.top + 17.5 * 4 },
      rect,
      { width: 720, height: 360 },
    )).toEqual({ x: 42, y: 17 })
  })

  it('uses one direct bitmap-to-viewport transform at 2400% zoom', () => {
    const viewport = { width: 997, height: 643 }
    const bitmap = { width: 5632, height: 2048 }
    const pan = { x: 37, y: -19 }
    const transform = mapViewportTransform(viewport, bitmap, MAX_MAP_ZOOM, pan)

    expect(transform.scale).toBe(transform.fitScale * MAX_MAP_ZOOM)
    expect(transform.translateX + bitmap.width * transform.scale / 2)
      .toBeCloseTo(viewport.width / 2 + pan.x)
    expect(transform.translateY + bitmap.height * transform.scale / 2)
      .toBeCloseTo(viewport.height / 2 + pan.y)
  })
})
