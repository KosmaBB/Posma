/**
 * Looks, and the appearance overrides a person can lay on top of one.
 *
 * A look is a whole visual world: a palette for each mode, faces, label
 * style, corners, how the CPU chart draws. Its values live in CSS under
 * [data-look]. Every override defaults to 'look' — whatever the look says —
 * and otherwise lands on the root element as a data attribute that
 * styles/custom.css turns into tokens, so overrides survive a change of look.
 */
import { t } from '../i18n'

/**
 * A world is a whole app: its own navigation, home screen and way of drawing
 * the shared blocks (styles under [data-world]). Looks are colour-and-type
 * variants of the Katalog world only.
 */
export type World = 'katalog' | 'gesto' | 'kaseta' | 'strumien' | 'ksiazeczka' | 'monochrom'

export interface WorldInfo {
  id: World
  name: string
  desc: string
}

export const WORLDS: WorldInfo[] = [
  { id: 'katalog', name: 'Katalog', get desc() { return t('world-info.katalog.desc') } },
  { id: 'gesto', name: 'Gęsto', get desc() { return t('world-info.gesto.desc') } },
  { id: 'kaseta', name: 'Kaseta', get desc() { return t('world-info.kaseta.desc') } },
  { id: 'strumien', name: 'Strumień', get desc() { return t('world-info.strumien.desc') } },
  { id: 'ksiazeczka', name: 'Książeczka', get desc() { return t('world-info.ksiazeczka.desc') } },
  { id: 'monochrom', name: 'Monochrom', get desc() { return t('world-info.monochrom.desc') } },
]

export type Look = 'katalog' | 'systemowy' | 'plakat' | 'konsola' | 'kalkulator'
export type Accent = 'look' | 'cream' | 'blue' | 'violet' | 'amber' | 'green' | 'red' | 'custom'
export type Contrast = 'normal' | 'high'
export type TextFont = 'look' | 'archivo' | 'system' | 'atkinson' | 'albert' | 'jetbrains'
export type NumFont = 'look' | 'fragment' | 'atkinson' | 'jetbrains' | 'system'
export type Labels = 'look' | 'caps' | 'plain' | 'lower'
export type Corners = 'look' | 'sharp' | 'soft' | 'round'
export type Lines = 'look' | 'thin' | 'bold'
export type Density = 'look' | 'compact' | 'normal' | 'comfortable'
/** 'system' follows the OS reduced-motion preference; it never forces motion on. */
export type Motion = 'system' | 'reduced' | 'off'
export type ChartGrid = 'look' | 'on' | 'off'
export type PeakLine = 'look' | 'dashed' | 'solid'

export interface Appearance {
  world: World
  look: Look
  accent: Accent
  /** Used when accent is 'custom'; one colour for both modes. */
  accentColor: string
  contrast: Contrast
  font: TextFont
  numFont: NumFont
  labels: Labels
  corners: Corners
  lines: Lines
  density: Density
  motion: Motion
  chartGrid: ChartGrid
  peakLine: PeakLine
}

export const APPEARANCE_DEFAULTS: Appearance = {
  world: 'katalog',
  look: 'katalog',
  accent: 'look',
  accentColor: '#3f8cff',
  contrast: 'normal',
  font: 'look',
  numFont: 'look',
  labels: 'look',
  corners: 'look',
  lines: 'look',
  density: 'look',
  motion: 'system',
  chartGrid: 'look',
  peakLine: 'look',
}

/** The overrides "restore the look" puts back; look, mode, scale and motion stay. */
export const OVERRIDE_KEYS = [
  'accent', 'contrast', 'font', 'numFont', 'labels', 'corners', 'lines', 'density', 'chartGrid', 'peakLine',
] as const satisfies readonly (keyof Appearance)[]

type Described = 'accent' | 'font' | 'numFont' | 'labels' | 'corners' | 'lines' | 'density' | 'chartGrid' | 'peakLine'

export interface LookInfo {
  id: Look
  name: string
  desc: string
  /** What the look itself picks for each override, shown on the "as in the look" option. */
  own: Record<Described, string>
}

