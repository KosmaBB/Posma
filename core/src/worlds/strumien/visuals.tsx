/**
 * Full-bleed pictures, each drawn from the item's own numbers. They sit
 * behind the caption and carry no text a reader needs: every figure they
 * show is also written in the caption.
 */
import type { CSSProperties } from 'react'
import { HISTORY } from '../../state/machine'
import { squarify, type TreemapRect } from '../../views/modules/diskmapTreemap'

/** Ceilings the history may use; the smallest that holds the record wins. */
const SCALES = [10, 20, 50, 100]
/** The plot's box in the viewBox: newest reading at X1, the rest trailing left. */
const X1 = 860
const Y_TOP = 250
const Y_BOT = 930

const mean = (r: number[]) => r.reduce((a, b) => a + b, 0) / (r.length || 1)

export function cpuScale(samples: number[][]): number {
  const top = Math.max(0, ...samples.flat())
  return SCALES.find((s) => s >= top * 1.15) ?? 100
}

/** The processor's recent history: every core faint, the busiest dashed, the mean bold, watched cores solid. */
export function CpuField({ samples, watched }: { samples: number[][]; watched: number[] }) {
  if (samples.length < 2) return <div className="sm-cpu sm-cpu--wait" />
  const ceiling = cpuScale(samples)
  // Until the record is full it spans the whole width, so a fresh window is not a sliver at the right edge.
  const step = X1 / (Math.min(samples.length, HISTORY) - 1)
  const x = (t: number) => X1 - (samples.length - 1 - t) * step
  const y = (v: number) => Y_BOT - ((Y_BOT - Y_TOP) * Math.min(v, ceiling)) / ceiling
  const line = (vals: number[]) => vals.map((v, t) => `${x(t).toFixed(1)},${y(v).toFixed(1)}`).join(' ')
  const cores = samples[samples.length - 1].length
  const series = (c: number) => samples.map((s) => s[c] ?? 0)
  const means = samples.map(mean)
  const peaks = samples.map((s) => Math.max(...s))
  const grid = [0.25, 0.5, 0.75, 1].map((f) => f * ceiling)

  return (
    <div className="sm-cpu">
      <svg viewBox="0 0 1000 1000" preserveAspectRatio="none">
        {grid.map((g) => (
          <line key={g} className="sm-cpu__grid" x1="0" x2={X1} y1={y(g)} y2={y(g)} />
        ))}
        {Array.from({ length: cores }, (_, c) => (
          <polyline key={c} className="sm-cpu__core" points={line(series(c))} />
        ))}
        <polygon className="sm-cpu__area" points={`${x(0)},${Y_BOT} ${line(means)} ${X1},${Y_BOT}`} />
        <polyline className="sm-cpu__peak" points={line(peaks)} />
        {watched
          .filter((c) => c < cores)
          .map((c) => (
            <polyline key={`w${c}`} className="sm-cpu__watch" points={line(series(c))} />
          ))}
        <polyline className="sm-cpu__mean" points={line(means)} />
        <line className="sm-cpu__now" x1={X1} x2={X1} y1={Y_TOP - 20} y2={Y_BOT} />
      </svg>
      {grid.map((g) => (
        <span key={g} className="sm-cpu__label" style={{ top: `${y(g) / 10}%` }}>
          {g} %
        </span>
      ))}
    </div>
  )
}

export interface Tile {
  key: string
  size: number
  label: string
  sub?: string
  hot?: boolean
  quiet?: boolean
}

/** The field's box: the item's own proportions, so tiles come out square on screen. */
const FIELD_W = 1600
const FIELD_H = 860
/** Below this many pixels a tile keeps its colour but drops its words. */
const LABEL_MIN_W = 150
const LABEL_MIN_H = 64
/** The caption owns the lower left; a tile starting there stays wordless (the caption names the sources). */
const underCaption = (r: TreemapRect<Tile>) => r.x < FIELD_W * 0.55 && r.y > FIELD_H * 0.38

