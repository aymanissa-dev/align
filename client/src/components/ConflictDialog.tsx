import { Button, Modal } from './ui.tsx'

export function ConflictDialog({
  open,
  pending = false,
  onReload,
  onOverwrite,
  onClose,
}: {
  open: boolean
  pending?: boolean
  onReload: () => void
  onOverwrite: () => void
  onClose: () => void
}) {
  return (
    <Modal open={open} title="This was changed elsewhere" onClose={pending ? () => undefined : onClose}>
      <p className="text-sm leading-6 text-neutral-600">
        This was changed elsewhere. Reload to see the latest version, or overwrite it with the fields you changed.
      </p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onReload} disabled={pending}>
          Reload
        </Button>
        <Button onClick={onOverwrite} disabled={pending}>
          Overwrite
        </Button>
      </div>
    </Modal>
  )
}