export const LOOKS: LookInfo[] = [
  {
    id: 'katalog',
    name: 'Katalog',
    get desc() { return t('look.katalog.desc') },
    get own() { return { accent: t('look.own.cream'), font: 'Archivo', numFont: 'Fragment Mono', labels: t('look.own.caps'), corners: t('look.own.sharp'), lines: t('look.own.hairline'), density: t('look.own.normal'), chartGrid: t('look.own.visible'), peakLine: t('look.own.dashed') } },
  },
  {
    id: 'systemowy',
    name: 'Systemowy',
    get desc() { return t('look.systemowy.desc') },
    get own() { return { accent: t('look.own.blue'), font: t('look.own.system'), numFont: t('look.own.system'), labels: t('look.own.plain'), corners: t('look.own.round'), lines: t('look.own.hairline'), density: t('look.own.normal'), chartGrid: t('look.own.visible'), peakLine: t('look.own.dashed') } },
  },
  {
    id: 'plakat',
    name: 'Plakat',
    get desc() { return t('look.plakat.desc') },
    get own() { return { accent: t('look.own.red'), font: 'Archivo', numFont: 'Fragment Mono', labels: t('look.own.plain'), corners: t('look.own.sharp'), lines: t('look.own.bold-dividers'), density: t('look.own.normal'), chartGrid: t('look.own.visible'), peakLine: t('look.own.dashed') } },
  },
  {
    id: 'konsola',
    name: 'Konsola',
    get desc() { return t('look.konsola.desc') },
    get own() { return { accent: t('look.own.yellow'), font: 'JetBrains Mono', numFont: 'JetBrains Mono', labels: t('look.own.lower'), corners: t('look.own.sharp'), lines: t('look.own.hairline'), density: t('look.own.normal'), chartGrid: t('look.own.visible'), peakLine: t('look.own.dashed') } },
  },
  {
    id: 'kalkulator',
    name: 'Kalkulator',
    get desc() { return t('look.kalkulator.desc') },
    get own() { return { accent: t('look.own.yellow'), font: 'Albert Sans', numFont: 'Fragment Mono', labels: t('look.own.lower'), corners: t('look.own.round'), lines: t('look.own.hairline'), density: t('look.own.normal'), chartGrid: t('look.own.visible'), peakLine: t('look.own.dashed') } },
  },
]

export const lookInfo = (id: Look): LookInfo => LOOKS.find((l) => l.id === id) ?? LOOKS[0]

export interface Choice<T extends string> {
  value: T
  label: string
}

export const FONTS: Choice<Exclude<TextFont, 'look'>>[] = [
  { value: 'atkinson', get label() { return t('look.font.atkinson') } },
  { value: 'archivo', label: 'Archivo' },
  { value: 'system', get label() { return t('look.font.system') } },
  { value: 'albert', label: 'Albert Sans' },
  { value: 'jetbrains', label: 'JetBrains Mono' },
]
export const NUM_FONTS: Choice<Exclude<NumFont, 'look'>>[] = [
  { value: 'atkinson', get label() { return t('look.numfont.atkinson') } },
  { value: 'fragment', label: 'Fragment Mono' },
  { value: 'jetbrains', label: 'JetBrains Mono' },
  { value: 'system', get label() { return t('look.numfont.system') } },
]
export const LABEL_STYLES: Choice<Exclude<Labels, 'look'>>[] = [
  { value: 'caps', get label() { return t('look.labels.caps') } },
  { value: 'plain', get label() { return t('look.labels.plain') } },
  { value: 'lower', get label() { return t('look.labels.lower') } },
]
export const CORNERS: Choice<Exclude<Corners, 'look'>>[] = [
  { value: 'sharp', get label() { return t('look.corners.sharp') } },
  { value: 'soft', get label() { return t('look.corners.soft') } },
  { value: 'round', get label() { return t('look.corners.round') } },
]
export const LINES: Choice<Exclude<Lines, 'look'>>[] = [
  { value: 'thin', get label() { return t('look.lines.thin') } },
  { value: 'bold', get label() { return t('look.lines.bold') } },
]
export const DENSITIES: Choice<Exclude<Density, 'look'>>[] = [
  { value: 'compact', get label() { return t('look.density.compact') } },
  { value: 'normal', get label() { return t('look.density.normal') } },
  { value: 'comfortable', get label() { return t('look.density.comfortable') } },
]
export const MOTIONS: Choice<Motion>[] = [
  { value: 'system', get label() { return t('look.motion.system') } },
  { value: 'reduced', get label() { return t('look.motion.reduced') } },
  { value: 'off', get label() { return t('look.motion.off') } },
]
export const GRIDS: Choice<Exclude<ChartGrid, 'look'>>[] = [
  { value: 'on', get label() { return t('look.grid.on') } },
  { value: 'off', get label() { return t('look.grid.off') } },
]
export const PEAKS: Choice<Exclude<PeakLine, 'look'>>[] = [
  { value: 'dashed', get label() { return t('look.peak.dashed') } },
  { value: 'solid', get label() { return t('look.peak.solid') } },
]

export interface AccentPreset {
  id: Exclude<Accent, 'look' | 'custom'>
  name: string
  dark: string
  light: string
}

/** Pale on dark grounds, deep on light ones, so either mode keeps its contrast. */
export const ACCENTS: AccentPreset[] = [
  { id: 'cream', get name() { return t('look.accent.cream') }, dark: '#ffe0a8', light: '#8a5f00' },
  { id: 'blue', get name() { return t('look.accent.blue') }, dark: '#a9bcff', light: '#2f55c4' },
  { id: 'violet', get name() { return t('look.accent.violet') }, dark: '#d9c8ff', light: '#6a3fa8' },
  { id: 'amber', get name() { return t('look.accent.amber') }, dark: '#ffb15c', light: '#b4530a' },
  { id: 'green', get name() { return t('look.accent.green') }, dark: '#a8e0ae', light: '#2f6b3a' },
  { id: 'red', get name() { return t('look.accent.red') }, dark: '#ff8a7a', light: '#c8352b' },
]

