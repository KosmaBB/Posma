import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import type { AppState, View } from '../../state/appState'
import { motionReduced as reducedMotion } from '../../state/looks'
import { tourSteps } from './steps'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}
interface Point {
  x: number
  y: number
}

/** Room between a target and its frame. */
const PAD = 8
/** Crop marks at the frame's corners: their length and their gap from the frame. */
const MARK = 12
const MARK_GAP = 5
const MOVE_MS = 560
/** How long the card's text takes to fade out before it changes. */
const FADE_MS = 180
const CLOSE_MS = 200
/** How long a step waits for its target after a view change: module pages load on demand. */
const WAIT_MS = 2500
const CARD_GAP = 20
const EDGE = 16

const pad2 = (n: number) => String(n).padStart(2, '0')
const sameView = (a: View, b: View) => JSON.stringify(a) === JSON.stringify(b)
const easeOut = (t: number) => 1 - Math.pow(1 - t, 4)
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function holePath({ x, y, w, h }: Rect, W: number, H: number): string {
  return `M0 0H${W}V${H}H0Z M${x} ${y}V${y + h}H${x + w}V${y}Z`
}

function cropMarks({ x, y, w, h }: Rect): string {
  const corners: [number, number, number, number][] = [
    [x, y, -1, -1],
    [x + w, y, 1, -1],
    [x, y + h, -1, 1],
    [x + w, y + h, 1, 1],
  ]
  return corners
    .map(([cx, cy, sx, sy]) => `M${cx + sx * MARK_GAP} ${cy}h${sx * MARK} M${cx} ${cy + sy * MARK_GAP}v${sy * MARK}`)
    .join(' ')
}

async function findTarget(selector: string, alive: () => boolean): Promise<Element[]> {
  const t0 = performance.now()
  while (alive() && performance.now() - t0 < WAIT_MS) {
    const found = [...document.querySelectorAll(selector)].filter((el) => el.getBoundingClientRect().width > 0)
    if (found.length) return found
    await new Promise((r) => requestAnimationFrame(r))
  }
  return []
}

/** The union of the targets, in the overlay's own pixels, padded and kept inside the window. */
function measure(els: Element[], root: HTMLElement): Rect | null {
  if (!els.length) return null
  const box = root.getBoundingClientRect()
  // The interface is scaled with CSS zoom, and engines disagree on whether
  // getBoundingClientRect reports zoomed pixels; the overlay's own box gives the ratio.
  const k = box.width / root.clientWidth || 1
  const rects = els.map((el) => el.getBoundingClientRect())
  const W = root.clientWidth
  const H = root.clientHeight
  const x = Math.max(4, (Math.min(...rects.map((r) => r.left)) - box.left) / k - PAD)
  const y = Math.max(4, (Math.min(...rects.map((r) => r.top)) - box.top) / k - PAD)
  const right = Math.min(W - 4, (Math.max(...rects.map((r) => r.right)) - box.left) / k + PAD)
  const bottom = Math.min(H - 4, (Math.max(...rects.map((r) => r.bottom)) - box.top) / k + PAD)
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) }
}

/** Below the frame, else beside it, else above, else tucked inside its lower right corner. */
function cardPosition(r: Rect | null, cw: number, ch: number, W: number, H: number): Point {
  const clampX = (x: number) => Math.min(Math.max(x, EDGE), W - cw - EDGE)
  const clampY = (y: number) => Math.min(Math.max(y, EDGE), H - ch - EDGE)
  if (!r) return { x: clampX((W - cw) / 2), y: clampY((H - ch) / 2) }
  if (r.y + r.h + CARD_GAP + ch <= H - EDGE) return { x: clampX(r.x), y: r.y + r.h + CARD_GAP }
  if (r.x + r.w + CARD_GAP + cw <= W - EDGE) return { x: r.x + r.w + CARD_GAP, y: clampY(r.y) }
  if (r.y - CARD_GAP - ch >= EDGE) return { x: clampX(r.x), y: r.y - CARD_GAP - ch }
  if (r.x - CARD_GAP - cw >= EDGE) return { x: r.x - CARD_GAP - cw, y: clampY(r.y) }
  return { x: clampX(r.x + r.w - cw - CARD_GAP), y: clampY(r.y + r.h - ch - CARD_GAP) }
}

