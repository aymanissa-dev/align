import { Component, type ReactNode } from 'react'
import { Button } from './ui.tsx'

type State = { failed: boolean }

export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center bg-white px-6">
        <div className="w-full max-w-md border border-neutral-200 px-6 py-14 text-center">
          <p className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Align</p>
          <h1 className="mt-3 text-base font-medium text-neutral-950">Something went wrong</h1>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-neutral-500">
            This page didn’t load. Reloading usually fixes it.
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <a href="/" className="focus-ring inline-flex items-center justify-center border border-neutral-300 bg-white px-3 py-2 text-sm font-medium text-neutral-950 hover:bg-neutral-50">
              Home
            </a>
            <Button variant="secondary" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
