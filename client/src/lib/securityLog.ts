import { forgetGet } from '../api/http.ts'
import { queryClient } from '../queryClient.ts'

const SECURITY_EVENTS = '/api/auth/security-events'

/** Drop a cached 304 body and refetch the account security log. */
export function invalidateSecurityLog(): Promise<void> {
  forgetGet(SECURITY_EVENTS)
  return queryClient.invalidateQueries({ queryKey: ['security-events'] }).then(() => undefined)
}
