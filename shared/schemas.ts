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

export const resetSchema = z.object({
  email,
  password: password('New password'),
  recoveryKey: z
    .string({ required_error: "Those details don't match.", invalid_type_error: "Those details don't match." })
    .trim()
    .min(1, "Those details don't match.")
    .max(80, "Those details don't match."),
  code: z.string().trim().max(32, "Those details don't match.").optional(),
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
export const recurrences = ['daily', 'weekly', 'monthly'] as const
export const taskStatuses = ['todo', 'doing', 'done'] as const

const priority = z.enum(priorities, {
  errorMap: () => ({ message: 'Priority must be low, medium, high, or urgent.' }),
})

const recurrence = z.union([
  z.enum(recurrences, {
    errorMap: () => ({ message: 'Repeat must be daily, weekly, or monthly.' }),
  }),
  z.null(),
])

const taskStatus = z.enum(taskStatuses, {
  errorMap: () => ({ message: 'Status must be todo, doing, or done.' }),
})

const subtaskSchema = z.object({
  id: z
    .string({ required_error: 'Checklist is invalid.', invalid_type_error: 'Checklist is invalid.' })
    .trim()
    .min(1, 'Checklist is invalid.')
    .max(40, 'Checklist is invalid.')
    .regex(/^[A-Za-z0-9_-]+$/, 'Checklist is invalid.'),
  text: z
    .string({ required_error: 'Checklist text is required.', invalid_type_error: 'Checklist text is required.' })
    .trim()
    .min(1, 'Checklist text is required.')
    .max(200, 'Checklist text is too long.'),
  completed: z.boolean({ invalid_type_error: 'Checklist is invalid.' }),
})

const subtasksSchema = z
  .array(subtaskSchema, { invalid_type_error: 'Checklist is invalid.' })
  .max(40, 'Too many checklist items.')
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    for (const item of items) {
      if (seen.has(item.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Checklist items must be unique.' })
        return
      }
      seen.add(item.id)
    }
  })

const labelIds = z
  .array(z.string({ invalid_type_error: 'Unknown label.' }), { invalid_type_error: 'Unknown label.' })
  .max(12, 'Too many labels.')

const taskLinkId = z
  .string({
    required_error: 'Link a task from this project.',
    invalid_type_error: 'Link a task from this project.',
  })
  .trim()
  .regex(/^[a-f\d]{24}$/i, 'Link a task from this project.')

const taskIdsSchema = z
  .array(taskLinkId, { invalid_type_error: 'Linked tasks are invalid.' })
  .max(40, 'Too many linked tasks.')
  .superRefine((items, ctx) => {
    const seen = new Set<string>()
    for (const item of items) {
      const key = item.toLowerCase()
      if (seen.has(key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Linked tasks must be unique.' })
        return
      }
      seen.add(key)
    }
  })

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
  recurrence: recurrence.optional(),
  status: taskStatus.optional(),
  subtasks: subtasksSchema.optional(),
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
  recurrence: recurrence.optional(),
  status: taskStatus.optional(),
  subtasks: subtasksSchema.optional(),
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
  taskIds: taskIdsSchema.optional(),
})

export const notePatchSchema = z.object({
  title: text('Title', 160).optional(),
  body: z.string({ invalid_type_error: 'Note is too long.' }).max(100_000, 'Note is too long.').optional(),
  taskIds: taskIdsSchema.optional(),
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

export const sessionRenameSchema = z.object({
  name: text('Device name', 80),
})

export const totpCodeSchema = z.object({
  code: z
    .string({ required_error: 'Enter the 6-digit code.' })
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
})

export const mfaSchema = z.object({
  code: z.string({ required_error: 'Enter a code.' }).trim().min(6, 'Enter a code.').max(32, 'Enter a code.'),
  method: z.enum(['totp', 'recovery']),
})

export const emailChangeSchema = z.object({
  email,
})

export const stepUpSchema = z.object({
  password: z.string().max(128, 'Confirm it is you to continue.').optional(),
  code: z.string().trim().max(32, 'That code is not valid.').optional(),
  method: z.enum(['password', 'totp', 'recovery']).optional(),
})

export const workspaceCreateSchema = z.object({
  name: text('Workspace name', 80),
})

export const memberSchema = z.object({
  email,
  role: z.enum(['admin', 'member', 'viewer']),
})

export const memberRoleSchema = z.object({
  role: z.enum(['admin', 'member', 'viewer']),
})

export const emptyScene = {
  strokes: [],
  shapes: [],
  texts: [],
  viewport: { x: 0, y: 0, scale: 1 },
}
