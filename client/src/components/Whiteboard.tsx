import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import type { WhiteboardPoint, WhiteboardScene } from '../api/types.ts'
import { useToast } from './toast-context.ts'
import { ErrorState } from './ui.tsx'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'

type Tool = 'pen' | 'eraser' | 'rect' | 'ellipse' | 'text' | 'pan'

const COLORS = ['#171717', '#1d4ed8', '#b91c1c', '#047857']

const EMPTY: WhiteboardScene = {
  strokes: [],
  shapes: [],
  texts: [],
  viewport: { x: 0, y: 0, scale: 1 },
}

function uid(): string {
  return crypto.randomUUID().slice(0, 12)
}

function drawScene(ctx: CanvasRenderingContext2D, scene: WhiteboardScene, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, width, height)
  const { x, y, scale } = scene.viewport
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, x * dpr, y * dpr)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const shape of scene.shapes) {
    ctx.save()
    ctx.strokeStyle = shape.color
    ctx.lineWidth = 2
    ctx.beginPath()
    if (shape.kind === 'rect') ctx.strokeRect(shape.x, shape.y, shape.w, shape.h)
    else {
      ctx.ellipse(shape.x + shape.w / 2, shape.y + shape.h / 2, Math.abs(shape.w / 2), Math.abs(shape.h / 2), 0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }
  for (const stroke of scene.strokes) {
    if (stroke.points.length === 0) continue
    ctx.save()
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.width
    ctx.beginPath()
    stroke.points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y)
      else ctx.lineTo(point.x, point.y)
    })
    ctx.stroke()
    ctx.restore()
  }
  ctx.globalCompositeOperation = 'source-over'
  ctx.font = '16px Geist, sans-serif'
  ctx.textBaseline = 'top'
  for (const item of scene.texts) {
    ctx.fillStyle = item.color
    ctx.fillText(item.text, item.x, item.y)
  }
}

