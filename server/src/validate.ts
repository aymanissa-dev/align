import { z, type ZodType } from 'zod'
import { HttpError } from './errors.ts'

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {})
  if (!result.success) {
    throw new HttpError(400, result.error.issues[0]?.message ?? 'Invalid input.')
  }
  return result.data
}

function text(label: string, max: number) {
  return z
    .string({ required_error: `${label} is required.`, invalid_type_error: `${label} is required.` })
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} is too long.`)
}

function password(label = 'Password') {
  return z
    .string({
      required_error: `${label} must be at least 8 characters.`,
      invalid_type_error: `${label} must be at least 8 characters.`,
    })
    .min(8, `${label} must be at least 8 characters.`)
    .max(128, `${label} is too long.`)
}

const email = z
  .string({ required_error: 'Enter a valid email.', invalid_type_error: 'Enter a valid email.' })
  .trim()
  .toLowerCase()
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email.')
  .max(254, 'Enter a valid email.')

const description = z
  .string({ invalid_type_error: 'Description must be text.' })
  .trim()
  .max(2000, 'Description is too long.')

const dueDate = z.union([
  z.string({ invalid_type_error: 'Use a valid due date.' }),
  z.null(),
])

export const registerSchema = z.object({
  name: text('Name', 80),
  email,
  password: password(),
})

export const loginSchema = z.object({
  email: z
    .string({
      required_error: 'Email or password is incorrect.',
      invalid_type_error: 'Email or password is incorrect.',
    })
    .trim()
    .toLowerCase()
    .min(1, 'Email or password is incorrect.')
    .max(254, 'Email or password is incorrect.'),
  password: z
    .string({
      required_error: 'Email or password is incorrect.',
      invalid_type_error: 'Email or password is incorrect.',
    })
    .min(1, 'Email or password is incorrect.')
    .max(128, 'Email or password is incorrect.'),
})

export const profileSchema = z.object({
  name: text('Name', 80),
})

export const passwordSchema = z.object({
  currentPassword: z
    .string({
      required_error: 'Current password is incorrect.',
      invalid_type_error: 'Current password is incorrect.',
    })
    .min(1, 'Current password is incorrect.'),
  newPassword: password('New password'),
})

export const projectCreateSchema = z.object({
  name: text('Project name', 120),
  description: description.optional(),
})

export const projectPatchSchema = z.object({
  name: text('Project name', 120).optional(),
  description: description.optional(),
})

export const priorities = ['low', 'medium', 'high', 'urgent'] as const

const priority = z.enum(priorities, {
  errorMap: () => ({ message: 'Priority must be low, medium, high, or urgent.' }),
})

const labelIds = z
  .array(z.string({ invalid_type_error: 'Unknown label.' }), { invalid_type_error: 'Unknown label.' })
  .max(12, 'Too many labels.')

const labelColor = z
  .string({ required_error: 'Choose a color.', invalid_type_error: 'Choose a color.' })
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Choose a color.')

export const taskCreateSchema = z.object({
  title: text('Task title', 200),
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
})

export const taskPatchSchema = z.object({
  title: text('Task title', 200).optional(),
  completed: z.boolean({ invalid_type_error: 'Completed must be true or false.' }).optional(),
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
  order: z
    .number({ invalid_type_error: 'Order must be a number.' })
    .finite('Order must be a number.')
    .optional(),
})

export const labelCreateSchema = z.object({
  name: text('Label name', 40),
  color: labelColor,
})

export const labelPatchSchema = z.object({
  name: text('Label name', 40).optional(),
  color: labelColor.optional(),
})

export const noteCreateSchema = z.object({
  title: z
    .string({ invalid_type_error: 'Title is required.' })
    .trim()
    .max(160, 'Title is too long.')
    .optional(),
  body: z.string({ invalid_type_error: 'Note is too long.' }).max(100_000, 'Note is too long.').optional(),
})

export const notePatchSchema = z.object({
  title: text('Title', 160).optional(),
  body: z.string({ invalid_type_error: 'Note is too long.' }).max(100_000, 'Note is too long.').optional(),
})

export function normalizeDueDate(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null || value === '') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new HttpError(400, 'Use a valid due date.')
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new HttpError(400, 'Use a valid due date.')
  }
  return value
}
