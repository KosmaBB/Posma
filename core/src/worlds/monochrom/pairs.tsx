/**
 * Monochrom's one structure: a claim, then the interface detail that proves
 * it. Pairs alternate sides; a rail on the right lists the pairs on the page.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motionReduced } from '../../state/looks'
import { t } from '../../i18n'

/** The page's scroll container; every pair and the rail measure against it. */
const scrollRoot = () => document.querySelector<HTMLElement>('.mono-page')

interface PairProps {
  id: string
  /** Proof on the left, claim on the right. */
  flip?: boolean
  /** Proof takes the full width under the claim (long tables, module bodies). */
  stack?: boolean
  tour?: string
  proofTour?: string
  claim: ReactNode
  proof: ReactNode
}

export function Pair({ id, flip, stack, tour, proofTour, claim, proof }: PairProps) {
  const ref = useRef<HTMLElement>(null)

  // Pairs below the fold rise once as they come in; what is already on
  // screen stays put, so nothing visible ever blinks away first.
  useEffect(() => {
    const el = ref.current
    const root = scrollRoot()
    if (!el || !root || motionReduced()) return
    if (el.getBoundingClientRect().top < root.getBoundingClientRect().bottom) return
    el.dataset.rise = 'pending'
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return
        el.dataset.rise = 'in'
        io.disconnect()
      },
      { root, threshold: 0.12 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const cls = ['mono-pair', flip && 'mono-pair--pc', stack && 'mono-pair--stack'].filter(Boolean).join(' ')
  return (
    <section ref={ref} id={id} className={cls} data-tour={tour}>
      <div className="mono-claim">{claim}</div>
      <figure className="mono-proof" data-tour={proofTour}>
        {proof}
      </figure>
    </section>
  )
}

/** A framed piece of interface inside a proof: title, a quiet note, content. */
export function Shot({ title, note, children, foot }: { title: ReactNode; note?: ReactNode; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="mono-shot">
      <div className="mono-shot__head">
        <h3>{title}</h3>
        {note && <span>{note}</span>}
      </div>
      {children}
      {foot && <div className="mono-shot__foot">{foot}</div>}
    </div>
  )
}

export interface RailItem {
  id: string
  label: string
}

/** The pairs on this page as a rail of dots; the one in the reading band is marked. */
export function PairRail({ items }: { items: RailItem[] }) {
  const [current, setCurrent] = useState(items[0]?.id)
  const key = items.map((i) => i.id).join('|')

  useEffect(() => {
    const root = scrollRoot()
    if (!root) return
    const ids = key.split('|')
    let frame = 0
    // The current pair is the last one whose top has passed a third of the way down.
    const pick = () => {
      frame = 0
      const line = root.getBoundingClientRect().top + root.clientHeight * 0.35
      let at = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= line) at = id
      }
      // Scrolled to the end, the last pair may never reach the line.
      if (root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) at = ids[ids.length - 1]
      setCurrent(at)
    }
    const queue = () => { if (!frame) frame = requestAnimationFrame(pick) }
    // Content that loads late (a module's own view) moves the pairs without a scroll.
    const ro = new ResizeObserver(queue)
    if (root.firstElementChild) ro.observe(root.firstElementChild)
    root.addEventListener('scroll', queue, { passive: true })
    pick()
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
      root.removeEventListener('scroll', queue)
    }
  }, [key])

  if (items.length < 2) return null
  return (
    <nav className="mono-rail" aria-label={t('world.monochrom.rail.aria')}>
      <ol>
        {items.map((it) => (
          <li key={it.id}>
            <button
              type="button"
              aria-current={current === it.id ? 'true' : undefined}
              onClick={() => {
                setCurrent(it.id)
                document.getElementById(it.id)?.scrollIntoView({ behavior: motionReduced() ? 'auto' : 'smooth', block: 'start' })
              }}
            >
              {it.label}
            </button>
          </li>
        ))}
      </ol>
    </nav>
  )
}
