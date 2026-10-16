import type { Schema } from 'mongoose'

const SLOW_MS = 200

/** Log queries that take longer than 200ms. The timer lives on the query object. */
export function slowQueries(schema: Schema, modelName: string): void {
  const started = new WeakMap<object, number>()
  const mark = function (this: object) {
    started.set(this, Date.now())
  }
  const report = function (this: object) {
    const began = started.get(this)
    if (!began) return
    const ms = Date.now() - began
    if (ms >= SLOW_MS) console.info(JSON.stringify({ msg: 'slow-query', model: modelName, ms }))
  }
  schema.pre(/^find|^count|^update|^delete/, mark)
  schema.post(/^find|^count|^update|^delete/, report)
  schema.pre('aggregate', mark)
  schema.post('aggregate', report)
}
