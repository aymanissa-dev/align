import { useEffect, useRef, type ReactNode } from 'react'
import { cn } from '../lib/cn.ts'

export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const reveal = () => node.classList.add('is-in')
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (media.matches) {
      reveal()
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        reveal()
        observer.disconnect()
      },
      { threshold: 0.16, rootMargin: '0px 0px -24px 0px' },
    )
    const onChange = () => {
      if (!media.matches) return
      reveal()
      observer.disconnect()
    }
    observer.observe(node)
    media.addEventListener('change', onChange)
    return () => {
      observer.disconnect()
      media.removeEventListener('change', onChange)
    }
  }, [])

  return (
    <div ref={ref} className={cn('reveal', className)} style={delay ? { transitionDelay: `${delay}ms` } : undefined}>
      {children}
    </div>
  )
}
