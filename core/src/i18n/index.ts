/**
 * Interface text in every language POSMA ships, and the function that picks it.
 *
 * Each language is one JSON file in this folder named by its code (pl.json,
 * en.json, de.json); a file dropped here is a new language, with nothing to
 * register. pl.json holds every key. A key another file lacks falls back to
 * English, then Polish, so a partial translation never shows an empty label.
 * docs/writing-a-translation.md describes the format.
 *
 * The language lives here rather than in React state because tables outside
 * components (risk labels, folder names) read it while rendering. Settings
 * live at the top of the tree, so changing the language re-renders everything.
 */
import pl from './pl.json'

export type Key = keyof typeof pl
/** CLDR plural forms (one, few, many, …); `other` is the one every language has. */
type Plural = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
type Catalog = Partial<Record<string, string | Plural>>
type Vars = Record<string, string | number>

const files = import.meta.glob<Catalog>('./*.json', { eager: true, import: 'default' })
const catalogs: Record<string, Catalog> = Object.fromEntries(
  Object.entries(files).map(([path, catalog]) => [path.slice(2, -'.json'.length), catalog]),
)

let current = 'pl'
let plurals = new Intl.PluralRules(current)

/** The system's language when there is a file for it, else English. */
export function defaultLanguage(): string {
  const code = navigator.language.slice(0, 2).toLowerCase()
  return code in catalogs ? code : 'en'
}

export function setLanguage(code: string): void {
  const next = code in catalogs ? code : 'en'
  if (next === current) return
  current = next
  plurals = new Intl.PluralRules(next)
  document.documentElement.lang = next
}

/** The current language as a locale for Intl: numbers, dates, lower case. */
export function locale(): string {
  return current
}

const numberFormats = new Map<string, Intl.NumberFormat>()

/** A number in the current language's notation: 1,5 in Polish, 1.5 in English. */
export function formatNumber(n: number, options: Intl.NumberFormatOptions = {}): string {
  const key = current + JSON.stringify(options)
  let format = numberFormats.get(key)
  if (!format) numberFormats.set(key, (format = new Intl.NumberFormat(current, options)))
  return format.format(n)
}

/** Every language there is a file for, each named in itself. */
export function languages(): { code: string; name: string }[] {
  return Object.entries(catalogs).map(([code, c]) => ({ code, name: String(c['language.name'] ?? code) }))
}

/** For keys built from an id, where only some ids have one (a module's quick action). */
export function has(key: string): key is Key {
  return key in pl
}

/**
 * Text for a key in the current language, with `{name}` filled from `vars`.
 * A plural entry picks its form by `vars.n`: t('settings.refresh.every', { n: 5 }).
 */
export function t(key: Key, vars: Vars = {}): string {
  const entry = catalogs[current]?.[key] ?? catalogs.en?.[key] ?? (pl as Catalog)[key]
  if (entry === undefined) return key
  const text = typeof entry === 'string' ? entry : (entry[plurals.select(Number(vars.n))] ?? entry.other)
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}
