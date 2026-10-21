export const ERASER_RADIUS = 18

export type ErasePoint = { x: number; y: number }

type Stroke = {
  id: string
  tool: 'pen' | 'eraser'
  points: ErasePoint[]
  color: string
  width: number
}

type Shape = {
  id: string
  kind: 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  color: string
}

type TextItem = { id: string; x: number; y: number; text: string; color: string }

export type ErasableScene = {
  strokes: Stroke[]
  shapes: Shape[]
  texts: TextItem[]
  viewport: { x: number; y: number; scale: number }
}

function hypot(a: ErasePoint, b: ErasePoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function pointSegmentDistance(point: ErasePoint, start: ErasePoint, end: ErasePoint): number {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = dx * dx + dy * dy
  if (length === 0) return hypot(point, start)
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length))
  return hypot(point, { x: start.x + t * dx, y: start.y + t * dy })
}

function cross(origin: ErasePoint, a: ErasePoint, b: ErasePoint): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x)
}

function segmentsIntersect(a: ErasePoint, b: ErasePoint, c: ErasePoint, d: ErasePoint): boolean {
  const ab = cross(c, d, a)
  const ba = cross(c, d, b)
  const cd = cross(a, b, c)
  const dc = cross(a, b, d)
  return ((ab > 0 && ba < 0) || (ab < 0 && ba > 0)) && ((cd > 0 && dc < 0) || (cd < 0 && dc > 0))
}

function segmentDistance(a: ErasePoint, b: ErasePoint, c: ErasePoint, d: ErasePoint): number {
  if (segmentsIntersect(a, b, c, d)) return 0
  return Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d), pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b))
}

function segments(points: ErasePoint[]): Array<[ErasePoint, ErasePoint]> {
  if (points.length === 0) return []
  if (points.length === 1) return [[points[0], points[0]]]
  const pairs: Array<[ErasePoint, ErasePoint]> = []
  for (let index = 1; index < points.length; index += 1) pairs.push([points[index - 1], points[index]])
  return pairs
}

function hitsPolyline(path: ErasePoint[], points: ErasePoint[], radius: number): boolean {
  const eraser = segments(path)
  const target = segments(points)
  if (eraser.length === 0 || target.length === 0) return false
  return eraser.some(([a, b]) => target.some(([c, d]) => segmentDistance(a, b, c, d) <= radius))
}

function bounds(x: number, y: number, w: number, h: number, radius: number) {
  const left = Math.min(x, x + w) - radius
  const right = Math.max(x, x + w) + radius
  const top = Math.min(y, y + h) - radius
  const bottom = Math.max(y, y + h) + radius
  return { left, right, top, bottom }
}

function hitsRect(path: ErasePoint[], x: number, y: number, w: number, h: number, radius: number): boolean {
  const box = bounds(x, y, w, h, radius)
  const inside = (point: ErasePoint) => point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom
  const corners = [
    { x: box.left, y: box.top },
    { x: box.right, y: box.top },
    { x: box.right, y: box.bottom },
    { x: box.left, y: box.bottom },
  ]
  return segments(path).some(([a, b]) => {
    if (inside(a) || inside(b)) return true
    return corners.some((corner, index) => segmentsIntersect(a, b, corner, corners[(index + 1) % corners.length]))
  })
}

function hitsEllipse(path: ErasePoint[], shape: Shape, radius: number): boolean {
  const rx = Math.abs(shape.w / 2) + radius
  const ry = Math.abs(shape.h / 2) + radius
  const cx = shape.x + shape.w / 2
  const cy = shape.y + shape.h / 2
  if (rx === 0 || ry === 0) return hitsPolyline(path, [{ x: cx, y: cy }], radius)
  return segments(path).some(([a, b]) => {
    for (let step = 0; step <= 8; step += 1) {
      const point = { x: a.x + ((b.x - a.x) * step) / 8, y: a.y + ((b.y - a.y) * step) / 8 }
      const nx = (point.x - cx) / rx
      const ny = (point.y - cy) / ry
      if (nx * nx + ny * ny <= 1) return true
    }
    return false
  })
}

function hitsShape(path: ErasePoint[], shape: Shape, radius: number): boolean {
  if (shape.kind === 'ellipse') return hitsEllipse(path, shape, radius)
  return hitsRect(path, shape.x, shape.y, shape.w, shape.h, radius)
}

function hitsText(path: ErasePoint[], text: TextItem, radius: number): boolean {
  const width = Math.max(8, text.text.length * 8)
  return hitsRect(path, text.x, text.y, width, 16, radius)
}

/** Drop only the strokes, shapes, and text the eraser path actually touches. */
export function eraseScene<T extends ErasableScene>(scene: T, path: ErasePoint[], radius = ERASER_RADIUS): T {
  return {
    ...scene,
    strokes: scene.strokes.filter((stroke) => stroke.tool !== 'eraser' && !hitsPolyline(path, stroke.points, radius + stroke.width / 2)),
    shapes: scene.shapes.filter((shape) => !hitsShape(path, shape, radius)),
    texts: scene.texts.filter((text) => !hitsText(path, text, radius)),
  }
}