interface TourProps {
  app: AppState
  onClose: () => void
}

/**
 * The guided tour, "Wkładka": the app dims behind a matte scrim, a hairline
 * frame with crop marks closes in on one part of the real interface, and a
 * liner-note card explains it. Between steps the frame travels to the next
 * target, across views when the step lives elsewhere.
 */
export function Tour({ app, onClose }: TourProps) {
  // Fixed at the start: a module switched on mid-tour must not renumber the steps.
  const [steps] = useState(() => tourSteps(app))
  const [index, setIndex] = useState(0)
  /** The step whose words are on the card; it trails `index` while the frame moves. */
  const [shown, setShown] = useState(0)
  const [settled, setSettled] = useState(false)
  const [closing, setClosing] = useState(false)
  const [cardAt, setCardAt] = useState<Point | null>(null)
  /** Off for the card's first placement, so it does not fly in from the corner. */
  const [glide, setGlide] = useState(false)

  const rootRef = useRef<HTMLDivElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const scrimRef = useRef<SVGPathElement>(null)
  const frameRef = useRef<SVGRectElement>(null)
  const marksRef = useRef<SVGPathElement>(null)
  const hole = useRef<Rect | null>(null)
  const targets = useRef<Element[]>([])
  const motion = useRef(0)
  const appRef = useRef(app)
  appRef.current = app
  const origin = useRef(app.view)
  const titleId = useId()
  const textId = useId()

  const paint = useCallback((r: Rect | null) => {
    const root = rootRef.current
    if (!root) return
    const W = root.clientWidth
    const H = root.clientHeight
    scrimRef.current?.setAttribute('d', r ? holePath(r, W, H) : `M0 0H${W}V${H}H0Z`)
    const frame = frameRef.current
    const marks = marksRef.current
    if (frame && marks) {
      const visibility = r ? 'visible' : 'hidden'
      frame.style.visibility = visibility
      marks.style.visibility = visibility
      if (r) {
        frame.setAttribute('x', String(r.x + 0.5))
        frame.setAttribute('y', String(r.y + 0.5))
        frame.setAttribute('width', String(Math.max(0, r.w - 1)))
        frame.setAttribute('height', String(Math.max(0, r.h - 1)))
        marks.setAttribute('d', cropMarks(r))
      }
    }
    hole.current = r
  }, [])

  /** Moves the frame; a newer move or a resize cancels this one where it stands. */
  const glideTo = useCallback(
    (to: Rect | null): Promise<void> => {
      const id = ++motion.current
      const from = hole.current
      if (!from || !to || reducedMotion()) {
        paint(to)
        return Promise.resolve()
      }
      return new Promise((done) => {
        const t0 = performance.now()
        const frame = (now: number) => {
          if (id !== motion.current) return done()
          const p = easeOut(Math.min(1, (now - t0) / MOVE_MS))
          paint({ x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, w: from.w + (to.w - from.w) * p, h: from.h + (to.h - from.h) * p })
          if (p < 1) requestAnimationFrame(frame)
          else done()
        }
        requestAnimationFrame(frame)
      })
    },
    [paint],
  )

  const place = useCallback((r: Rect | null) => {
    const root = rootRef.current
    const card = cardRef.current
    if (!root || !card) return
    setCardAt(cardPosition(r, card.offsetWidth, card.offsetHeight, root.clientWidth, root.clientHeight))
  }, [])

  // The frame opens at the window's edges, so the first step closes in on its target.
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root) return
    paint({ x: 0, y: 0, w: root.clientWidth, h: root.clientHeight })
    place(null)
    const previous = document.activeElement as HTMLElement | null
    nextRef.current?.focus({ preventScroll: true })
    requestAnimationFrame(() => setGlide(true))
    return () => previous?.focus?.({ preventScroll: true })
  }, [paint, place])

  useEffect(() => {
    let alive = true
    const step = steps[index]
    setSettled(false)
    ;(async () => {
      const a = appRef.current
      if (!sameView(a.view, step.view)) a.setView(step.view)
      const [els] = await Promise.all([findTarget(step.target, () => alive), sleep(reducedMotion() ? 0 : FADE_MS)])
      if (!alive) return
      // Last then first: as much of a group as fits, and never without its top.
      els[els.length - 1]?.scrollIntoView({ block: 'nearest' })
      els[0]?.scrollIntoView({ block: 'nearest' })
      targets.current = els
      // The new words go in before measuring, so the card is placed at its new height.
      flushSync(() => setShown(index))
      const root = rootRef.current
      const r = root ? measure(els, root) : null
      place(r)
      await glideTo(r)
      if (alive) setSettled(true)
    })()
    return () => {
      alive = false
    }
  }, [index, steps, glideTo, place])

  // A resized window or a changed zoom re-frames the same targets at once.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const ro = new ResizeObserver(() => {
      if (!hole.current) return
      motion.current++
      const r = measure(targets.current, root)
      paint(r)
      place(r)
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [paint, place])

  const finish = useCallback(() => {
    if (closing) return
    setClosing(true)
    setTimeout(
      () => {
        appRef.current.setView(origin.current)
        onClose()
      },
      reducedMotion() ? 0 : CLOSE_MS,
    )
  }, [closing, onClose])

  const go = useCallback(
    (delta: number) => {
      if (index + delta >= steps.length) return finish()
      setIndex(Math.max(0, index + delta))
    },
    [index, steps.length, finish],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const keys: Record<string, () => void> = {
        Escape: finish,
        ArrowRight: () => go(1),
        ArrowDown: () => go(1),
        ArrowLeft: () => go(-1),
        ArrowUp: () => go(-1),
      }
      if (keys[e.key]) {
        e.preventDefault()
        e.stopPropagation()
        keys[e.key]()
        return
      }
      if (e.key !== 'Tab') return
      // Focus stays on the card: the app behind it is not reachable during the tour.
      const focusable = [...(cardRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? [])]
      if (!focusable.length) return
      const at = focusable.indexOf(document.activeElement as HTMLElement)
      const next = focusable[(at + (e.shiftKey ? -1 : 1) + focusable.length) % focusable.length]
      e.preventDefault()
      next.focus()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, finish])

  const step = steps[shown]
  const last = index === steps.length - 1

  return createPortal(
    <div
      className={`tour${closing ? ' closing' : ''}`}
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={textId}
    >
      <svg className="tour-art" aria-hidden="true">
        <path className="tour-scrim" ref={scrimRef} />
        <rect className="tour-frame" ref={frameRef} />
        <path className="tour-marks" ref={marksRef} />
      </svg>

      <div
        className={`tour-card${glide ? ' glide' : ''}`}
        ref={cardRef}
        style={cardAt ? { transform: `translate(${cardAt.x}px, ${cardAt.y}px)` } : { visibility: 'hidden' }}
      >
        <div className="tour-card__head">
          <span className="tour-card__no">
            {pad2(shown + 1)} / {pad2(steps.length)}
          </span>
          <span className="lbl">{step.chapter}</span>
        </div>
        <div className={`tour-card__body${settled ? '' : ' out'}`} aria-live="polite">
          <h2 id={titleId}>{step.title}</h2>
          <p id={textId}>{step.text}</p>
        </div>
        <div className="tour-card__foot">
          <div className="tour-ticks" aria-hidden="true">
            {steps.map((_, i) => (
              <i key={i} className={i < shown ? 'done' : i === shown ? 'now' : ''} />
            ))}
          </div>
          <div className="tour-card__btns">
            <button className="btn btn-ghost btn-mini" onClick={() => go(-1)} disabled={index === 0}>
              Wstecz
            </button>
            <button className="btn btn-primary btn-mini" ref={nextRef} onClick={() => go(1)}>
              {last ? 'Zakończ' : 'Dalej'}
            </button>
          </div>
        </div>
        <div className="tour-card__keys">
          <span>Strzałki przełączają kroki, Esc kończy</span>
          {!last && (
            <button className="tour-skip" onClick={finish}>
              Zamknij samouczek
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
