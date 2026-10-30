import type { ReactNode } from 'react'

function Icon({ className = 'h-4 w-4', children }: { className?: string; children: ReactNode }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export function IconBell({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5L6 16z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </Icon>
  )
}

export function IconToday({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="4" y="5" width="16" height="15" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </Icon>
  )
}

export function IconUpcoming({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M5 7h8M5 12h8M5 17h5" />
      <path d="M15 12h5M17.5 9.5 20 12l-2.5 2.5" />
    </Icon>
  )
}

export function IconCalendar({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="4" y="5" width="16" height="15" />
      <path d="M4 10h16M8 3v4M16 3v4M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" />
    </Icon>
  )
}

export function IconDashboard({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="4" y="4" width="7" height="7" rx="1.25" />
      <rect x="13" y="4" width="7" height="7" rx="1.25" />
      <rect x="4" y="13" width="7" height="7" rx="1.25" />
      <rect x="13" y="13" width="7" height="7" rx="1.25" />
    </Icon>
  )
}

export function IconProjects({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 8.5h6l2 2H20v8.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19V8.5z" />
      <path d="M4 8.5V6.5A1.5 1.5 0 0 1 5.5 5H10l2 2" />
    </Icon>
  )
}

export function IconNotes({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M7 3.5h7l5 5V20.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" />
      <path d="M14 3.5V9h5" />
      <path d="M9 13h6M9 17h4" />
    </Icon>
  )
}

export function IconSettings({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M4.8 6.8l1.6 1.6M17.6 15.6l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.8 17.2l1.6-1.6M17.6 8.4l1.6-1.6" />
    </Icon>
  )
}

export function IconSearch({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16.5 20 20.5" />
    </Icon>
  )
}

export function IconMenu({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

export function IconClose({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

export function IconCheck({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M5 12.5 9.5 17 19 7.5" />
    </Icon>
  )
}

export function IconPencil({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M4 20h4l11-11-4-4L4 16v4z" />
      <path d="m13 7 4 4" />
    </Icon>
  )
}

export function IconTrash({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M5 7h14" />
      <path d="M9 7V5h6v2" />
      <path d="M7 7l1 13h8l1-13" />
    </Icon>
  )
}
