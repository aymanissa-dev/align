import { Link } from 'react-router-dom'
import { MarketingLayout } from '../components/MarketingLayout.tsx'
import { buttonClass } from '../lib/buttonClass.ts'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

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
      <section className="mx-auto grid w-full max-w-6xl items-center gap-16 px-5 pt-16 pb-20 sm:px-8 sm:pt-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] lg:gap-20 lg:pt-28 lg:pb-28">
        <div>
          <h1 className="max-w-xl text-4xl font-medium tracking-tight text-balance text-neutral-950 sm:text-5xl sm:leading-[1.1]">
            Keep your work in alignment.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-8 text-neutral-600">
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
        <WorkspacePreview />
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="features-heading">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <h2 id="features-heading" className="text-2xl font-medium tracking-tight">
            Everything in one quiet place
          </h2>
          <p className="mt-3 max-w-xl text-neutral-600">
            Projects, tasks, and notes. No boards to configure and no feed to catch up on.
          </p>
          <ul className="mt-14 grid gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li key={feature.title}>
                <h3 className="text-base font-medium">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{feature.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="how-heading">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <h2 id="how-heading" className="text-2xl font-medium tracking-tight">
            How it works
          </h2>
          <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-12">
            {STEPS.map((step, index) => (
              <li key={step.title}>
                <p className="text-sm tabular-nums text-neutral-400">0{index + 1}</p>
                <h3 className="mt-3 text-base font-medium">{step.title}</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-600">{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-neutral-200" aria-labelledby="cta-heading">
        <div className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
          <h2 id="cta-heading" className="max-w-lg text-3xl font-medium tracking-tight text-balance sm:text-4xl">
            Put the work in one place.
          </h2>
          <p className="mt-4 max-w-md text-neutral-600">Create an account and start with a single project.</p>
          <Link to="/register" className={buttonClass('primary', 'mt-8 px-4 py-2.5')}>
            Get started
          </Link>
        </div>
      </section>
    </MarketingLayout>
  )
}

function WorkspacePreview() {
  return (
    <figure>
      <div
        aria-hidden="true"
        className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_24px_60px_-36px_rgba(23,23,23,0.45)]"
      >
        <div className="flex min-h-[420px]">
          <div className="hidden w-44 shrink-0 border-r border-neutral-200 px-4 py-5 sm:block">
            <p className="text-sm font-medium">Align</p>
            <div className="mt-4 rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-400">Search</div>
            <ul className="mt-5 space-y-1 text-sm">
              <li className="rounded-md bg-neutral-100 px-2.5 py-1.5 font-medium">Dashboard</li>
              <li className="px-2.5 py-1.5 text-neutral-500">Projects</li>
              <li className="px-2.5 py-1.5 text-neutral-500">Notes</li>
              <li className="px-2.5 py-1.5 text-neutral-500">Settings</li>
            </ul>
          </div>
          <div className="min-w-0 flex-1 px-5 py-6 sm:px-7 sm:py-7">
            <p className="text-lg font-medium tracking-tight">Good morning, Ada</p>
            <p className="mt-1 text-sm text-neutral-500">Active projects and open tasks.</p>
            <p className="mt-8 text-sm font-medium">Active projects</p>
            <div className="mt-3 border-b border-neutral-100 pb-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">Website refresh</p>
                <p className="text-xs text-neutral-400 tabular-nums">64%</p>
              </div>
              <div className="mt-2 h-1 rounded-full bg-neutral-100">
                <div className="h-1 w-[64%] rounded-full bg-neutral-900" />
              </div>
            </div>
            <div className="border-b border-neutral-100 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">Client onboarding</p>
                <p className="text-xs text-neutral-400 tabular-nums">20%</p>
              </div>
              <div className="mt-2 h-1 rounded-full bg-neutral-100">
                <div className="h-1 w-[20%] rounded-full bg-neutral-900" />
              </div>
            </div>
            <p className="mt-8 text-sm font-medium">Open tasks</p>
            <ul className="mt-3 space-y-3 text-sm">
              <li className="flex items-center gap-2.5">
                <span className="h-4 w-4 rounded-full border border-neutral-300" />
                <span>Draft the homepage</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="h-4 w-4 rounded-full border border-neutral-300" />
                <span>Send the kickoff notes</span>
              </li>
              <li className="flex items-center gap-2.5 text-neutral-400">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-900 text-[10px] text-white">
                  ✓
                </span>
                <span className="line-through">Outline the project</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">
        A preview of the Align workspace, with active projects and open tasks.
      </figcaption>
    </figure>
  )
}
