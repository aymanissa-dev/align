import { Router } from 'express'
import { assertRole, currentTenant } from '../data/tenant.ts'
import {
  addMember,
  changeMemberRole,
  createSharedWorkspace,
  listWorkspaces,
  removeMember,
} from '../data/workspaces.ts'
import { asyncHandler, requireAuth } from '../middleware.ts'
import { memberRoleSchema, memberSchema, parseBody, workspaceCreateSchema } from '../validate.ts'

export function workspacesRouter(): Router {
  const router = Router()
  router.use(requireAuth)

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      res.json(await listWorkspaces(currentTenant(req).userId))
    }),
  )

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const input = parseBody(workspaceCreateSchema, req.body)
      const workspace = await createSharedWorkspace(currentTenant(req).userId, input.name)
      res.status(201).json(workspace)
    }),
  )

  router.post(
    '/members',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      assertRole(tenant, 'admin')
      const input = parseBody(memberSchema, req.body)
      res.status(201).json(await addMember(tenant, input.email, input.role))
    }),
  )

  router.patch(
    '/members/:userId',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      assertRole(tenant, 'admin')
      const input = parseBody(memberRoleSchema, req.body)
      res.json(await changeMemberRole(tenant, req.params.userId, input.role))
    }),
  )

  router.delete(
    '/members/:userId',
    asyncHandler(async (req, res) => {
      const tenant = currentTenant(req)
      assertRole(tenant, 'admin')
      await removeMember(tenant, req.params.userId)
      res.status(204).send()
    }),
  )

  return router
}