export function Whiteboard({ projectId }: { projectId: string }) {
  const toast = useToast()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState<WhiteboardScene>(EMPTY)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [status, setStatus] = useState<'saved' | 'saving' | 'idle'>('idle')
  const [draft, setDraft] = useState<{ x: number; y: number; value: string } | null>(null)
  const hydrated = useRef(false)
  const sceneRef = useRef(scene)
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  useEffect(() => {
    sceneRef.current = scene
    toolRef.current = tool
    colorRef.current = color
  })
  const drawing = useRef<{ kind: Tool; start: WhiteboardPoint; points: WhiteboardPoint[] } | null>(null)

  const board = useQuery({
    queryKey: ['whiteboard', projectId],
    queryFn: () => api.getWhiteboard(projectId),
  })

  const save = useMutation({
    mutationFn: (next: WhiteboardScene) => api.saveWhiteboard(projectId, next),
    onSuccess: () => setStatus('saved'),
    onError: (error) => {
      setStatus('idle')
      toast(errorMessage(error))
    },
  })

  useEffect(() => {
    if (!board.data || hydrated.current) return
    hydrated.current = true
    setScene(board.data.scene)
  }, [board.data])

  const saveScene = save.mutate
  useEffect(() => {
    if (!hydrated.current) return
    setStatus('saving')
    const timer = window.setTimeout(() => saveScene(sceneRef.current), 600)
    return () => window.clearTimeout(timer)
  }, [scene, saveScene])

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const paint = () => {
      const rect = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.max(1, Math.floor(rect.width * dpr))
      canvas.height = Math.max(1, Math.floor(rect.height * dpr))
      const ctx = canvas.getContext('2d')
      if (ctx) drawScene(ctx, sceneRef.current, canvas.width, canvas.height)
    }
    paint()
    const observer = new ResizeObserver(paint)
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [scene])

  function worldPoint(event: { clientX: number; clientY: number }): WhiteboardPoint {
    const canvas = canvasRef.current
    const { x, y, scale } = sceneRef.current.viewport
    const rect = canvas?.getBoundingClientRect()
    const localX = event.clientX - (rect?.left ?? 0)
    const localY = event.clientY - (rect?.top ?? 0)
    return { x: (localX - x) / scale, y: (localY - y) / scale }
  }

  function commit(next: WhiteboardScene) {
    sceneRef.current = next
    setScene(next)
  }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      canvas.setPointerCapture(event.pointerId)
      const point = worldPoint(event)
      const current = toolRef.current
      if (current === 'text') {
        setDraft({ x: point.x, y: point.y, value: '' })
        return
      }
      drawing.current = { kind: current, start: point, points: [point] }
    }

    const onMove = (event: PointerEvent) => {
      const active = drawing.current
      if (!active) return
      const point = worldPoint(event)
      if (active.kind === 'pan') {
        const view = sceneRef.current.viewport
        commit({
          ...sceneRef.current,
          viewport: { ...view, x: view.x + event.movementX, y: view.y + event.movementY },
        })
        return
      }
      active.points.push(point)
      const preview = previewScene(sceneRef.current, active, colorRef.current)
      const ctx = canvas.getContext('2d')
      if (ctx) drawScene(ctx, preview, canvas.width, canvas.height)
    }

    const onUp = () => {
      const active = drawing.current
      drawing.current = null
      if (!active || active.kind === 'pan' || active.kind === 'text') return
      commit(previewScene(sceneRef.current, active, colorRef.current))
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const view = sceneRef.current.viewport
      const nextScale = Math.min(4, Math.max(0.2, view.scale * (event.deltaY > 0 ? 0.92 : 1.08)))
      const rect = canvas.getBoundingClientRect()
      const localX = event.clientX - rect.left
      const localY = event.clientY - rect.top
      const worldX = (localX - view.x) / view.scale
      const worldY = (localY - view.y) / view.scale
      commit({
        ...sceneRef.current,
        viewport: { scale: nextScale, x: localX - worldX * nextScale, y: localY - worldY * nextScale },
      })
    }

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      canvas.removeEventListener('wheel', onWheel)
    }
  }, [])

  function finishText() {
    if (!draft) return
    const value = draft.value.trim()
    if (value) {
      commit({
        ...sceneRef.current,
        texts: [...sceneRef.current.texts, { id: uid(), x: draft.x, y: draft.y, text: value.slice(0, 280), color }],
      })
    }
    setDraft(null)
  }

  if (board.isError) {
    return (
      <div className="mt-8">
        <ErrorState onRetry={() => void board.refetch()} />
      </div>
    )
  }

  const screenDraft = draft
    ? {
        left: draft.x * scene.viewport.scale + scene.viewport.x,
        top: draft.y * scene.viewport.scale + scene.viewport.y,
      }
    : null

  return (
    <div className="mt-8 border border-neutral-200">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-2">
        {(['pen', 'rect', 'ellipse', 'text', 'eraser', 'pan'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tool === item}
            className={cn(
              'focus-ring border px-2 py-1 text-xs capitalize',
              tool === item ? 'border-neutral-950 bg-neutral-950 text-white' : 'border-neutral-300 text-neutral-600',
            )}
            onClick={() => setTool(item)}
          >
            {item === 'rect' ? 'Rectangle' : item}
          </button>
        ))}
        <span className="mx-1 h-5 w-px bg-neutral-200" aria-hidden />
        {COLORS.map((swatch) => (
          <button
            key={swatch}
            type="button"
            aria-label={swatch}
            aria-pressed={color === swatch}
            className={cn('focus-ring h-6 w-6 border', color === swatch ? 'border-neutral-950' : 'border-transparent')}
            style={{ backgroundColor: swatch }}
            onClick={() => setColor(swatch)}
          />
        ))}
        <button
          type="button"
          className="focus-ring ml-auto border border-neutral-300 px-2 py-1 text-xs"
          onClick={() =>
            commit({
              ...scene,
              viewport: {
                ...scene.viewport,
                scale: Math.min(4, scene.viewport.scale * 1.1),
              },
            })
          }
        >
          Zoom in
        </button>
        <button
          type="button"
          className="focus-ring border border-neutral-300 px-2 py-1 text-xs"
          onClick={() =>
            commit({
              ...scene,
              viewport: { ...scene.viewport, scale: Math.max(0.2, scene.viewport.scale / 1.1) },
            })
          }
        >
          Zoom out
        </button>
        <span className="font-mono text-[11px] text-neutral-500">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : ''}</span>
      </div>
      <div ref={wrapRef} className="relative h-[28rem] bg-white">
        <canvas ref={canvasRef} className="h-full w-full touch-none" aria-label="Project whiteboard" />
        {screenDraft ? (
          <input
            autoFocus
            value={draft?.value ?? ''}
            aria-label="Whiteboard text"
            className="focus-ring absolute border border-neutral-950 bg-white px-1 text-sm"
            style={{ left: screenDraft.left, top: screenDraft.top }}
            onChange={(event) => setDraft((current) => (current ? { ...current, value: event.target.value } : current))}
            onBlur={finishText}
            onKeyDown={(event) => {
              if (event.key === 'Enter') finishText()
              if (event.key === 'Escape') setDraft(null)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function previewScene(
  scene: WhiteboardScene,
  active: { kind: Tool; start: WhiteboardPoint; points: WhiteboardPoint[] },
  color: string,
): WhiteboardScene {
  if (active.kind === 'pen' || active.kind === 'eraser') {
    const points = active.points.length === 1 ? [active.points[0], active.points[0]] : active.points
    return {
      ...scene,
      strokes: [
        ...scene.strokes,
        { id: uid(), tool: active.kind, points, color, width: active.kind === 'eraser' ? 18 : 2.5 },
      ],
    }
  }
  if (active.kind === 'rect' || active.kind === 'ellipse') {
    const end = active.points[active.points.length - 1] ?? active.start
    return {
      ...scene,
      shapes: [
        ...scene.shapes,
        {
          id: uid(),
          kind: active.kind,
          x: Math.min(active.start.x, end.x),
          y: Math.min(active.start.y, end.y),
          w: Math.abs(end.x - active.start.x),
          h: Math.abs(end.y - active.start.y),
          color,
        },
      ],
    }
  }
  return scene
}
