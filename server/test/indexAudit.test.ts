import { describe, expect, it } from 'vitest'
import { auditHotQueries } from '../src/indexAudit.ts'

describe('index audit', () => {
  it('keeps hot queries on an index scan', async () => {
    expect(await auditHotQueries()).toEqual([])
  })
})