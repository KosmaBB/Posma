import { Icon } from '../../components/Icons'

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  viewBox: '0 0 24 24',
} as const

/** The few rail glyphs the shared icon set has no drawing for, in its stroke and grid. */
const OWN = {
  down: <path d="M12 4v15M6 13l6 6 6-6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6" />,
  open: <path d="M7 17 17 7M9 7h8v8" />,
  memory: (
    <>
      <rect x="4" y="7" width="16" height="10" rx="1.5" />
      <path d="M8 7v10M12 7v10M16 7v10M6 17v3M18 17v3" />
    </>
  ),
}

export type GlyphName = keyof typeof OWN | 'search' | 'clock' | 'diskmap' | 'pulse' | 'manager' | 'files' | 'check'

export function Glyph({ name }: { name: GlyphName }) {
  if (name in OWN) return <svg {...stroke}>{OWN[name as keyof typeof OWN]}</svg>
  return <Icon name={name} />
}
