import { useState, type FormEvent } from 'react'
import type { Subtask } from '../api/types.ts'
import { IconTrash } from './icons.tsx'
import { Button, CheckButton, Input } from './ui.tsx'

export function SubtaskEditor({
  subtasks,
  disabled,
  onCommit,
}: {
  subtasks: Subtask[]
  disabled?: boolean
  onCommit: (next: Subtask[]) => void
}) {
  const [draft, setDraft] = useState('')

  function commit(next: Subtask[]) {
    onCommit(next)
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    setDraft('')
    commit([...subtasks, { id: crypto.randomUUID(), text, completed: false }])
  }

  function update(id: string, text: string) {
    const nextText = text.trim()
    if (!nextText) return
    commit(subtasks.map((item) => (item.id === id ? { ...item, text: nextText } : item)))
  }

  return (
    <div className="mt-3 border border-neutral-200">
      <ul>
        {subtasks.map((item, index) => (
          <li key={item.id} className="flex items-center gap-1 border-b border-neutral-200 pr-1">
            <CheckButton
              checked={item.completed}
              disabled={disabled}
              label={item.completed ? `Mark “${item.text}” incomplete` : `Mark “${item.text}” complete`}
              onChange={() => commit(subtasks.map((row) => (row.id === item.id ? { ...row, completed: !row.completed } : row)))}
            />
            <SubtaskText item={item} disabled={disabled} onCommit={(text) => update(item.id, text)} />
            <button
              type="button"
              className="focus-ring inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-neutral-950 disabled:opacity-40"
              aria-label={`Move “${item.text}” up`}
              disabled={disabled || index === 0}
              onClick={() => {
                const next = subtasks.slice()
                const previous = next[index - 1]
                if (!previous) return
                next[index - 1] = item
                next[index] = previous
                commit(next)
              }}
            >
              <span aria-hidden className="text-xs">↑</span>
            </button>
            <button
              type="button"
              className="focus-ring inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-neutral-950 disabled:opacity-40"
              aria-label={`Move “${item.text}” down`}
              disabled={disabled || index === subtasks.length - 1}
              onClick={() => {
                const next = subtasks.slice()
                const following = next[index + 1]
                if (!following) return
                next[index + 1] = item
                next[index] = following
                commit(next)
              }}
            >
              <span aria-hidden className="text-xs">↓</span>
            </button>
            <button
              type="button"
              className="focus-ring inline-flex h-11 w-11 items-center justify-center text-neutral-400 hover:text-neutral-950"
              aria-label={`Delete “${item.text}”`}
              disabled={disabled}
              onClick={() => commit(subtasks.filter((row) => row.id !== item.id))}
            >
              <IconTrash />
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="flex gap-2 p-2">
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a checklist item"
          aria-label="Checklist item"
          disabled={disabled}
          maxLength={200}
        />
        <Button type="submit" variant="secondary" disabled={disabled || !draft.trim()}>
          Add
        </Button>
      </form>
    </div>
  )
}

function SubtaskText({
  item,
  disabled,
  onCommit,
}: {
  item: Subtask
  disabled?: boolean
  onCommit: (text: string) => void
}) {
  const [value, setValue] = useState(item.text)
  const [synced, setSynced] = useState(item.text)
  if (item.text !== synced && value === synced) {
    setSynced(item.text)
    setValue(item.text)
  }

  return (
    <input
      value={value}
      disabled={disabled}
      aria-label={`Checklist item “${item.text}”`}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => {
        if (value.trim() && value.trim() !== item.text) onCommit(value)
        else setValue(item.text)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          event.currentTarget.blur()
        }
      }}
      className="focus-ring min-w-0 flex-1 border border-transparent bg-transparent px-1 py-2 text-sm text-neutral-950 disabled:text-neutral-400"
    />
  )
}
