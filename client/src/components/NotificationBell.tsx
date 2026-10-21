import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../api/index.ts'
import type { AppNotification } from '../api/types.ts'
import { localISODate } from '../lib/due.ts'
import { formatDate } from '../lib/format.ts'
import { cn } from '../lib/cn.ts'
import { errorMessage } from '../lib/errorMessage.ts'
import { useToast } from './toast-context.ts'
import { IconBell } from './icons.tsx'

export function NotificationBell({ className, placement = 'down' }: { className?: string; placement?: 'down' | 'up' }) {
  const today = localISODate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [panelStyle, setPanelStyle] = useState<{ top?: number; bottom?: number; left?: number; right?: number; width: number }>({ width: 320 })
  const root = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const queryKey = ['notifications', today] as const
  const inbox = useQuery({
    queryKey,
    queryFn: () => api.listNotifications(today),
    refetchInterval: 5_000,
  })

  function markRead(id?: string) {
    queryClient.setQueryData<AppNotification[]>(queryKey, (items) =>
      items?.map((item) => (id === undefined || item.id === id ? { ...item, read: true } : item)),
    )
  }

  const markOne = useMutation({
    mutationFn: (id: string) => api.markNotificationRead(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AppNotification[]>(queryKey)
      markRead(id)
      return { previous }
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
      toast(errorMessage(error))
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  })
  const markAll = useMutation({
    mutationFn: () => api.markAllNotificationsRead(today),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<AppNotification[]>(queryKey)
      markRead()
      return { previous }
    },
    onError: (error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous)
      toast(errorMessage(error))
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey }),
  })

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items = inbox.data ?? []
  const unread = items.filter((item) => !item.read).length

  function toggle() {
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect()
      setPanelStyle(
        placement === 'up'
          ? { left: 12, bottom: window.innerHeight - rect.top + 8, width: 240 }
          : { top: rect.bottom + 8, right: 12, width: Math.min(320, window.innerWidth - 24) },
      )
    }
    setOpen((value) => !value)
  }

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        className="focus-ring relative inline-flex h-11 w-11 items-center justify-center"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        onClick={toggle}
      >
        <IconBell />
        {unread > 0 ? (
          <span className="absolute top-1 right-1 inline-flex min-w-4 items-center justify-center border border-neutral-950 bg-neutral-950 px-1 font-mono text-[10px] text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Notifications"
          className="fixed z-50 border border-neutral-200 bg-white shadow-md"
          style={panelStyle}
        >
          <div className="flex items-center justify-between gap-2 border-b border-neutral-200 px-3 py-2">
            <p className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Inbox</p>
            <button
              type="button"
              className="focus-ring inline-flex min-h-11 items-center px-2 text-xs text-neutral-800 hover:text-neutral-950 disabled:opacity-40"
              disabled={unread === 0 || markAll.isPending}
              onClick={() => markAll.mutate()}
            >
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-3 py-4 text-sm text-neutral-500">No notifications.</p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {items.map((item) => (
                <li key={item.id} className="flex items-stretch border-b border-neutral-200 last:border-b-0">
                  {item.kind === 'new-device' ? (
                    <div className={cn('min-w-0 flex-1 px-3 py-3', item.read ? 'opacity-60' : '')}>
                      <p className="text-sm text-neutral-950">{item.title}</p>
                      <p className="mt-1 text-xs text-neutral-500">Security{item.projectName ? ` · ${item.projectName}` : ''}</p>
                    </div>
                  ) : (
                  <Link
                    to={`/projects/${item.projectId}`}
                    className={cn('focus-ring block min-w-0 flex-1 px-3 py-3 hover:bg-neutral-50', item.read ? 'opacity-60' : '')}
                    onClick={() => {
                      if (!item.read) markOne.mutate(item.id)
                      setOpen(false)
                    }}
                  >
                    <p className="text-sm text-neutral-950">{item.title}</p>
                    <p className="mt-1 text-xs text-neutral-500">
                      {item.dueDate === today ? 'Today' : item.kind === 'overdue' ? 'Overdue' : 'Due soon'} · {item.projectName} · {formatDate(item.dueDate)}
                    </p>
                  </Link>
                  )}
                  {item.read ? null : (
                    <button
                      type="button"
                      className="focus-ring shrink-0 px-3 text-xs text-neutral-800 hover:text-neutral-950"
                      aria-label={`Mark “${item.title}” read`}
                      onClick={() => markOne.mutate(item.id)}
                    >
                      Mark read
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
