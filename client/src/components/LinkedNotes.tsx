import { Link } from 'react-router-dom'

type NoteLink = {
  id: string
  title: string
  taskIds?: string[] | null
}

export function LinkedNoteChips({ notes, taskId }: { notes: NoteLink[] | undefined; taskId: string }) {
  const linked = (notes ?? []).filter((note) => Array.isArray(note.taskIds) && note.taskIds.includes(taskId))
  if (linked.length === 0) return null
  return (
    <div className="mt-2">
      <p className="font-pixel text-[10px] tracking-[0.14em] text-neutral-500 uppercase">Notes</p>
      <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Linked notes">
        {linked.map((note) => (
          <li key={note.id}>
            <Link
              to={`/notes/${note.id}`}
              className="focus-ring inline-flex min-h-11 max-w-full items-center border border-neutral-300 px-2 text-xs text-neutral-800 hover:border-neutral-950"
            >
              <span className="truncate">{note.title || 'Untitled'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
