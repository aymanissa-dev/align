import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/index.ts'
import type { WhiteboardPoint, WhiteboardScene } from '../api/types.ts'
import { useToast } from './toast-context.ts'
import { ErrorState, OfflineState } from './ui.tsx'
import { useQueryMiss } from '../lib/queryMiss.ts'
import { cn } from '../lib/cn.ts'
import { eraseScene } from '../../../shared/erase.ts'
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
    if (stroke.points.length === 0 || stroke.tool === 'eraser') continue
    ctx.save()
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
  const textRef = useRef<HTMLInputElement>(null)
  const draftRef = useRef<{ x: number; y: number; value: string } | null>(null)
  const draftId = useRef<string | null>(null)
  const textOpened = useRef(0)
  const hydrated = useRef(false)
  const dirty = useRef(false)
  const sceneRef = useRef(scene)
  const toolRef = useRef(tool)
  const colorRef = useRef(color)
  useEffect(() => {
    sceneRef.current = scene
    toolRef.current = tool
    colorRef.current = color
  })
  const drawing = useRef<{ kind: Tool; start: WhiteboardPoint; points: WhiteboardPoint[] } | null>(null)
  const saveTimer = useRef<number | null>(null)
  const revision = useRef(0)
  const savingRevision = useRef(0)
  const projectIdRef = useRef(projectId)
  useEffect(() => {
    projectIdRef.current = projectId
  }, [projectId])

  const board = useQuery({
    queryKey: ['whiteboard', projectId],
    queryFn: () => api.getWhiteboard(projectId),
  })
  const boardMiss = useQueryMiss(board)

  const save = useMutation({
    mutationFn: (next: WhiteboardScene) => api.saveWhiteboard(projectId, next),
    onSuccess: () => {
      if (savingRevision.current === revision.current) {
        dirty.current = false
        setStatus('saved')
      }
    },
    onError: (error) => {
      setStatus('idle')
      toast(errorMessage(error))
    },
  })

  useEffect(() => {
    if (!board.data || hydrated.current) return
    hydrated.current = true
    if (dirty.current) return
    sceneRef.current = board.data.scene
    setScene(board.data.scene)
  }, [board.data])

  const saveScene = save.mutate
  useEffect(() => {
    if (!dirty.current) return
    setStatus('saving')
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      savingRevision.current = revision.current
      saveScene(sceneRef.current)
    }, 250)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [scene, saveScene])

  useEffect(() => {
    const sceneToSave = () => {
      const live = textRef.current?.value ?? draftRef.current?.value ?? ''
      const point = draftRef.current
      if (!point || !live.trim()) return sceneRef.current
      const id = draftId.current ?? uid()
      draftId.current = id
      const texts = sceneRef.current.texts.filter((item) => item.id !== id)
      texts.push({ id, x: point.x, y: point.y, text: live.trim().slice(0, 280), color: colorRef.current })
      const next = { ...sceneRef.current, texts }
      sceneRef.current = next
      dirty.current = true
      return next
    }
    const flush = () => {
      const scene = sceneToSave()
      const uncommitted = (textRef.current?.value ?? draftRef.current?.value ?? '').trim()
      if (!dirty.current && !uncommitted) return
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = null
      }
      dirty.current = false
      savingRevision.current = revision.current
      void fetch(`/api/projects/${projectIdRef.current}/whiteboard`, {
        method: 'PUT',
        credentials: 'include',
        keepalive: true,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ scene }),
      })
    }
    const onLeave = (event: BeforeUnloadEvent) => {
      const uncommitted = (textRef.current?.value ?? draftRef.current?.value ?? '').trim()
      if (!dirty.current && !uncommitted) return
      event.preventDefault()
      event.returnValue = ''
      flush()
    }
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', onLeave)
    window.addEventListener('pagehide', onLeave)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onLeave)
      window.removeEventListener('pagehide', onLeave)
      document.removeEventListener('visibilitychange', onHide)
      flush()
    }
  }, [])

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
    revision.current += 1
    dirty.current = true
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
        event.preventDefault()
        textOpened.current = performance.now()
        const next = { x: point.x, y: point.y, value: '' }
        draftRef.current = next
        draftId.current = uid()
        setDraft(next)
        window.setTimeout(() => textRef.current?.focus(), 40)
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

  function publishDraft(next: { x: number; y: number; value: string }) {
    draftRef.current = next
    const value = next.value.trim()
    const id = draftId.current ?? uid()
    draftId.current = id
    const texts = sceneRef.current.texts.filter((item) => item.id !== id)
    if (value) texts.push({ id, x: next.x, y: next.y, text: value.slice(0, 280), color: colorRef.current })
    commit({ ...sceneRef.current, texts })
  }

  function finishText() {
    const current = draftRef.current
    if (current?.value.trim()) publishDraft(current)
    draftRef.current = null
    draftId.current = null
    setDraft(null)
  }

  if (boardMiss === 'offline') {
    return (
      <div className="mt-8">
        <OfflineState />
      </div>
    )
  }
  if (board.isError && !board.data) {
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
      <div className="flex items-center gap-2 overflow-x-auto border-b border-neutral-200 px-3 py-2 whitespace-nowrap">
        {(['pen', 'rect', 'ellipse', 'text', 'eraser', 'pan'] as const).map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={tool === item}
            className={cn(
              'focus-ring inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center border px-3 text-xs capitalize',
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
            className={cn('focus-ring h-11 w-11 shrink-0 border', color === swatch ? 'border-neutral-950' : 'border-transparent')}
            style={{ backgroundColor: swatch }}
            onClick={() => setColor(swatch)}
          />
        ))}
        <button
          type="button"
          className="focus-ring ml-auto inline-flex min-h-11 shrink-0 items-center border border-neutral-300 px-3 text-xs"
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
          className="focus-ring inline-flex min-h-11 shrink-0 items-center border border-neutral-300 px-3 text-xs"
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
      <div ref={wrapRef} className="board-surface relative h-[28rem]">
        <canvas ref={canvasRef} className="h-full w-full touch-none" aria-label="Project whiteboard" />
        {screenDraft ? (
          <input
            ref={textRef}
            value={draft?.value ?? ''}
            aria-label="Whiteboard text"
            className="board-surface focus-ring absolute z-10 min-h-11 min-w-40 border border-neutral-950 px-2 text-sm"
            style={{ left: screenDraft.left, top: screenDraft.top }}
            onPointerDown={(event) => event.stopPropagation()}
            onChange={(event) => {
              const value = event.target.value
              const current = draftRef.current
              if (!current) return
              const next = { ...current, value }
              setDraft(next)
              publishDraft(next)
            }}
            onBlur={() => {
              if (performance.now() - textOpened.current < 400) {
                window.setTimeout(() => textRef.current?.focus(), 0)
                return
              }
              finishText()
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                textOpened.current = 0
                finishText()
              }
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
  if (active.kind === 'eraser') return eraseScene(scene, active.points)
  if (active.kind === 'pen') {
    const points = active.points.length === 1 ? [active.points[0], active.points[0]] : active.points
    return {
      ...scene,
      strokes: [...scene.strokes, { id: uid(), tool: 'pen' as const, points, color, width: 2.5 }],
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
