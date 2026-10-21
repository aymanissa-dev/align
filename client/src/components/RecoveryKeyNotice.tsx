import { Button } from './ui.tsx'

export function RecoveryKeyNotice({ recoveryKey, onSaved }: { recoveryKey: string; onSaved: () => void }) {
  function download() {
    const blob = new Blob(
      [
        `Align account recovery key\n\n${recoveryKey}\n\nAlign cannot show this key again and does not send it by email. Store it somewhere only you can open.\n`,
      ],
      { type: 'text/plain' },
    )
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'align-recovery-key.txt'
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-neutral-700">
        Save this key now. It is the only copy. You will need it to reset your password.
      </p>
      <p id="recovery-key" className="font-mono text-sm break-all text-neutral-950">
        {recoveryKey}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" onClick={download}>
          Download key
        </Button>
        <Button type="button" onClick={onSaved}>
          I've saved this key
        </Button>
      </div>
    </div>
  )
}
