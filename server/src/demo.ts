import type { Types } from 'mongoose'
import { Note, Project, Task, User } from './models.ts'
import { hashPassword } from './password.ts'

const DEMO_EMAIL = 'demo@align.app'

export async function seedDemo(): Promise<boolean> {
  const existing = await User.findOne({ email: DEMO_EMAIL })
  if (existing) return false

  const user = await User.create({
    name: 'Alex Rivera',
    email: DEMO_EMAIL,
    passwordHash: await hashPassword('password'),
  })

  const website = await Project.create({
    userId: user._id,
    name: 'Website refresh',
    description: 'Quiet redesign of the marketing site. Fewer pages, clearer writing.',
    status: 'active',
  })
  const launch = await Project.create({
    userId: user._id,
    name: 'October release',
    description: 'Checklist for the launch: notes, changelog, and the walkthrough.',
    status: 'active',
  })
  const archive = await Project.create({
    userId: user._id,
    name: 'Brand workshop',
    description: 'Identity exercises from last year. Kept for reference.',
    status: 'archived',
  })

  await Task.create([
    task(user._id, website._id, 'Audit the current pages', true, null, 1),
    task(user._id, website._id, 'Rewrite the homepage', true, null, 2),
    task(user._id, website._id, 'Set type and color tokens', false, '2026-10-18', 3),
    task(user._id, website._id, 'Remove unused sections', false, '2026-10-22', 4),
    task(user._id, launch._id, 'Write the changelog', false, '2026-10-16', 1),
    task(user._id, launch._id, 'Draft the launch note', false, '2026-10-17', 2),
    task(user._id, launch._id, 'Record the walkthrough', true, null, 3),
  ])

  await Note.create([
    note(user._id, website._id, 'Homepage direction', 'Lead with the product, not the company story.\n\nKeep the first screen to a single sentence and one action.'),
    note(user._id, website._id, 'Navigation notes', 'Primary nav: Product, Notes, Pricing, Sign in.'),
    note(user._id, launch._id, 'Launch tone', 'Tone: calm and specific. Say what shipped, who it helps, and what is intentionally not in this release.'),
    note(user._id, archive._id, 'Workshop summary', 'The workshop settled on a black-and-white system and a single typeface.'),
  ])

  return true
}

function task(
  userId: Types.ObjectId,
  projectId: Types.ObjectId,
  title: string,
  completed: boolean,
  dueDate: string | null,
  order: number,
) {
  return { userId, projectId, title, completed, dueDate, order }
}

function note(userId: Types.ObjectId, projectId: Types.ObjectId, title: string, body: string) {
  return { userId, projectId, title, body }
}
