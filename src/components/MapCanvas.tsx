import { useCallback, useEffect, useRef, useState } from 'react'
import { Crosshair, Flag, Hand, Maximize, Minus, Plus, Trash2 } from 'lucide-react'
import type { ModWorkspace } from '../types'
import { boundaryRunsToPath } from '../lib/boundaries'
import { parseDefinition } from '../lib/definition'
import type { MapFillMode } from '../lib/mapColors'
import {
  bitmapPointFromClient, clampMapZoom, mapViewportTransform, MAX_MAP_ZOOM, panForZoomAtPoint, wheelZoom,
} from '../lib/viewport'

export type SelectionMode = 'pan' | 'keeper' | 'source'

interface Props {
  workspace: ModWorkspace
  keeperId?: number
  sourceIds: number[]
  mode: SelectionMode
  onModeChange: (mode: SelectionMode) => void
  onPickState: (id: number, mode: SelectionMode) => void
  onClear: () => void
}

interface WorkerPayload {
  type: 'ready' | 'rendered' | 'picked' | 'error'
  width?: number
  height?: number
  pixels?: ArrayBuffer
  boundaries?: ArrayBuffer
  stateId?: number
  requestId?: number
  message?: string
}

const toolItems: Array<{ mode: SelectionMode; label: string; icon: typeof Hand }> = [
  { mode: 'pan', label: '平移', icon: Hand },
  { mode: 'keeper', label: '保留州', icon: Flag },
  { mode: 'source', label: '合并来源', icon: Plus },
]

