import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Eyebrow } from '../components/chrome.tsx'
import { MarketingLayout } from '../components/MarketingLayout.tsx'
import { Reveal } from '../components/Reveal.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { accountWasDeleted } from '../lib/accountDeleted.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

const AUDIENCES = ['makers', 'teams', 'writers', 'planners'] as const

const FEATURES = [
  {
    title: 'Projects',
    body: 'Hold a body of work together. Archive it when it is finished. Tasks and notes stay attached.',
  },
  {
    title: 'Tasks',
    body: 'Name the next action and give it a due date. Check it off when it is done.',
  },
  {
    title: 'Notes',
    body: 'Keep the writing on the project it belongs to, not in a separate pile.',
  },
  {
    title: 'Dashboard',
    body: 'See active projects and open tasks as soon as you open Align.',
  },
  {
    title: 'Search',
    body: 'Find a project, task, or note from one field across the workspace.',
  },
] as const

const STEPS = [
  {
    title: 'Start a project',
    body: 'Name the work and add one sentence about what it is for.',
  },
  {
    title: 'Add tasks and notes',
    body: 'Tasks are the next actions. Notes are what you will want later.',
  },
  {
    title: 'Check the dashboard',
    body: 'What is active, and what is still open, sits in one view.',
  },
] as const

export function LandingPage() {
  useDocumentTitle('Align — Keep your work in alignment.', true)
  const [deleted] = useState(() => accountWasDeleted(window.location.search))

  return (
    <MarketingLayout>
      <section className="edge-mesh border-b border-neutral-200">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 pt-12 pb-12 sm:px-8 sm:pt-16 sm:pb-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-14 lg:pt-20 lg:pb-16">
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              {['Projects', 'Tasks', 'Notes'].map((label) => (
                <span
                  key={label}
                  className="hero-chip border border-neutral-300 bg-white px-1.5 py-1 font-pixel text-[10px] tracking-[0.16em] uppercase"
                >
                  {label}
                </span>
              ))}
            </div>
            <p className="hero-line hero-delay-1 mt-5 text-sm text-neutral-600">
              <span className="sr-only">Built for makers, teams, writers, and planners.</span>
              <span aria-hidden="true" className="inline-flex flex-wrap items-center gap-2">
                <span>Built for</span>
                <AudienceWord />
              </span>
            </p>
            {deleted ? (
              <p role="status" className="mt-5 border border-neutral-200 px-3 py-2 text-sm text-neutral-800">
                Your account and all its data were deleted.
              </p>
            ) : null}
            <h1 className="hero-line hero-delay-2 mt-3 max-w-xl text-[2.75rem] leading-[0.94] font-medium tracking-[-0.05em] text-balance text-neutral-950 sm:text-6xl lg:text-[4.25rem]">
              Keep your work in alignment.
            </h1>
            <p className="hero-line hero-delay-3 mt-4 max-w-md text-base leading-7 text-neutral-600 sm:text-lg">
              Simple project management, thoughtfully organized.
            </p>
            <div className="hero-line hero-delay-4 mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
              <Link to="/register" className={buttonClass('primary', 'press px-5 py-2.5')}>
                Get started
              </Link>
              <Link to="/login" className={buttonClass('secondary', 'press px-5 py-2.5')}>
                Sign in
              </Link>
            </div>
          </div>
          <div className="preview-enter">
            <div className="preview-drift">
              <DashboardPreview />
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16" aria-labelledby="features-heading">
        <Reveal>
          <Eyebrow>Workspace</Eyebrow>
          <h2 id="features-heading" className="mt-2 max-w-xl text-3xl font-medium tracking-[-0.04em] sm:text-4xl">
            Everything in one quiet place
          </h2>
          <p className="mt-2 max-w-lg text-sm leading-6 text-neutral-600">
            Projects, tasks, and notes. No board to configure.
          </p>
        </Reveal>
        <ul className="mt-8 grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature, index) => (
            <li key={feature.title} className="h-full">
              <Reveal delay={90 + index * 70}>
                <article className="hover-lift flex h-full flex-col border border-neutral-200 bg-white p-5">
                  <p className="card-index font-mono text-xs text-neutral-400 tabular-nums">0{index + 1}</p>
                  <h3 className="mt-3 text-lg font-medium tracking-[-0.03em]">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-neutral-600">{feature.body}</p>
                </article>
              </Reveal>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="how-heading">
        <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <h2 id="how-heading" className="mt-2 max-w-xl text-3xl font-medium tracking-[-0.04em] sm:text-4xl">
              Three steps, then the work is visible.
            </h2>
          </Reveal>
          <ol className="mt-8 grid auto-rows-fr border border-neutral-200 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li
                key={step.title}
                className="flex h-full flex-col border-b border-neutral-200 last:border-b-0 md:border-r md:border-b-0 md:last:border-r-0"
              >
                <Reveal delay={80 + index * 90} className="step-cell flex h-full flex-col p-5 hover:bg-neutral-50">
                  <p className="card-index font-mono text-xs text-neutral-400 tabular-nums">0{index + 1}</p>
                  <h3 className="mt-3 text-lg font-medium tracking-[-0.03em]">{step.title}</h3>
                  <p className="mt-3 flex-1 border-t border-dashed border-neutral-200 pt-3 text-sm leading-6 text-neutral-600">
                    {step.body}
                  </p>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="cta-heading">
        <div className="edge-mesh mx-auto w-full max-w-6xl px-5 py-14 sm:px-8 sm:py-16">
          <Reveal>
            <div className="rule-draw border border-neutral-200 bg-white px-5 py-8 sm:px-8 sm:py-10">
              <Eyebrow>Start</Eyebrow>
              <h2
                id="cta-heading"
                className="mt-2 max-w-lg text-3xl font-medium tracking-[-0.045em] text-balance sm:text-4xl"
              >
                Put the work in one place.
              </h2>
              <p className="mt-3 max-w-md text-sm leading-6 text-neutral-600">
                Create an account and open your first project.
              </p>
              <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
                <Link to="/register" className={buttonClass('primary', 'press px-5 py-2.5')}>
                  Get started
                </Link>
                <Link to="/login" className={buttonClass('secondary', 'press px-5 py-2.5')}>
                  Sign in
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>
    </MarketingLayout>
  )
}

