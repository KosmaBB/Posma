/**
 * The world's one structure: a vertical feed of complete states. Each item
 * owns the window, the next one waits a snap below with its top edge showing,
 * and the keys, the wheel and the rail all move exactly one item.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { motionReduced } from '../../state/looks'
import { Glyph, type GlyphName } from './glyphs'

export interface FeedNav {
  next: () => void
  goTo: (id: string) => void
}

export interface FeedAction {
  /** One letter; shown on the rail and pressed anywhere in the feed. */
  key: string
  label: string
  glyph: GlyphName
  run: (nav: FeedNav) => void
  primary?: boolean
  danger?: boolean
  disabled?: boolean
  count?: string
}

export interface FeedItem {
  id: string
  /** Which field colour paints the item: a folder id, or machine/mem/full/index. */
  field: string
  /** Short name shown on the item's top edge while it waits below. */
  peek: string
  source: ReactNode
  note?: ReactNode
  figure: ReactNode
  figureNote?: ReactNode
  title: ReactNode
  text?: ReactNode
  body?: ReactNode
  visual: ReactNode
  overlay?: ReactNode
  actions: FeedAction[]
  /** data-tour names: on the caption, on the overlay band, or on caption + rail together. */
  tour?: { caption?: string; overlay?: string; group?: string }
}

/** A caption paragraph cut to two lines, with "więcej" when it does not fit. */
function More({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [open, setOpen] = useState(false)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const p = ref.current
    if (p && !open) setCut(p.scrollHeight > p.clientHeight + 1)
  }, [children, open])
  return (
    <div className="sm-text">
      <p ref={ref} data-open={open || undefined}>
        {children}
      </p>
      {(cut || open) && (
        <button type="button" className="sm-more" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'mniej' : 'więcej'}
        </button>
      )}
    </div>
  )
}

export function Rail({ actions, nav }: { actions: FeedAction[]; nav: FeedNav }) {
  return (
    <div className="sm-rail" role="group" aria-label="Działania">
      {actions.map((a) => (
        <button
          key={a.key}
          type="button"
          className="sm-act"
          data-primary={a.primary || undefined}
          data-danger={a.danger || undefined}
          disabled={a.disabled}
          aria-keyshortcuts={a.key.toUpperCase()}
          onClick={() => a.run(nav)}
        >
          <span className="sm-act__g" aria-hidden="true">
            <Glyph name={a.glyph} />
          </span>
          <span className="sm-act__label">{a.label}</span>
          {a.count && <span className="sm-act__count">{a.count}</span>}
          <kbd aria-hidden="true">{a.key.toUpperCase()}</kbd>
        </button>
      ))}
    </div>
  )
}

export function Item({
  item, label, nav, state,
}: {
  item: FeedItem
  label: string
  nav: FeedNav
  state?: 'now' | 'next'
}) {
  const caption = (
    <div className="sm-caption" data-tour={item.tour?.caption}>
      <div className="sm-source">
        <i aria-hidden="true" />
        {item.source}
        {item.note && <span>{item.note}</span>}
      </div>
      <div className="sm-figure">
        {item.figure}
        {item.figureNote && <small>{item.figureNote}</small>}
      </div>
      <h2 className="sm-title">{item.title}</h2>
      {item.text && <More>{item.text}</More>}
      {item.body}
    </div>
  )
  const rail = <Rail actions={item.actions} nav={nav} />
  return (
    <section className={`sm-item sm-field--${item.field}`} aria-label={label} data-state={state}>
      <div className="sm-visual" aria-hidden="true">
        {item.visual}
      </div>
      <div className="sm-scrim" aria-hidden="true" />
      {item.overlay && (
        <div className="sm-overlay" data-tour={item.tour?.overlay}>
          {item.overlay}
        </div>
      )}
      {item.tour?.group ? (
        <div className="sm-group" data-tour={item.tour.group}>
          {caption}
          {rail}
        </div>
      ) : (
        <>
          {caption}
          {rail}
        </>
      )}
      <div className="sm-peek" aria-hidden="true">
        <Glyph name="down" />
        {item.peek}
      </div>
    </section>
  )
}