export function MapCanvas({
  workspace, keeperId, sourceIds, mode, onModeChange, onPickState, onClear,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<HTMLDivElement>(null)
  const workerRef = useRef<Worker | undefined>(undefined)
  const modeRef = useRef(mode)
  const onPickStateRef = useRef(onPickState)
  const pickRequests = useRef(new Map<number, SelectionMode>())
  const requestCounter = useRef(0)
  const dragStart = useRef<{ x: number; y: number; panX: number; panY: number } | undefined>(undefined)
  const [mapSize, setMapSize] = useState({ width: 1, height: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [boundaryPath, setBoundaryPath] = useState('')
  const [fillMode, setFillMode] = useState<MapFillMode>('state')
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 })
  const [view, setView] = useState({ zoom: 1, pan: { x: 0, y: 0 } })
  const mapUnavailable = !workspace.provincesBmp || !workspace.definitionText

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { onPickStateRef.current = onPickState }, [onPickState])

  const paint = (width: number, height: number, buffer: ArrayBuffer) => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) return
    context.putImageData(new ImageData(new Uint8ClampedArray(buffer), width, height), 0, 0)
    setMapSize({ width, height })
    setLoading(false)
  }

  useEffect(() => {
    if (!workspace.provincesBmp || !workspace.definitionText) return
    /* eslint-disable react-hooks/set-state-in-effect -- reset state belongs to the new map worker input */
    setLoading(true)
    setError(undefined)
    setBoundaryPath('')
    setView({ zoom: 1, pan: { x: 0, y: 0 } })
    /* eslint-enable react-hooks/set-state-in-effect */
    const worker = new Worker(new URL('../workers/map.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker
    worker.onmessage = (event: MessageEvent<WorkerPayload>) => {
      const payload = event.data
      if ((payload.type === 'ready' || payload.type === 'rendered') && payload.pixels && payload.width && payload.height) {
        paint(payload.width, payload.height, payload.pixels)
        if (payload.type === 'ready' && payload.boundaries) {
          setBoundaryPath(boundaryRunsToPath(new Uint32Array(payload.boundaries)))
        }
      } else if (payload.type === 'picked' && payload.stateId) {
        const requestMode = pickRequests.current.get((payload as WorkerPayload & { requestId: number }).requestId) ?? modeRef.current
        pickRequests.current.delete((payload as WorkerPayload & { requestId: number }).requestId)
        onPickStateRef.current(payload.stateId, requestMode)
      } else if (payload.type === 'error') {
        setError(payload.message ?? '地图渲染失败')
        setLoading(false)
      }
    }
    const definition = parseDefinition(workspace.definitionText)
    const bmp = workspace.provincesBmp.slice(0)
    worker.postMessage({
      type: 'init',
      bmp,
      definitionEntries: [...definition.entries()],
      provinceStateEntries: [...workspace.provinceToState.entries()],
    }, [bmp])
    return () => worker.terminate()
  }, [workspace])

  useEffect(() => {
    if (!workerRef.current || loading) return
    workerRef.current.postMessage({ type: 'render', keeper: keeperId, sources: sourceIds, fillMode })
  }, [keeperId, sourceIds, fillMode, loading])

  const pick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (mode === 'pan') return
    const rect = event.currentTarget.getBoundingClientRect()
    const { x, y } = bitmapPointFromClient(
      { x: event.clientX, y: event.clientY },
      rect,
      mapSize,
    )
    const requestId = ++requestCounter.current
    pickRequests.current.set(requestId, mode)
    workerRef.current?.postMessage({ type: 'pick', x, y, requestId })
  }

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (mode !== 'pan') return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragStart.current = { x: event.clientX, y: event.clientY, panX: view.pan.x, panY: view.pan.y }
  }

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const start = dragStart.current
    if (!start || mode !== 'pan') return
    setView((current) => ({
      ...current,
      pan: {
        x: start.panX + event.clientX - start.x,
        y: start.panY + event.clientY - start.y,
      },
    }))
  }

  const zoomAtPoint = useCallback((
    nextZoomValue: number | ((currentZoom: number) => number),
    clientX?: number,
    clientY?: number,
  ) => {
    const viewport = viewportRef.current
    if (!viewport) return
    const rect = viewport.getBoundingClientRect()
    const pointer = clientX === undefined || clientY === undefined
      ? { x: 0, y: 0 }
      : {
          x: clientX - (rect.left + rect.width / 2),
          y: clientY - (rect.top + rect.height / 2),
        }
    setView((current) => {
      const requestedZoom = typeof nextZoomValue === 'function'
        ? nextZoomValue(current.zoom)
        : nextZoomValue
      const nextZoom = clampMapZoom(requestedZoom)
      if (nextZoom === current.zoom) return current
      return {
        zoom: nextZoom,
        pan: panForZoomAtPoint(current.pan, pointer, current.zoom, nextZoom),
      }
    })
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      zoomAtPoint(
        (currentZoom) => wheelZoom(currentZoom, event.deltaY),
        event.clientX,
        event.clientY,
      )
    }
    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [zoomAtPoint])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateSize = () => setViewportSize({ width: viewport.clientWidth, height: viewport.clientHeight })
    updateSize()
    const observer = new ResizeObserver(updateSize)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [])

  const mapTransform = mapViewportTransform(viewportSize, mapSize, view.zoom, view.pan)
  const canvasTransform = `matrix(${mapTransform.scale}, 0, 0, ${mapTransform.scale}, ${mapTransform.translateX}, ${mapTransform.translateY})`
  const boundaryTransform = `matrix(${mapTransform.scale} 0 0 ${mapTransform.scale} ${mapTransform.translateX} ${mapTransform.translateY})`

  return (
    <section className="map-panel">
      <div className="map-toolbar" aria-label="地图工具">
        {toolItems.map(({ mode: itemMode, label, icon: Icon }) => (
          <button
            key={itemMode}
            className={mode === itemMode ? `map-tool active ${itemMode}` : 'map-tool'}
            onClick={() => onModeChange(itemMode)}
            title={label}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
        <button className="map-tool" onClick={onClear} title="清除选择">
          <Trash2 size={16} /><span>清除</span>
        </button>
        <button className="map-tool" onClick={() => setView({ zoom: 1, pan: { x: 0, y: 0 } })} title="适应视图">
          <Maximize size={16} /><span>适应</span>
        </button>
      </div>
      <div ref={viewportRef} className="map-viewport">
        {!mapUnavailable && loading ? <div className="map-status"><Crosshair size={20} /> 正在生成 State 地图…</div> : null}
        {mapUnavailable || error ? <div className="map-status error">{mapUnavailable ? '缺少 map/provinces.bmp 或 map/definition.csv，无法显示地图。' : error}</div> : null}
        <canvas
          ref={canvasRef}
          className={mode === 'pan' ? 'map-canvas pan-mode' : 'map-canvas select-mode'}
          style={{
            left: 0,
            top: 0,
            width: mapSize.width,
            height: mapSize.height,
            transform: canvasTransform,
          }}
          onClick={pick}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={() => { dragStart.current = undefined }}
          onPointerCancel={() => { dragStart.current = undefined }}
        />
        <svg
          className="map-boundaries"
          viewBox={`0 0 ${viewportSize.width} ${viewportSize.height}`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <g transform={boundaryTransform}>
            <path d={boundaryPath} vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        <div className="zoom-controls">
          <button aria-label="放大地图" onClick={() => zoomAtPoint((currentZoom) => currentZoom * 1.5)}><Plus size={16} /></button>
          <span className="zoom-level">{Math.round(view.zoom * 100)}%</span>
          <button aria-label="缩小地图" onClick={() => zoomAtPoint((currentZoom) => currentZoom / 1.5)}><Minus size={16} /></button>
        </div>
        <div className="map-legend">
          <span><i className="legend-keeper" />保留 State</span>
          <span><i className="legend-source" />合并来源</span>
          <div className="map-fill-toggle" role="group" aria-label="地图填色模式">
            <button className={fillMode === 'state' ? 'active' : ''} onClick={() => setFillMode('state')}>State 色</button>
            <button className={fillMode === 'province' ? 'active' : ''} onClick={() => setFillMode('province')}>Province RGB</button>
          </div>
          <span>
            滚轮缩放 · 最大 {MAX_MAP_ZOOM * 100}% · {fillMode === 'state' ? '代表色取自同一 map 定义' : '原始 provinces.bmp 像素'} · 细 State 边界
          </span>
        </div>
      </div>
    </section>
  )
}
