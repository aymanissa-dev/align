/**
 * The only data-access import the UI should use.
 *
 * Swap this line for the fetch client when the API is available:
 *   export { httpApi as api } from './http.ts'
 */
export { mockApi as api } from './mock.ts'
