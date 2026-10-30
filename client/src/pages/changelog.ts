export type ChangelogEntry = {
  /** ISO date, newest entries first. */
  date: string
  title: string
  items: readonly string[]
}

export const CHANGELOG: readonly ChangelogEntry[] = [
  {
    date: '2026-10-30',
    title: 'Upcoming, and notes on tasks',
    items: [
      'Upcoming is in the sidebar again, between Today and Calendar.',
      'Link a note to tasks in the same project. Open the task to see those notes, and open a note from the task.',
      'If a linked task or note is in Trash, the link waits. It shows again when you restore it.',
    ],
  },
  {
    date: '2026-10-29',
    title: 'Checklists, boards, and a calendar',
    items: [
      'A task can hold a checklist. Check items off, edit them, and reorder them. The row shows how many are done.',
      'A task can repeat daily, weekly, or monthly. Completing it keeps that occurrence and adds the next one, due after today.',
      'Each project has a Board with Todo, Doing, and Done. Drag a card between columns. The task list is still there.',
      'Calendar shows the month of tasks that have a due date. Open a day, then open the task in its project.',
      'Press Ctrl+K or ⌘K to jump around Align, start a project, or add a task in the project you have open.',
      'Completing a repeating task shows the next one right away. Upcoming waits to load before saying nothing is due.',
    ],
  },
  {
    date: '2026-10-26',
    title: 'Changelog',
    items: [
      'A public changelog lists what changed in Align. It is linked from the footer.',
    ],
  },
  {
    date: '2026-10-22',
    title: 'Sign out',
    items: [
      'Signing out opens the sign-in page.',
      'Align stops checking the session after you leave.',
    ],
  },
  {
    date: '2026-10-21',
    title: 'Recovery without email',
    items: [
      'Align does not send email. A new account includes a recovery key, shown once. Only a hash of that key is stored.',
      'Resetting a password requires the recovery key. If an authenticator or a passkey is on, you confirm with one of those too, and they stay on after the reset.',
      'The recovery key cannot skip two-factor authentication.',
    ],
  },
  {
    date: '2026-10-20',
    title: 'Passkeys, authenticator, and Trash',
    items: [
      'Add a passkey or an authenticator app from Settings. Setting one up asks for your password again.',
      'See the devices signed in to your account, rename them, and sign the others out.',
      'Deleting a project, task, or note moves it to Trash for 30 days. Restore it, or empty Trash.',
    ],
  },
  {
    date: '2026-10-17',
    title: 'Offline edits',
    items: [
      'Edits made while you are offline wait, then sync when Align can reach the server.',
      'A newer save is not replaced by an older copy of the same item.',
      'Open tabs pick up a new version of Align instead of staying on a stale copy.',
    ],
  },
  {
    date: '2026-10-16',
    title: 'Today and the whiteboard',
    items: [
      'Today keeps the same plan through the day, and you can look ahead to tomorrow.',
      'Upcoming lists every open task that has a due date.',
      'Whiteboard text you have not saved yet stays on the board until you leave.',
    ],
  },
  {
    date: '2026-10-15',
    title: 'Planner, theme, and notifications',
    items: [
      'Today is a plan for the day, with an evening recap of what you finished.',
      'Each project has a whiteboard.',
      'Choose light, dark, or system theme. An accent color follows your account.',
      'Install Align and keep reading the workspace when you are offline.',
      'Tasks can show a due date, a priority, and a colored label.',
      'Project activity is recorded. Due dates and security events show up in a notification inbox.',
    ],
  },
  {
    date: '2026-10-14',
    title: 'The workspace',
    items: [
      'Projects, tasks, and notes live in one place.',
      'The dashboard shows what is active and still open. Search looks across all three.',
      'Create an account and come back to the same work.',
    ],
  },
]
