export function BootScreen() {
  return (
    <div className="flex min-h-screen bg-white" aria-busy="true" aria-label="Loading Align">
      <div className="hidden w-64 shrink-0 border-r border-neutral-200 p-4 md:block">
        <div className="h-4 w-16 animate-pulse bg-neutral-100" />
        <div className="mt-6 h-10 animate-pulse bg-neutral-100" />
        <div className="mt-4 space-y-2">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-9 animate-pulse bg-neutral-100" />
          ))}
        </div>
      </div>
      <div className="flex-1 px-5 py-8 sm:px-8">
        <div className="h-3 w-24 animate-pulse bg-neutral-100" />
        <div className="mt-3 h-8 w-48 animate-pulse bg-neutral-100" />
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse border border-neutral-200 bg-neutral-50" />
          ))}
        </div>
      </div>
    </div>
  )
}
