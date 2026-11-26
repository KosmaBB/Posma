import { useEffect, useId, useRef, useState } from 'react'
import { t } from '../i18n'

const AXIS_LEFT = 44
const AXIS_BOTTOM = 24
/** Room above the plot for the legend and the row of core values. */
const HEAD = 40
/** Space between the history and the core bars. */
const GUTTER = 40
/** A two-digit mono number is about this wide; narrower slots label every n-th core. */
const LABEL_WIDTH = 18
/** Ceilings the history may use. The smallest that holds the record wins. */
const SCALES = [10, 20, 50, 100]
/** Fragment Mono advance at 12px, for laying out the legend without measuring. */
const MONO_CH = 7.2

const pad = (c: number) => String(c).padStart(2, '0')
const mean = (r: number[]) => r.reduce((a, b) => a + b, 0) / (r.length || 1)
const pct = (v: number) => `${Math.round(v)}%`

interface CpuProfileProps {
  /** Readings, oldest first; each holds the load of every core in percent. */
  samples: number[][]
  /** How many readings fit across the plot. */
  capacity: number
  /** Readings received so far, dropped ones included — each new one restarts the shift. */
  tick: number
  intervalMs: number
  /** Cores drawn on the history at all times, kept in settings. */
  watched: number[]
  onWatch: (cores: number[]) => void
}

/**
 * A curve through the readings rather than straight segments: Catmull-Rom
 * turned into cubic Béziers, so the line still passes through every value.
 */
