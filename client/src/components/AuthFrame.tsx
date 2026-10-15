import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

export function AuthFrame({ title, lede, children }: { title: string; lede: string; children: ReactNode }) {
  return (
    <div className="edge-mesh flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md border border-neutral-200 bg-white p-6 sm:p-8">
        <Link to="/" className="focus-ring font-pixel text-[11px] tracking-[0.16em] text-neutral-950 uppercase">
          Align
        </Link>
        <h1 className="mt-6 text-3xl font-medium tracking-[-0.04em] text-neutral-950">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-neutral-600">{lede}</p>
        <div className="mt-8">{children}</div>
      </div>
    </div>
  )
}