function AudienceWord() {
  const [index, setIndex] = useState(0)
  const [reduce, setReduce] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReduce(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (reduce) return
    let timer = 0
    const stop = () => window.clearInterval(timer)
    const start = () => {
      stop()
      if (document.hidden) return
      timer = window.setInterval(() => {
        setIndex((current) => (current + 1) % AUDIENCES.length)
      }, 2400)
    }
    start()
    document.addEventListener('visibilitychange', start)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', start)
    }
  }, [reduce])

  if (reduce) {
    return (
      <span className="inline-flex items-center border border-current bg-white px-2 py-1 text-sm font-medium text-neutral-950">
        {AUDIENCES.join(' · ')}
      </span>
    )
  }

  return (
    <span className="relative inline-flex h-7 min-w-28 items-center justify-center overflow-hidden border border-current bg-white px-2 text-sm font-medium text-neutral-950">
      <span key={AUDIENCES[index]} className="word-swap">
        {AUDIENCES[index]}
      </span>
    </span>
  )
}

function DashboardPreview() {
  return (
    <figure className="preview-frame min-w-0">
      <div aria-hidden="true" className="border border-neutral-200 bg-white">
        <div className="flex items-end justify-between gap-4 border-b border-neutral-200 px-4 py-3">
          <div>
            <p className="font-pixel text-[10px] tracking-[0.16em] text-neutral-500 uppercase">Workspace</p>
            <p className="mt-1 text-base font-medium tracking-[-0.03em]">Good morning, Ada</p>
          </div>
          <p className="hidden text-xs text-neutral-500 sm:block">Active projects and open tasks.</p>
        </div>
        <div className="grid grid-cols-3 divide-x divide-neutral-200 border-b border-neutral-200">
          <PreviewStat label="Active" value="2" />
          <PreviewStat label="Open" value="4" />
          <PreviewStat label="Done" value="3" />
        </div>
        <div className="grid md:grid-cols-2 md:divide-x md:divide-neutral-200">
          <div>
            <p className="border-b border-neutral-200 px-4 py-2 font-pixel text-[10px] tracking-[0.16em] text-neutral-500 uppercase">
              Active projects
            </p>
            <PreviewProject name="October release" percent={33} detail="1 of 3 tasks" delay={720} />
            <PreviewProject name="Website refresh" percent={50} detail="2 of 4 tasks" delay={880} />
          </div>
          <div className="border-t border-neutral-200 md:border-t-0">
            <p className="border-b border-neutral-200 px-4 py-2 font-pixel text-[10px] tracking-[0.16em] text-neutral-500 uppercase">
              Open tasks
            </p>
            <PreviewTask title="Write the changelog" meta="Oct 16" />
            <PreviewTask title="Draft the launch note" meta="Oct 17" />
            <PreviewTask title="Set type and color" meta="Oct 18" />
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        A preview of the Align dashboard, with active projects and open tasks.
      </figcaption>
    </figure>
  )
}

function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-3 py-3 sm:px-4">
      <p className="font-pixel text-[10px] tracking-[0.14em] text-neutral-500 uppercase">{label}</p>
      <p className="mt-1 font-mono text-xl tracking-tight tabular-nums">{value}</p>
    </div>
  )
}

function PreviewProject({
  name,
  percent,
  detail,
  delay,
}: {
  name: string
  percent: number
  detail: string
  delay: number
}) {
  return (
    <div className="border-b border-neutral-200 px-4 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{name}</p>
        <p className="font-mono text-xs text-neutral-500 tabular-nums">{percent}%</p>
      </div>
      <div className="mt-2 h-1 overflow-hidden bg-neutral-100">
        <div
          className="meter-fill h-full bg-neutral-950"
          style={{ width: `${percent}%`, animationDelay: `${delay}ms` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-neutral-500">{detail}</p>
    </div>
  )
}

function PreviewTask({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-neutral-200 px-4 py-2.5 last:border-b-0">
      <span className="h-3.5 w-3.5 shrink-0 border border-neutral-400" />
      <span className="min-w-0 flex-1 truncate text-sm">{title}</span>
      <span className="shrink-0 font-mono text-[11px] text-neutral-500">{meta}</span>
    </div>
  )
}