/** Bytes as area: each tile is one source, the hot one lit, the rest quiet. */
export function SquareField({ tiles }: { tiles: Tile[] }) {
  const sized = tiles.filter((t) => t.size > 0).sort((a, b) => b.size - a.size)
  const rects: TreemapRect<Tile>[] = []
  squarify(sized, 0, 0, FIELD_W, FIELD_H, rects)
  return (
    <div className="sm-tiles">
      {rects.map((r) => (
        <div
          key={r.item.key}
          className="sm-tile"
          data-hot={r.item.hot || undefined}
          data-quiet={r.item.quiet || undefined}
          data-top={r.y === 0 || undefined}
          data-left={r.x === 0 || undefined}
          style={{
            left: `${(r.x / FIELD_W) * 100}%`,
            top: `${(r.y / FIELD_H) * 100}%`,
            width: `${(r.w / FIELD_W) * 100}%`,
            height: `${(r.h / FIELD_H) * 100}%`,
          }}
        >
          {r.w >= LABEL_MIN_W && r.h >= LABEL_MIN_H && !underCaption(r) && (
            <span className="sm-tile__label">
              {r.item.label}
              {r.item.sub && <span>{r.item.sub}</span>}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** A volume filling from the floor up, with a rule every tenth. */
export function FillField({ pct }: { pct: number }) {
  return (
    <div className="sm-fill">
      <div className="sm-fill__level" style={{ height: `${Math.min(100, Math.max(0, pct))}%` }} />
      {Array.from({ length: 9 }, (_, i) => (
        <i key={i} style={{ bottom: `${(i + 1) * 10}%` }} />
      ))}
    </div>
  )
}

const WAFFLE_COLS = 25
const WAFFLE_ROWS = 8

/** Two hundred cells, one per half percent, lit from the bottom row up. */
export function Waffle({ pct }: { pct: number }) {
  const total = WAFFLE_COLS * WAFFLE_ROWS
  const lit = Math.round((Math.min(100, Math.max(0, pct)) / 100) * total)
  return (
    <div className="sm-waffle" style={{ '--cols': WAFFLE_COLS } as CSSProperties}>
      {Array.from({ length: total }, (_, k) => {
        const row = Math.floor(k / WAFFLE_COLS)
        const fromBottom = (WAFFLE_ROWS - 1 - row) * WAFFLE_COLS + (k % WAFFLE_COLS)
        return <i key={k} data-on={fromBottom < lit || undefined} />
      })}
    </div>
  )
}

/** Small, stable noise from a string: the same module always draws the same field. */
function seeded(text: string): () => number {
  let s = [...text].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, 7) || 7
  return () => (s = (s * 16807) % 2147483647) / 2147483647
}

const PATTERN_COLS = 32
const PATTERN_ROWS = 17

/**
 * A module's field: a grid of squares whose share of lit cells is its risk,
 * so a careful module reads quieter than a critical one at a glance.
 */
export function PatternField({ seed, density }: { seed: string; density: number }) {
  const rnd = seeded(seed)
  const cells = Array.from({ length: PATTERN_COLS * PATTERN_ROWS }, (_, i) => {
    const r = rnd()
    return { i, on: r < density, strong: r < density * 0.18 }
  })
  return (
    <svg className="sm-pattern" viewBox={`0 0 ${PATTERN_COLS * 10} ${PATTERN_ROWS * 10}`} preserveAspectRatio="xMidYMid slice">
      {cells
        .filter((c) => c.on)
        .map((c) => (
          <rect
            key={c.i}
            x={(c.i % PATTERN_COLS) * 10 + 2}
            y={Math.floor(c.i / PATTERN_COLS) * 10 + 2}
            width="6"
            height="6"
            data-strong={c.strong || undefined}
          />
        ))}
    </svg>
  )
}

/** Vertical bands, one per shortcut, each in its folder's field. */
export function StripeField({ fields }: { fields: string[] }) {
  return (
    <div className="sm-stripes">
      {fields.map((f, i) => (
        <i key={i} className={`sm-field--${f}`} />
      ))}
    </div>
  )
}