/** Wheel travel that counts as one deliberate step, and the pause before the next. */
const WHEEL_STEP = 30
const WHEEL_LOCK_MS = 450
/** Segments drawn at most; a longer feed still counts every item in words. */
const MAX_SEGMENTS = 48

export const typing = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, select, textarea, [contenteditable="true"]')

export function Feed({
  items, label, tour, paused,
}: {
  items: FeedItem[]
  label: string
  tour?: string
  /** True while the menu or the tour owns the keyboard. */
  paused: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  indexRef.current = index
  const itemsRef = useRef(items)
  itemsRef.current = items

  const go = useCallback((i: number) => {
    const el = ref.current
    const first = el?.firstElementChild as HTMLElement | null
    if (!el || !first) return
    const to = Math.min(Math.max(i, 0), itemsRef.current.length - 1)
    el.scrollTo({ top: to * first.offsetHeight, behavior: motionReduced() ? 'auto' : 'smooth' })
  }, [])

  const nav: FeedNav = {
    next: () => go(indexRef.current + 1),
    goTo: (id) => {
      const i = itemsRef.current.findIndex((it) => it.id === id)
      if (i >= 0) go(i)
    },
  }

  function onScroll() {
    const el = ref.current
    const first = el?.firstElementChild as HTMLElement | null
    if (!el || !first) return
    const i = Math.round(el.scrollTop / first.offsetHeight)
    if (i !== indexRef.current) setIndex(Math.min(i, itemsRef.current.length - 1))
  }

  // A feed that lost items (a new check) must not point past its end.
  useEffect(() => {
    if (index > items.length - 1) setIndex(Math.max(0, items.length - 1))
  }, [items.length, index])

  useEffect(() => {
    if (paused) return
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || typing(e.target)) return
      // A module's dialog owns the keyboard while it is open.
      if (document.querySelector('.modal-backdrop')) return
      const i = indexRef.current
      const step: Record<string, number> = { ArrowDown: 1, PageDown: 1, j: 1, ArrowUp: -1, PageUp: -1, k: -1 }
      if (e.key in step) {
        e.preventDefault()
        go(i + step[e.key])
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        go(e.key === 'Home' ? 0 : itemsRef.current.length - 1)
      } else {
        const action = itemsRef.current[i]?.actions.find((a) => a.key === e.key.toLowerCase() && !a.disabled)
        if (!action) return
        e.preventDefault()
        action.run(nav)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [paused, go])

  // One wheel gesture, one item: snapping alone lets a fast flick skip several.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let travel = 0
    let locked = false
    let timer = 0
    function onWheel(e: WheelEvent) {
      if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return
      e.preventDefault()
      if (locked) return
      travel += e.deltaY
      if (Math.abs(travel) < WHEEL_STEP) return
      go(indexRef.current + Math.sign(travel))
      travel = 0
      locked = true
      timer = window.setTimeout(() => (locked = false), WHEEL_LOCK_MS)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      el.removeEventListener('wheel', onWheel)
      clearTimeout(timer)
    }
  }, [go])

  const n = items.length
  return (
    <div className="sm-feed-wrap">
      <div className="sm-feed" ref={ref} onScroll={onScroll} tabIndex={-1} aria-label={label} data-tour={tour}>
        {items.map((it, i) => (
          <Item
            key={it.id}
            item={it}
            nav={nav}
            label={`${i + 1} z ${n}: ${it.peek}`}
            state={i === index ? 'now' : i === index + 1 ? 'next' : undefined}
          />
        ))}
      </div>
      <div className="sm-progress" aria-hidden="true">
        <div className="sm-segments">
          {items.slice(0, MAX_SEGMENTS).map((it, i) => (
            <i key={it.id} data-at={i === index ? 'now' : i < index ? 'done' : undefined} />
          ))}
        </div>
        <span className="sm-count">
          <b>{index + 1}</b> z {n}
        </span>
      </div>
      <nav className="sm-pos" aria-label={`Pozycja w strumieniu: ${index + 1} z ${n}`}>
        {items.slice(0, MAX_SEGMENTS).map((it, i) => (
          <button
            key={it.id}
            type="button"
            tabIndex={-1}
            aria-label={`${i + 1}: ${it.peek}`}
            data-now={i === index || undefined}
            data-field={it.field}
            onClick={() => go(i)}
          />
        ))}
      </nav>
    </div>
  )
}
