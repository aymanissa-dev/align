import { describe, expect, it } from 'vitest'
import { eraseScene, type ErasableScene } from '../../shared/erase.ts'

function scene(): ErasableScene {
  return {
    strokes: [
      { id: 'keep', tool: 'pen', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }], color: '#000', width: 2 },
      { id: 'old-eraser', tool: 'eraser', points: [{ x: 0, y: 0 }, { x: 30, y: 0 }], color: '#000', width: 18 },
      { id: 'hit', tool: 'pen', points: [{ x: 200, y: 200 }, { x: 240, y: 200 }], color: '#000', width: 2 },
    ],
    shapes: [
      { id: 'far', kind: 'rect', x: 0, y: 80, w: 20, h: 20, color: '#000' },
      { id: 'near', kind: 'ellipse', x: 190, y: 190, w: 30, h: 30, color: '#000' },
    ],
    texts: [
      { id: 'far-text', x: 0, y: 140, text: 'keep', color: '#000' },
      { id: 'near-text', x: 200, y: 210, text: 'gone', color: '#000' },
    ],
    viewport: { x: 0, y: 0, scale: 1 },
  }
}

describe('eraser hit testing', () => {
  it('removes only elements under the eraser path', () => {
    const next = eraseScene(scene(), [
      { x: 200, y: 200 },
      { x: 230, y: 200 },
    ])
    expect(next.strokes.map((stroke) => stroke.id)).toEqual(['keep'])
    expect(next.shapes.map((shape) => shape.id)).toEqual(['far'])
    expect(next.texts.map((text) => text.id)).toEqual(['far-text'])
  })
})