function smooth(pts: [number, number][]): string {
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1] ?? pts[i], pts[i], pts[i + 1], pts[i + 2] ?? pts[i + 1]]
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += `C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}

function spanLabel(seconds: number): string {
  return seconds >= 120 ? t('cpu.span.min', { n: Math.round(seconds / 60) }) : t('cpu.span.sec', { n: seconds })
}

/**
 * The processor as an instrument: on the left the whole CPU over the record
 * (mean of every core, and the busiest core at each reading) on a scale that
 * follows the load and says so on its axis; on the right every core now, as
 * a bar from 0 to 100%. Picking a core draws its own history on the left.
 */
export function CpuProfile({ samples, capacity, tick, intervalMs, watched, onWatch }: CpuProfileProps) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [lit, setLit] = useState<number | null>(null)
  /** The reading under the pointer, counted back from the newest (0). */
  const [age, setAge] = useState<number | null>(null)
  /** Spoken only when the keyboard moves the selection, not on every reading. */
  const [said, setSaid] = useState('')
  const clipId = useId()

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const latest = samples[samples.length - 1] ?? []
  const cores = latest.length
  const { w, h } = size
  const top = HEAD
  const bottom = h - AXIS_BOTTOM

  // ---- the core bars, right
  const barsW = Math.round(Math.min(w * 0.36, Math.max(160, cores * LABEL_WIDTH)))
  const barsLeft = w - barsW
  const slot = barsW / Math.max(1, cores)
  const barW = Math.min(12, Math.max(2, slot * 0.5))
  const labelEvery = Math.max(1, Math.ceil(LABEL_WIDTH / slot))
  const valuesFit = slot >= LABEL_WIDTH
  const barX = (c: number) => barsLeft + c * slot + slot / 2
  // A settings file from a machine with more cores may name cores this one lacks.
  const watching = watched.filter((c) => c < cores)
  const marked = lit !== null && !watching.includes(lit) ? [...watching, lit] : watching
  // Thinned core numbers make way for the watched and picked ones instead of touching them.
  const crowded = (c: number) => marked.some((m) => m !== c && Math.abs(c - m) < labelEvery)

  // ---- the history, left
  const left = AXIS_LEFT
  const right = barsLeft - GUTTER
  const means = samples.map(mean)
  const peaks = samples.map((s) => Math.max(0, ...s))
  // The ceiling follows the record, so a calm minute still has a shape;
  // it is printed on the axis, so a calm minute never passes for a busy one.
  const ceiling = SCALES.find((v) => v >= Math.max(...peaks) * 1.05) ?? 100
  // Until the record fills, the readings in hand spread over the whole
  // width: at a slow refresh rate a full record takes minutes, and a plot
  // that is a sliver at the right edge for that long reads as broken.
  const slots = Math.max(1, Math.min(capacity, samples.length) - 1)
  const full = samples.length >= capacity
  const step = (right - left) / slots
  const x = (i: number) => right - (samples.length - 1 - i) * step
  const y = (v: number) => bottom - (Math.min(Math.max(v, 0), ceiling) / ceiling) * (bottom - top)
  const trace = (values: number[]) => smooth(values.map((v, i) => [x(i), y(v)]))
  const span = spanLabel(Math.round((slots * intervalMs) / 1000))

  const nowMean = means[means.length - 1] ?? 0
  const nowPeak = peaks[peaks.length - 1] ?? 0
  // The legend reports the reading under the pointer, or the newest one.
  const at = age !== null && age < samples.length ? samples.length - 1 - age : samples.length - 1
  const ago = Math.round(((samples.length - 1 - at) * intervalMs) / 1000)
  const legend: { cls: string; text: string }[] = [
    { cls: 'cpu-mean', text: t('cpu.mean', { pct: pct(means[at] ?? 0) }) },
    { cls: 'cpu-peak', text: t('cpu.peak', { pct: pct(peaks[at] ?? 0) }) },
  ]
  // The picked core takes the bars' heading, so the legend never runs into it at narrow widths.
  const heading = lit !== null ? t('cpu.core', { core: pad(lit), pct: pct(samples[at]?.[lit] ?? 0) }) : t('cpu.heading')
  const headingX = w - heading.length * MONO_CH
  let legendX = left
  // Hit areas instead of pointer arithmetic: the interface is scaled with
  // CSS zoom, under which clientX and getBoundingClientRect disagree in
  // some engines. The browser's own hit-testing is right at any zoom.
  const readings = Math.min(capacity, samples.length)
  const cursorX = age !== null ? x(at) : null

  function select(c: number) {
    setLit(c)
    setSaid(t('cpu.core', { core: pad(c), pct: pct(latest[c]) }))
  }

  function toggle(c: number) {
    const on = watching.includes(c)
    onWatch(on ? watched.filter((m) => m !== c) : [...watched, c].sort((a, b) => a - b))
    setSaid(t(on ? 'cpu.watch.off' : 'cpu.watch.on', { core: pad(c) }))
  }

  function onKey(e: React.KeyboardEvent<SVGSVGElement>) {
    if ((e.key === 'Enter' || e.key === ' ') && lit !== null) {
      e.preventDefault()
      toggle(lit)
      return
    }
    const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
    if (!back && e.key !== 'ArrowRight' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const from = lit ?? (back ? cores : -1)
    select(Math.min(cores - 1, Math.max(0, from + (back ? -1 : 1))))
  }

  return (
    <div className="cpu-box" ref={boxRef}>
      {w > 0 && cores > 0 && (
        <svg
          className="cpu"
          width={w}
          height={h}
          role="img"
          tabIndex={0}
          aria-label={t('cpu.aria', {
            span,
            mean: pct(nowMean),
            peak: pct(nowPeak),
            watching: watching.length ? t('cpu.aria.watching', { list: watching.map(pad).join(', ') }) : '',
          })}
          onMouseLeave={() => {
            setLit(null)
            setAge(null)
          }}
          onKeyDown={onKey}
          onFocus={() => select(lit ?? Math.max(0, latest.indexOf(Math.max(...latest))))}
          onBlur={() => setLit(null)}
        >
          {[0, ceiling / 2, ceiling].map((v) => (
            <g key={v}>
              <line className="cpu-grid" x1={left} x2={right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={left - 8} y={y(v) + 4} textAnchor="end">
                {v ? `${v}%` : '0'}
              </text>
            </g>
          ))}

          <clipPath id={clipId}>
            <rect x={left} y={0} width={right - left} height={h} />
          </clipPath>
          <g clipPath={`url(#${clipId})`}>
            {/* The shift only once the record is full; while it fills, the spacing itself changes each reading. */}
            <g key={tick} className="record" style={{ '--dx': full ? `${step}px` : '0px', '--dur': `${intervalMs}ms` } as React.CSSProperties}>
              <path className="cpu-peak" d={trace(peaks)} />
              <path className="cpu-mean" d={trace(means)} />
              {watching.map((c) => (
                <path key={c} className="cpu-watch" d={trace(samples.map((s) => s[c] ?? 0))} />
              ))}
              {lit !== null && <path className="cpu-core" d={trace(samples.map((s) => s[lit] ?? 0))} />}
              {cursorX !== null && (
                // Inside the record, so the marks slide with the lines they sit on.
                <g>
                  <line className="cpu-cursor" x1={cursorX} x2={cursorX} y1={top} y2={bottom} />
                  <rect className="cpu-mark cpu-mark--peak" x={cursorX - 3} y={y(peaks[at]) - 3} width={6} height={6} />
                  <rect className="cpu-mark" x={cursorX - 3} y={y(means[at]) - 3} width={6} height={6} />
                  {marked.map((c) => (
                    <rect key={c} className="cpu-mark cpu-mark--core" x={cursorX - 3} y={y(samples[at][c] ?? 0) - 3} width={6} height={6} />
                  ))}
                </g>
              )}
            </g>
          </g>

          {legend.map(({ cls, text }) => {
            const at = legendX
            legendX += 28 + text.length * MONO_CH + 22
            return (
              <g key={cls}>
                <line className={cls} x1={at} x2={at + 20} y1={9} y2={9} />
                <text className={`axis${cls === 'cpu-mean' ? ' ink' : ''}`} x={at + 28} y={13}>
                  {text}
                </text>
              </g>
            )
          })}
          {/* Each watched line is named at its newest end, in the gutter; tags push apart rather than overlap. */}
          {watching
            .map((c) => ({ c, ty: y(latest[c]) }))
            .sort((a, b) => a.ty - b.ty)
            .reduce<{ c: number; ty: number }[]>(
              (placed, t) => [...placed, { c: t.c, ty: placed.length ? Math.max(t.ty, placed[placed.length - 1].ty + 13) : t.ty }],
              [],
            )
            .map(({ c, ty }) => (
              <text key={c} className="axis lit" x={right + 6} y={ty + 4}>
                {pad(c)}
              </text>
            ))}
          {/* The end labels step aside when the reading's own time would print over them. */}
          {(cursorX === null || cursorX - left > 70) && (
            <text className="axis" x={left} y={h - 6}>
              −{span}
            </text>
          )}
          {(cursorX === null || right - cursorX > 70) && (
            <text className="axis" x={right} y={h - 6} textAnchor="end">
              teraz
            </text>
          )}
          {cursorX !== null && (
            <text className="axis ink" x={Math.min(Math.max(cursorX, left + 24), right - 24)} y={h - 6} textAnchor="middle">
              {ago ? `−${spanLabel(ago)}` : t('cpu.now')}
            </text>
          )}

          {lit !== null && <line className="cpu-core" x1={headingX - 28} x2={headingX - 8} y1={9} y2={9} />}
          <text className={`axis${lit !== null ? ' lit' : ''}`} x={w} y={13} textAnchor="end">
            {heading}
          </text>
          {latest.map((v, c) => (
            <g key={c} className={`cpu-bar${c === lit ? ' lit' : ''}${watching.includes(c) ? ' watch' : ''}`}>
              {barW >= 5 && <rect className="cpu-bar-track" x={barX(c) - barW / 2} y={top} width={barW} height={bottom - top} />}
              <rect
                className="cpu-bar-fill"
                x={barX(c) - barW / 2}
                y={top}
                width={barW}
                height={bottom - top}
                style={{ transform: `scaleY(${(Math.min(Math.max(v, 0), 100) / 100).toFixed(3)})` }}
              />
              {(valuesFit || c === lit) && (
                <text className={`axis${c === lit ? ' lit' : v >= 20 ? ' ink' : ''}`} x={barX(c)} y={top - 9} textAnchor="middle">
                  {Math.round(v)}
                </text>
              )}
              {(marked.includes(c) || (c % labelEvery === 0 && !crowded(c))) && (
                <text className={`axis${marked.includes(c) ? ' lit' : ''}`} x={barX(c)} y={h - 6} textAnchor="middle">
                  {pad(c)}
                </text>
              )}
            </g>
          ))}
          {barW < 5 && <line className="cpu-grid" x1={barsLeft} x2={w} y1={bottom + 0.5} y2={bottom + 0.5} />}

          {/* Painted last, so they take the pointer. One column per reading, one per core. */}
          {Array.from({ length: readings }, (_, a) => {
            const x0 = Math.max(left, right - a * step - step / 2)
            const x1 = Math.min(right, right - a * step + step / 2)
            return (
              <rect key={`t${a}`} className="cpu-hit cpu-hit--time" x={x0} y={0} width={Math.max(0, x1 - x0)} height={h} onMouseEnter={() => setAge(a)} />
            )
          })}
          {latest.map((_, c) => (
            <rect
              key={`c${c}`}
              className="cpu-hit cpu-hit--core"
              x={barsLeft + c * slot}
              y={0}
              width={slot}
              height={h}
              onMouseEnter={() => {
                setLit(c)
                setAge(null)
              }}
              onClick={() => toggle(c)}
            />
          ))}
        </svg>
      )}
      <p className="sr-only" aria-live="polite">
        {said}
      </p>
      <ul className="sr-only">
        {latest.map((v, c) => (
          <li key={c}>
            {t('cpu.sr.core', { core: pad(c), pct: pct(v) })}
            {watching.includes(c) && t('cpu.sr.watched')}
          </li>
        ))}
      </ul>
    </div>
  )
}
