/**
 * Looks, and the appearance overrides a person can lay on top of one.
 *
 * A look is a whole visual world: a palette for each mode, faces, label
 * style, corners, how the CPU chart draws. Its values live in CSS under
 * [data-look]. Every override defaults to 'look' — whatever the look says —
 * and otherwise lands on the root element as a data attribute that
 * styles/custom.css turns into tokens, so overrides survive a change of look.
 */

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
  { id: 'katalog', name: 'Katalog', desc: 'Numery katalogowe, pasek folderów, profil procesora. Ma pięć odmian.' },
  { id: 'gesto', name: 'Gęsto', desc: 'Wszystko na jednym ekranie: mozaika modułów z czerwonymi zakładkami.' },
  { id: 'kaseta', name: 'Kaseta', desc: 'Dysk jako taśma: półka kaset, wkładka ze stroną A i B.' },
  { id: 'strumien', name: 'Strumień', desc: 'Jedna rzecz na cały ekran, następna o jedno przewinięcie.' },
  { id: 'ksiazeczka', name: 'Książeczka', desc: 'Wolne miejsce jako saldo, każda operacja to wpis z pieczątką.' },
  { id: 'monochrom', name: 'Monochrom', desc: 'Jedna skala szarości: każde zdanie z dowodem obok.' },
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
    desc: 'Matowa czerń, szerokie wersaliki, numery katalogowe.',
    own: { accent: 'kremowy', font: 'Archivo', numFont: 'Fragment Mono', labels: 'wersaliki', corners: 'ostre', lines: 'włosowe', density: 'normalna', chartGrid: 'widoczna', peakLine: 'przerywana' },
  },
  {
    id: 'systemowy',
    name: 'Systemowy',
    desc: 'Krój systemu, karty i zaokrąglenia, jak natywna aplikacja.',
    own: { accent: 'niebieski', font: 'systemowy', numFont: 'systemowy', labels: 'zwykłe', corners: 'okrągłe', lines: 'włosowe', density: 'normalna', chartGrid: 'widoczna', peakLine: 'przerywana' },
  },
  {
    id: 'plakat',
    name: 'Plakat',
    desc: 'Styl szwajcarski: grube podziały, ogromne numery, czerwień.',
    own: { accent: 'czerwony', font: 'Archivo', numFont: 'Fragment Mono', labels: 'zwykłe', corners: 'ostre', lines: 'grube podziały', density: 'normalna', chartGrid: 'widoczna', peakLine: 'przerywana' },
  },
  {
    id: 'konsola',
    name: 'Konsola',
    desc: 'Wszystko w mono, kolory terminala, ramki jak w btop.',
    own: { accent: 'żółty', font: 'JetBrains Mono', numFont: 'JetBrains Mono', labels: 'małe litery', corners: 'ostre', lines: 'włosowe', density: 'normalna', chartGrid: 'widoczna', peakLine: 'przerywana' },
  },
  {
    id: 'kalkulator',
    name: 'Kalkulator',
    desc: 'Grafit i okrągłe klawisze, numer w okienku wyświetlacza.',
    own: { accent: 'żółty', font: 'Albert Sans', numFont: 'Fragment Mono', labels: 'małe litery', corners: 'okrągłe', lines: 'włosowe', density: 'normalna', chartGrid: 'widoczna', peakLine: 'przerywana' },
  },
]

export const lookInfo = (id: Look): LookInfo => LOOKS.find((l) => l.id === id) ?? LOOKS[0]

export interface Choice<T extends string> {
  value: T
  label: string
}

export const FONTS: Choice<Exclude<TextFont, 'look'>>[] = [
  { value: 'atkinson', label: 'Atkinson Hyperlegible (najczytelniejszy)' },
  { value: 'archivo', label: 'Archivo' },
  { value: 'system', label: 'Systemowy' },
  { value: 'albert', label: 'Albert Sans' },
  { value: 'jetbrains', label: 'JetBrains Mono' },
]
export const NUM_FONTS: Choice<Exclude<NumFont, 'look'>>[] = [
  { value: 'atkinson', label: 'Atkinson Hyperlegible Mono (najczytelniejszy)' },
  { value: 'fragment', label: 'Fragment Mono' },
  { value: 'jetbrains', label: 'JetBrains Mono' },
  { value: 'system', label: 'Systemowy' },
]
export const LABEL_STYLES: Choice<Exclude<Labels, 'look'>>[] = [
  { value: 'caps', label: 'Wersaliki' },
  { value: 'plain', label: 'Zwykłe' },
  { value: 'lower', label: 'Małe litery' },
]
export const CORNERS: Choice<Exclude<Corners, 'look'>>[] = [
  { value: 'sharp', label: 'Ostre' },
  { value: 'soft', label: 'Lekko zaokrąglone' },
  { value: 'round', label: 'Okrągłe' },
]
export const LINES: Choice<Exclude<Lines, 'look'>>[] = [
  { value: 'thin', label: 'Włosowe' },
  { value: 'bold', label: 'Grube' },
]
export const DENSITIES: Choice<Exclude<Density, 'look'>>[] = [
  { value: 'compact', label: 'Zwarta' },
  { value: 'normal', label: 'Normalna' },
  { value: 'comfortable', label: 'Przestronna' },
]
export const MOTIONS: Choice<Motion>[] = [
  { value: 'system', label: 'Jak w systemie' },
  { value: 'reduced', label: 'Ograniczony' },
  { value: 'off', label: 'Wyłączony' },
]
export const GRIDS: Choice<Exclude<ChartGrid, 'look'>>[] = [
  { value: 'on', label: 'Widoczna' },
  { value: 'off', label: 'Ukryta' },
]
export const PEAKS: Choice<Exclude<PeakLine, 'look'>>[] = [
  { value: 'dashed', label: 'Przerywana' },
  { value: 'solid', label: 'Ciągła' },
]

export interface AccentPreset {
  id: Exclude<Accent, 'look' | 'custom'>
  name: string
  dark: string
  light: string
}

/** Pale on dark grounds, deep on light ones, so either mode keeps its contrast. */
export const ACCENTS: AccentPreset[] = [
  { id: 'cream', name: 'Kremowy', dark: '#ffe0a8', light: '#8a5f00' },
  { id: 'blue', name: 'Niebieski', dark: '#a9bcff', light: '#2f55c4' },
  { id: 'violet', name: 'Fioletowy', dark: '#d9c8ff', light: '#6a3fa8' },
  { id: 'amber', name: 'Bursztynowy', dark: '#ffb15c', light: '#b4530a' },
  { id: 'green', name: 'Zielony', dark: '#a8e0ae', light: '#2f6b3a' },
  { id: 'red', name: 'Czerwony', dark: '#ff8a7a', light: '#c8352b' },
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
