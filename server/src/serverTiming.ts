import type { Response } from 'express'

type Mark = { name: string; dur: number; desc?: string }

export function markTiming(res: Response, name: string, dur: number, desc?: string): void {
  const marks = (res.locals.serverTiming ??= []) as Mark[]
  const existing = marks.find((mark) => mark.name === name)
  if (existing) {
    existing.dur = dur
    if (desc !== undefined) existing.desc = desc
  } else {
    marks.push({ name, dur, desc })
  }
  res.setHeader(
    'Server-Timing',
    marks
      .map((mark) => {
        const description = mark.desc ? `;desc="${mark.desc.replace(/[^a-z0-9_.:-]/gi, '')}"` : ''
        return `${mark.name};dur=${Math.max(0, mark.dur).toFixed(1)}${description}`
      })
      .join(', '),
  )
}
