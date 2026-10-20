import type { Request } from 'express'
import { HttpError } from '../errors.ts'
import { roleAtLeast, type Role } from '../authz.ts'

export type Tenant = {
  userId: string
  workspaceId: string
  role: Role
}

export function currentTenant(req: Request): Tenant {
  if (!req.tenant) throw new HttpError(401, 'Sign in to continue.')
  return req.tenant
}

export function assertRole(tenant: Tenant, minimum: Role): void {
  if (!roleAtLeast(tenant.role, minimum)) {
    throw new HttpError(403, 'You do not have permission to change this workspace.')
  }
}
