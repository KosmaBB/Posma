/**
 * Security print for the passbook pages: guilloche rosettes and wave bands,
 * a microtext rule and a blind-embossed seal. Pure decoration — every piece
 * is aria-hidden and drawn in the faint guilloche ink, never under figures.
 */
import { useId } from 'react'

interface Rosette {
  cx: number
  cy: number
  r: number
  amp: number
  lobes: number
  copies: number
}

interface Band {
  y: number
  h: number
  waves: number
  copies: number
}

const W = 800
const STEPS = 360

/** Rings whose radius wobbles with a sine; phase-shifted copies weave the rosette. */
function rosette({ cx, cy, r, amp, lobes, copies }: Rosette): string[] {
  return Array.from({ length: copies }, (_, c) => {
    const ph = ((c / copies) * Math.PI * 2) / lobes
    let d = ''
    for (let i = 0; i <= STEPS; i++) {
      const t = (i / STEPS) * Math.PI * 2
      const rr = r + amp * Math.sin(lobes * t + ph * lobes) + amp * 0.35 * Math.sin(lobes * 3 * t - ph)
      d += `${i ? 'L' : 'M'}${(cx + rr * Math.cos(t)).toFixed(1)} ${(cy + rr * Math.sin(t)).toFixed(1)}`
    }
    return d
  })
}

/** Interlaced horizontal sines across the full page width. */
function band({ y, h, waves, copies }: Band): string[] {
  return Array.from({ length: copies }, (_, c) => {
    const ph = (c / copies) * Math.PI * 2
    let d = ''
    for (let i = 0; i <= STEPS; i++) {
      const u = i / STEPS
      const py = y + h / 2 + (h / 2) * Math.sin(u * Math.PI * 2 * waves + ph) * Math.cos(u * Math.PI * 1.5 + ph / 3)
      d += `${i ? 'L' : 'M'}${(u * W).toFixed(1)} ${py.toFixed(1)}`
    }
    return d
  })
}

// Drawn once at import: the pattern never changes, only its ink does.
const PRINT = {
  left: [
    ...rosette({ cx: 660, cy: 96, r: 74, amp: 13, lobes: 9, copies: 16 }),
    ...rosette({ cx: 660, cy: 96, r: 40, amp: 8, lobes: 7, copies: 10 }),
    ...band({ y: 300, h: 30, waves: 7, copies: 9 }),
  ],
  right: [
    ...band({ y: 18, h: 26, waves: 9, copies: 8 }),
    ...rosette({ cx: 400, cy: 520, r: 210, amp: 20, lobes: 13, copies: 10 }),
  ],
}

export function Guilloche({ side }: { side: keyof typeof PRINT }) {
  return (
    <svg className={`kz-guil kz-guil--${side}`} viewBox={`0 0 ${W} 820`} preserveAspectRatio="xMidYMin slice" aria-hidden="true">
      {PRINT[side].map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  )
}

/** Reads as a fine rule; up close it resolves into words, like the microprint on a passbook. */
export function MicroRule({ text }: { text: string }) {
  return (
    <svg className="kz-micro" viewBox="0 0 1000 7" preserveAspectRatio="none" aria-hidden="true">
      <text x="0" y="5.6" textLength="1000" lengthAdjust="spacingAndGlyphs">
        {`${text} · `.repeat(6)}
      </text>
    </svg>
  )
}

/** Blind-embossed seal: a legend pressed into the stock, no ink. */
export function Seal({ label }: { label: string }) {
  const id = useId()
  return (
    <svg className="kz-seal" viewBox="0 0 92 92" aria-hidden="true">
      <defs>
        <path id={id} d="M46 46 m-34 0 a34 34 0 1 1 68 0 a34 34 0 1 1 -68 0" />
      </defs>
      {(['hi', 'lo'] as const).map((tone, i) => (
        <g key={tone} className={`kz-seal__${tone}`} transform={`translate(${i ? -0.6 : 0.8} ${i ? -0.6 : 0.8})`}>
          <text className="kz-seal__ring">
            <textPath href={`#${id}`}>POSMA · KSIĄŻECZKA · BROKER · </textPath>
          </text>
          <circle cx="46" cy="46" r="25" />
          <text className="kz-seal__no" x="46" y="51" textAnchor="middle">
            {label}
          </text>
        </g>
      ))}
    </svg>
  )
}
