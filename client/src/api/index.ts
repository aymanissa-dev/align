import type { AlignApi } from './types.ts'
import { httpApi } from './http.ts'
import { mockApi } from './mock.ts'

/**
 * The only data-access import the UI should use.
 *
 * Talks to the Express API by default. Set `VITE_API=mock` (repo-root `.env`)
 * to use the localStorage mock without a database.
 */
export const api: AlignApi = import.meta.env.VITE_API === 'mock' ? mockApi : httpApi
