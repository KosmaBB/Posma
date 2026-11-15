import type { ButtonHTMLAttributes, ReactNode } from 'react'

/** The red printed stripe every j-card carries — the one printed colour in this world. */
export function Band({ children }: { children?: ReactNode }) {
  return (
    <div className="ks-band">
      <b>POSMA C-90</b>
      <i>Type I · Normal</i>
      {children}
      <span className="ks-band__stripes" aria-hidden="true">
        <s />
        <s />
        <s />
      </span>
    </div>
  )
}

/** "A | B" box printed on each side of the inner fold; the current side is filled. */
export function SideBox({ side }: { side: 'A' | 'B' }) {
  return (
    <span className="ks-ab" aria-hidden="true">
      <b className={side === 'A' ? 'on' : undefined}>A</b>
      <b className={side === 'B' ? 'on' : undefined}>B</b>
    </span>
  )
}

/** A ballpoint underline under a hand-lettered heading. */
export function Underline() {
  return (
    <svg className="ks-uline" viewBox="0 0 200 8" preserveAspectRatio="none" aria-hidden="true">
      <path d="M1 5.2 C 40 3.4, 90 6.4, 140 4.1 S 190 4.6, 199 3.2" />
    </svg>
  )
}

export type KeyIcon = 'play' | 'flip' | 'eject' | 'rescan' | 'stop'

const GLYPHS: Record<KeyIcon, ReactNode> = {
  play: <path className="fill" d="M5.5 3.5v13l10.5-6.5z" />,
  flip: <path className="line" d="M3 7.5h12.5l-3-3M17 12.5H4.5l3 3" />,
  eject: (
    <>
      <path className="fill" d="M10 3.5l6.5 7.5h-13z" />
      <rect className="fill" x="3.5" y="13.5" width="13" height="2.6" />
    </>
  ),
  rescan: <path className="line" d="M15.6 10.2a5.6 5.6 0 1 1-1.7-4.4M15.8 3.4v3.4h-3.4" />,
  stop: <rect className="fill" x="5" y="5" width="10" height="10" />,
}

/** Drawn key glyphs, one stroke weight; never a Unicode stand-in. */
export function Glyph({ icon }: { icon: KeyIcon }) {
  return (
    <svg className="ks-glyph" viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      {GLYPHS[icon]}
    </svg>
  )
}

interface KeyProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: KeyIcon
  label: string
  sub?: string
  primary?: boolean
  /** The little lamp on the main key: lit while it works, steady when it has news. */
  lamp?: 'on' | 'busy'
}

/** A real button drawn as a cassette-deck piano key. */
export function Key({ icon, label, sub, primary, lamp, className, ...rest }: KeyProps) {
  return (
    <button type="button" className={`ks-key${primary ? ' ks-key--primary' : ''}${className ? ` ${className}` : ''}`} {...rest}>
      <Glyph icon={icon} />
      <span className="ks-key__text">
        <b>{label}</b>
        {sub && <small>{sub}</small>}
      </span>
      {lamp && <i className="ks-key__lamp" data-state={lamp} aria-hidden="true" />}
    </button>
  )
}
