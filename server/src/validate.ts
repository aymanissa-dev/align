import type { ZodType } from 'zod'
import { HttpError } from './errors.ts'

export {
  emailChangeSchema,
  emptyScene,
  labelCreateSchema,
  labelPatchSchema,
  loginSchema,
  noteCreateSchema,
  notePatchSchema,
  passkeyResetSchema,
  passwordSchema,
  priorities,
  profileSchema,
  projectCreateSchema,
  projectPatchSchema,
  registerSchema,
  resetSchema,
  taskCreateSchema,
  taskPatchSchema,
  memberRoleSchema,
  memberSchema,
  mfaSchema,
  sessionRenameSchema,
  stepUpSchema,
  totpCodeSchema,
  whiteboardSceneSchema,
  workspaceCreateSchema,
} from '../../shared/schemas.ts'

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? 'Invalid input.')
  }
  return result.data
}

export function normalizeDueDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Use a valid due date.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new HttpError(400, 'Use a valid due date.')
  }
  return value
}
