import { describe, expect, it } from 'vitest'
import { registerUser } from './helpers.ts'

const scene = {
  strokes: [{ id: 's1', tool: 'pen', points: [{ x: 1, y: 2 }, { x: 8, y: 9 }], color: '#171717', width: 2 }],
  shapes: [{ id: 'r1', kind: 'rect', x: 10, y: 12, w: 40, h: 20, color: '#1d4ed8' }],
  texts: [{ id: 't1', x: 20, y: 30, text: 'Launch', color: '#171717' }],
  viewport: { x: 4, y: 6, scale: 1.5 },
}

describe('whiteboard', () => {
  it('saves a scene for the project and keeps it private', async () => {
    const owner = await registerUser()
    const other = await registerUser('Grace')
    const project = await owner.agent.post('/api/projects').send({ name: 'Launch' })
    const id = project.body.id as string

    const empty = await owner.agent.get(`/api/projects/${id}/whiteboard`)
    expect(empty.body.scene.strokes).toEqual([])

    const saved = await owner.agent.put(`/api/projects/${id}/whiteboard`).send({ scene })
    expect(saved.status).toBe(200)
    expect(saved.body.scene).toMatchObject(scene)

    const again = await owner.agent.get(`/api/projects/${id}/whiteboard`)
    expect(again.body.scene.texts[0].text).toBe('Launch')
    expect((await other.agent.get(`/api/projects/${id}/whiteboard`)).status).toBe(404)
    expect((await owner.agent.put(`/api/projects/${id}/whiteboard`).send({ scene: { strokes: [] } })).status).toBe(400)
  })
})