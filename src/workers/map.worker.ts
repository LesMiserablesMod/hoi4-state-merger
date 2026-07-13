/// <reference lib="webworker" />

import { extractStateBoundaryRuns } from '../lib/boundaries'
import { buildStateColorTable, displayRgbForPixel, type MapFillMode } from '../lib/mapColors'

interface InitMessage {
  type: 'init'
  bmp: ArrayBuffer
  definitionEntries: Array<[number, number]>
  provinceStateEntries: Array<[number, number]>
}

interface RenderMessage {
  type: 'render'
  keeper?: number
  sources: number[]
  fillMode: MapFillMode
}

interface PickMessage {
  type: 'pick'
  x: number
  y: number
  requestId: number
}

let width = 0
let height = 0
let rgbPixels = new Uint32Array()
let statePixels = new Uint32Array()
let stateColors = new Uint32Array()

function decodeBmp(buffer: ArrayBuffer): { width: number; height: number; rgb: Uint32Array } {
  const view = new DataView(buffer)
  if (view.getUint16(0, true) !== 0x4d42) throw new Error('provinces.bmp 不是有效 BMP')
  const dataOffset = view.getUint32(10, true)
  const imageWidth = view.getInt32(18, true)
  const signedHeight = view.getInt32(22, true)
  const imageHeight = Math.abs(signedHeight)
  const bits = view.getUint16(28, true)
  const compression = view.getUint32(30, true)
  if (compression !== 0 || (bits !== 24 && bits !== 32)) throw new Error(`只支持未压缩 24/32-bit BMP，当前 ${bits}-bit compression=${compression}`)
  const bytesPerPixel = bits / 8
  const rowStride = Math.ceil((imageWidth * bytesPerPixel) / 4) * 4
  const bottomUp = signedHeight > 0
  const rgb = new Uint32Array(imageWidth * imageHeight)
  for (let y = 0; y < imageHeight; y += 1) {
    const sourceY = bottomUp ? imageHeight - 1 - y : y
    let offset = dataOffset + sourceY * rowStride
    for (let x = 0; x < imageWidth; x += 1) {
      const blue = view.getUint8(offset)
      const green = view.getUint8(offset + 1)
      const red = view.getUint8(offset + 2)
      rgb[y * imageWidth + x] = (red << 16) | (green << 8) | blue
      offset += bytesPerPixel
    }
  }
  return { width: imageWidth, height: imageHeight, rgb }
}

function render(keeper: number | undefined, sources: number[], fillMode: MapFillMode): ArrayBuffer {
  const sourceSet = new Set(sources)
  const rgba = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < statePixels.length; index += 1) {
    const state = statePixels[index]
    const displayRgb = displayRgbForPixel(rgbPixels[index], state, stateColors, fillMode)
    let red = displayRgb >>> 16
    let green = (displayRgb >>> 8) & 255
    let blue = displayRgb & 255
    if (state === keeper) [red, green, blue] = [205, 161, 62]
    else if (sourceSet.has(state)) [red, green, blue] = [190, 67, 55]
    const offset = index * 4
    rgba[offset] = red
    rgba[offset + 1] = green
    rgba[offset + 2] = blue
    rgba[offset + 3] = 255
  }
  return rgba.buffer
}

self.onmessage = (event: MessageEvent<InitMessage | RenderMessage | PickMessage>) => {
  try {
    if (event.data.type === 'init') {
      const decoded = decodeBmp(event.data.bmp)
      width = decoded.width
      height = decoded.height
      rgbPixels = decoded.rgb
      const definition = new Map(event.data.definitionEntries)
      const provinceState = new Map(event.data.provinceStateEntries)
      stateColors = buildStateColorTable(event.data.definitionEntries, event.data.provinceStateEntries)
      statePixels = new Uint32Array(width * height)
      for (let index = 0; index < rgbPixels.length; index += 1) {
        const province = definition.get(rgbPixels[index]) ?? 0
        statePixels[index] = provinceState.get(province) ?? 0
      }
      const pixels = render(undefined, [], 'state')
      const boundaries = extractStateBoundaryRuns(statePixels, width, height).buffer
      self.postMessage({ type: 'ready', width, height, pixels, boundaries }, { transfer: [pixels, boundaries] })
      return
    }
    if (event.data.type === 'render') {
      const pixels = render(event.data.keeper, event.data.sources, event.data.fillMode)
      self.postMessage({ type: 'rendered', width, height, pixels }, { transfer: [pixels] })
      return
    }
    const x = Math.max(0, Math.min(width - 1, Math.floor(event.data.x)))
    const y = Math.max(0, Math.min(height - 1, Math.floor(event.data.y)))
    self.postMessage({ type: 'picked', stateId: statePixels[y * width + x], requestId: event.data.requestId })
  } catch (error) {
    self.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}

export {}
