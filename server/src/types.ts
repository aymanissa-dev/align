import type { Tenant } from './data/tenant.ts'

declare global {
  namespace Express {
    interface Request {
      userId?: string
      sessionId?: string
      tenant?: Tenant
    }
  }
}
