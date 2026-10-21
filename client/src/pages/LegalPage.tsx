import type { ReactNode } from 'react'
import { useDocumentTitle } from '../lib/useDocumentTitle.ts'

function LegalArticle({ title, children }: { title: string; children: ReactNode }) {
  useDocumentTitle(title)
  return (
    <article className="mx-auto w-full max-w-2xl px-5 py-16 sm:px-8 sm:py-24">
      <p className="font-pixel text-[11px] tracking-[0.16em] text-neutral-500 uppercase">Legal</p>
      <h1 className="mt-3 text-4xl font-medium tracking-[-0.04em]">{title}</h1>
      <p className="mt-3 font-mono text-xs text-neutral-500">Last updated October 14, 2026.</p>
      <div className="mt-10 space-y-8 text-sm leading-7 text-neutral-700">{children}</div>
    </article>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-base font-medium text-neutral-950">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  )
}

export function PrivacyPage() {
  return (
    <LegalArticle title="Privacy">
      <p>Align stores the information you add to your workspace so you can come back to it.</p>
      <Section title="Account">
        <p>
          When you register, we store your name, email address, a hash of your password, and a hash of your account
          recovery key. The password and the recovery key themselves are not stored.
        </p>
      </Section>
      <Section title="Workspace">
        <p>
          Projects, tasks, and notes you create are stored for your account. They are not shown to other people.
        </p>
      </Section>
      <Section title="Session">
        <p>
          Signing in sets an httpOnly cookie named token. It holds a signed session that expires after seven days.
          That cookie is how Align recognizes you on later visits.
        </p>
      </Section>
      <Section title="Deletion">
        <p>
          You can delete your account from Settings. That removes the account and the projects, tasks, and notes that
          belong to it.
        </p>
      </Section>
      <Section title="Sharing">
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </Section>
    </LegalArticle>
  )
}

export function TermsPage() {
  return (
    <LegalArticle title="Terms">
      <p>Align is a workspace for projects, tasks, and notes. These terms cover your use of it.</p>
      <Section title="Your content">
        <p>
          You keep the projects, tasks, and notes you add. You are responsible for that content. Do not use Align for
          anything unlawful.
        </p>
      </Section>
      <Section title="The service">
        <p>
          Align is provided as it is available. Features can change, and the service can be interrupted. We do not
          promise that it will be free of errors.
        </p>
      </Section>
      <Section title="Accounts">
        <p>
          You need an account to use the workspace. Keep your password to yourself. An account that abuses the service
          may be closed.
        </p>
      </Section>
      <Section title="Ending">
        <p>
          You can delete your account at any time from Settings. These terms cover the time you used Align.
        </p>
      </Section>
    </LegalArticle>
  )
}
