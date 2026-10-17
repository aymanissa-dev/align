import { z } from 'zod'
import { isMediumPassword, MEDIUM_PASSWORD_MESSAGE } from './passwordPolicy.ts'

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
      required_error: MEDIUM_PASSWORD_MESSAGE,
      invalid_type_error: MEDIUM_PASSWORD_MESSAGE,
    })
    .max(128, `${label} is too long.`)
    .refine((value) => isMediumPassword(value), MEDIUM_PASSWORD_MESSAGE)
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

const dueDate = z.union([z.string({ invalid_type_error: 'Use a valid due date.' }), z.null()])

export const registerSchema = z.object({
  name: text('Name', 80),
  email,
  password: password(),
})

export const forgotSchema = z.object({
  email,
})

export const resetSchema = z.object({
  token: z
    .string({ required_error: 'This reset link is invalid or has expired.' })
    .trim()
    .min(20, 'This reset link is invalid or has expired.')
    .max(200, 'This reset link is invalid or has expired.'),
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

const accentColor = z
  .string({ invalid_type_error: 'Choose a color.' })
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Choose a color.')

export const profileSchema = z
  .object({
    name: text('Name', 80).optional(),
    accent: accentColor.optional(),
  })
  .refine((value) => value.name !== undefined || value.accent !== undefined, {
    message: 'Nothing to update.',
  })

export const verifySchema = z.object({
  token: z
    .string({ required_error: 'This verification link is invalid or has expired.' })
    .trim()
    .min(20, 'This verification link is invalid or has expired.')
    .max(200, 'This verification link is invalid or has expired.'),
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
  plannedFor: dueDate.optional(),
  clientId: z.string().uuid('clientId must be a uuid.').optional(),
})

export const taskPatchSchema = z.object({
  title: text('Task title', 200).optional(),
  completed: z.boolean({ invalid_type_error: 'Completed must be true or false.' }).optional(),
  dueDate: dueDate.optional(),
  priority: priority.optional(),
  labelIds: labelIds.optional(),
  plannedFor: dueDate.optional(),
  completedOn: dueDate.optional(),
  order: z.number({ invalid_type_error: 'Order must be a number.' }).finite('Order must be a number.').optional(),
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

const finite = z.number({ invalid_type_error: 'Whiteboard is invalid.' }).finite()
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Whiteboard is invalid.')
const point = z.object({ x: finite, y: finite })

export const whiteboardSceneSchema = z.object({
  strokes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        tool: z.enum(['pen', 'eraser']),
        points: z.array(point).min(1).max(1500),
        color: hex,
        width: finite.min(1).max(64),
      }),
    )
    .max(400),
  shapes: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        kind: z.enum(['rect', 'ellipse']),
        x: finite,
        y: finite,
        w: finite,
        h: finite,
        color: hex,
      }),
    )
    .max(200),
  texts: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        x: finite,
        y: finite,
        text: z.string().max(280),
        color: hex,
      }),
    )
    .max(200),
  viewport: z.object({
    x: finite,
    y: finite,
    scale: finite.min(0.2).max(4),
  }),
})

export const emptyScene = {
  strokes: [],
  shapes: [],
  texts: [],
  viewport: { x: 0, y: 0, scale: 1 },
}