function luminance(hex: unknown): number | null {
  const m = typeof hex === 'string' ? /^#([0-9a-f]{6})$/i.exec(hex.trim()) : null
  if (!m) return null
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio of two #rrggbb colours, or null when either is not one. */
export function contrastRatio(a: string, b: string): number | null {
  const la = luminance(a)
  const lb = luminance(b)
  if (la === null || lb === null) return null
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Near-black or white, whichever reads better on the given colour. */
export function inkOn(hex: string): string {
  const onDark = contrastRatio(hex, '#ffffff') ?? 0
  const onLight = contrastRatio(hex, '#111111') ?? 0
  return onLight >= onDark ? '#111111' : '#ffffff'
}

/** The accent an override asks for in this mode, or null to keep the look's own. */
export function accentHex(s: Pick<Appearance, 'accent' | 'accentColor'>, dark: boolean): string | null {
  if (s.accent === 'custom') return luminance(s.accentColor) === null ? null : s.accentColor.trim()
  const preset = ACCENTS.find((a) => a.id === s.accent)
  return preset ? (dark ? preset.dark : preset.light) : null
}

// Every value each choice may hold; anything else in storage is from another version or a hand edit.
const ALLOWED: Record<Exclude<keyof Appearance, 'accentColor'>, readonly string[]> = {
  world: WORLDS.map((w) => w.id),
  look: LOOKS.map((l) => l.id),
  accent: ['look', 'custom', ...ACCENTS.map((a) => a.id)],
  contrast: ['normal', 'high'],
  font: ['look', ...FONTS.map((c) => c.value)],
  numFont: ['look', ...NUM_FONTS.map((c) => c.value)],
  labels: ['look', ...LABEL_STYLES.map((c) => c.value)],
  corners: ['look', ...CORNERS.map((c) => c.value)],
  lines: ['look', ...LINES.map((c) => c.value)],
  density: ['look', ...DENSITIES.map((c) => c.value)],
  motion: MOTIONS.map((c) => c.value),
  chartGrid: ['look', ...GRIDS.map((c) => c.value)],
  peakLine: ['look', ...PEAKS.map((c) => c.value)],
}

/** Settings as stored, with every unknown or malformed appearance value put back to its default. */
export function cleanAppearance<T extends Appearance>(stored: T): T {
  const clean = { ...stored } as Record<string, unknown>
  for (const key of Object.keys(ALLOWED) as (keyof typeof ALLOWED)[]) {
    if (!ALLOWED[key].includes(clean[key] as string)) clean[key] = APPEARANCE_DEFAULTS[key]
  }
  if (luminance(clean.accentColor) === null) clean.accentColor = APPEARANCE_DEFAULTS.accentColor
  return clean as T
}

const ATTRS = {
  font: 'font',
  numFont: 'numFont',
  labels: 'labels',
  corners: 'corners',
  lines: 'lines',
  density: 'density',
  chartGrid: 'chartGrid',
  peakLine: 'peak',
} as const satisfies Partial<Record<keyof Appearance, string>>

/**
 * Puts the look and its overrides on the root element. 'look', 'normal'
 * contrast and 'system' motion remove their attribute, so the stylesheet
 * only ever sees what someone actually changed.
 */
export function applyAppearance(root: HTMLElement, s: Appearance, dark: boolean): void {
  root.dataset.world = s.world
  // Looks are Katalog variants; in another world their palettes must not match at all.
  if (s.world === 'katalog') root.dataset.look = s.look
  else delete root.dataset.look
  for (const [key, attr] of Object.entries(ATTRS) as [keyof typeof ATTRS, string][]) {
    if (s[key] === 'look') delete root.dataset[attr]
    else root.dataset[attr] = s[key]
  }
  if (s.contrast === 'high') root.dataset.contrast = 'high'
  else delete root.dataset.contrast
  if (s.motion === 'system') delete root.dataset.motion
  else root.dataset.motion = s.motion

  // Inline, so it outranks every look's palette in either mode.
  const hex = accentHex(s, dark)
  if (hex) {
    root.style.setProperty('--accent', hex)
    root.style.setProperty('--on-accent', inkOn(hex))
  } else {
    root.style.removeProperty('--accent')
    root.style.removeProperty('--on-accent')
  }
}

/** True when motion should be cut back, by the OS or by the setting. */
export function motionReduced(): boolean {
  const setting = document.documentElement.dataset.motion
  return setting === 'reduced' || setting === 'off' || window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
