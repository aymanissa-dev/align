import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eyebrow } from '../components/chrome.tsx'
import { MarketingLayout } from '../components/MarketingLayout.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

const AUDIENCES = ['makers', 'teams', 'writers', 'planners'] as const

const FEATURES = [
  {
    title: 'Projects',
    body: 'Group the work that belongs together. Archive a project when it is finished, and the tasks and notes stay with it.',
  },
  {
    title: 'Tasks',
    body: 'Break a project into tasks, give them a due date, and check them off as you go.',
  },
  {
    title: 'Notes',
    body: 'Keep the writing next to the work. A note lives on the project it belongs to.',
  },
  {
    title: 'Dashboard',
    body: 'Open Align and see your active projects and the tasks that are still open.',
  },
  {
    title: 'Search',
    body: 'Find a project, task, or note from one field, across the whole workspace.',
  },
] as const

const STEPS = [
  {
    title: 'Start a project',
    body: 'Name the work and add a short description so you know what it is for.',
  },
  {
    title: 'Add tasks and notes',
    body: 'Capture the next actions, and the context you will want when you come back.',
  },
  {
    title: 'Stay aligned',
    body: 'The dashboard shows what is active and what is still open.',
  },
] as const

export function LandingPage() {
  useDocumentTitle('Align — Keep your work in alignment.', true)

  return (
    <MarketingLayout>
      <section className="edge-mesh border-b border-neutral-200">
        <div className="mx-auto w-full max-w-6xl px-5 pt-16 pb-16 sm:px-8 sm:pt-24 sm:pb-20">
          <div className="flex flex-wrap items-center gap-2">
            {['Projects', 'Tasks', 'Notes'].map((label) => (
              <span key={label} className="border border-neutral-300 px-2 py-1 font-pixel text-[10px] tracking-[0.16em] uppercase">
                {label}
              </span>
            ))}
          </div>
          <p className="mt-8 flex flex-wrap items-center gap-2 text-sm text-neutral-600">
            <span>Built for</span>
            <AudienceWord />
          </p>
          <h1 className="mt-4 max-w-4xl text-5xl font-medium tracking-[-0.05em] text-balance text-neutral-950 sm:text-6xl lg:text-7xl lg:leading-[0.92]">
            Keep your work in alignment.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-neutral-600">
            Simple project management, thoughtfully organized.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/register" className={buttonClass('primary', 'px-4 py-2.5')}>
              Get started
            </Link>
            <Link to="/login" className={buttonClass('secondary', 'px-4 py-2.5')}>
              Sign in
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="features-heading">
        <Eyebrow>Workspace</Eyebrow>
        <h2 id="features-heading" className="mt-3 max-w-xl text-3xl font-medium tracking-[-0.04em] sm:text-4xl">
          Everything in one quiet place
        </h2>
        <p className="mt-3 max-w-xl text-sm leading-6 text-neutral-600">
          Projects, tasks, and notes. No boards to configure and no feed to catch up on.
        </p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <li key={feature.title} className="border border-neutral-200 bg-white p-6">
              <p className="font-mono text-xs text-neutral-400 tabular-nums">0{index + 1}</p>
              <h3 className="mt-4 text-lg font-medium tracking-[-0.03em]">{feature.title}</h3>
              <p className="mt-2 text-sm leading-6 text-neutral-600">{feature.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="how-heading">
        <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
          <Eyebrow>How it works</Eyebrow>
          <h2 id="how-heading" className="mt-3 text-3xl font-medium tracking-[-0.04em] sm:text-4xl">
            Three steps, then the work is visible.
          </h2>
          <ol className="mt-10 grid border border-neutral-200 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="border-neutral-200 border-b p-6 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0">
                <p className="font-mono text-xs text-neutral-400 tabular-nums">0{index + 1}</p>
                <h3 className="mt-4 text-lg font-medium tracking-[-0.03em]">{step.title}</h3>
                <p className="mt-2 border-t border-dashed border-neutral-200 pt-3 text-sm leading-6 text-neutral-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="cta-heading">
        <div className="edge-mesh mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
          <div className="border border-neutral-200 bg-white px-6 py-12 sm:px-10">
            <Eyebrow>Start</Eyebrow>
            <h2 id="cta-heading" className="mt-3 max-w-xl text-3xl font-medium tracking-[-0.04em] text-balance sm:text-5xl">
              Put the work in one place.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-neutral-600">
              Create an account and start with a single project.
            </p>
            <Link to="/register" className={buttonClass('primary', 'mt-8 px-4 py-2.5')}>
              Get started
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  )
}

function AudienceWord() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (media.matches) return
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % AUDIENCES.length)
    }, 1800)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <span className="inline-flex min-w-28 justify-center border border-neutral-950 bg-white px-2 py-0.5 text-sm font-medium text-neutral-950">
      {AUDIENCES[index]}
    </span>
  )
}
