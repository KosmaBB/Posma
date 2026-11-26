/**
 * User preferences, persisted to localStorage.
 *
 * Kept apart from the onboarding record: that is a one-off result, this
 * changes whenever someone opens Settings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { defaultLanguage, setLanguage } from '../i18n'
import { APPEARANCE_DEFAULTS, applyAppearance, cleanAppearance, type Appearance } from './looks'

export type UiScale = 'auto' | '0.9' | '1' | '1.15' | '1.3' | '1.5' | '1.75' | '2'
export type Theme = 'dark' | 'light' | 'system'
export type Reminders = 'off' | 'normal' | 'aggressive'

/** The look and its overrides come from Appearance; see state/looks.ts. */
export interface Settings extends Appearance {
  theme: Theme
  /** Interface zoom. 'auto' derives one from the window width. */
  uiScale: UiScale
  reminders: Reminders
  /** A file name in core/src/i18n: pl, en, or a community translation. */
  language: string
  /** How often live views poll, in milliseconds. */
  refreshMs: number
  /**
   * Absolute paths scanners must never list or offer to delete. Anything
   * at or below one of these is skipped — someone else's system volume,
   * a photo archive, a client's documents.
   */
  blacklist: string[]
  /** CPU cores the dashboard draws on its history at all times. */
  watchedCores: number[]
}

const KEY = 'posma.settings.v1'

export const DEFAULTS: Settings = {
  ...APPEARANCE_DEFAULTS,
  theme: 'dark',
  uiScale: 'auto',
  reminders: 'normal',
  language: defaultLanguage(),
  refreshMs: 2000,
  blacklist: [],
  watchedCores: [],
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    // Spread over the defaults so a settings file written by an older
    // version gains new keys instead of leaving them undefined.
    const stored = raw ? (JSON.parse(raw) as Omit<Partial<Settings>, 'accent'> & { accent?: string }) : {}
    // 'teal' was the old name of Katalog's own cream; it now means "the look's own".
    if (stored.accent === 'teal') stored.accent = 'look'
    return cleanAppearance({ ...DEFAULTS, ...stored } as Settings)
  } catch {
    return DEFAULTS
  }
}

/**
 * Zoom for 'auto', derived from window width.
 *
 * This is what the CSS breakpoints were supposed to do and could not: the
 * stylesheet sets sizes in pixels, so raising the root font size changed
 * nothing. `zoom` scales the whole layout, and unlike a transform it does
 * not break fixed positioning or viewport units.
 */
export function autoScale(width: number, height: number): number {
  // Grows with the window, so a 1440p or 4K screen shows the Full HD layout
  // larger rather than small type with room around it. Both sides count: a
  // 21:9 or 32:9 screen keeps its height, and its extra width goes to the
  // worlds' data-wide layouts. Whole 5 % steps, so a window resized by a few
  // pixels does not lay the page out again.
  const scale = Math.min(width / AUTO_SPACE_W, height / AUTO_SPACE_H)
  return Math.min(AUTO_MAX, Math.max(1, Math.floor(scale * 20) / 20))
}

/** The least space automatic scaling leaves: a little over the 1600 × 900 minimum window. */
const AUTO_SPACE_W = 1700
const AUTO_SPACE_H = 950
const AUTO_MAX = 3

/**
 * Width and height steps the worlds lay out by. Media queries measure the
 * window, not the space left once `zoom` scales the page: a 1600 px window
 * at 150 % keeps its widest layout in 1067 px. So the steps are set from the
 * scaled size, as `data-fit~='N'` / `data-fit-h~='N'` on the root, and the
 * other way for large screens as `data-wide~='N'` (at least N px). Keep in
 * step with those selectors in worlds/<id>/world.css.
 */
const FIT_WIDTHS = [980, 1100, 1180, 1280, 1340, 1407, 1440, 1700]
const FIT_HEIGHTS = [760]
const WIDE_WIDTHS = [1900, 2400, 3200]

export function fitSteps(width: number, height: number): { fit: string; fitH: string; wide: string } {
  return {
    fit: FIT_WIDTHS.filter((s) => width <= s).join(' '),
    fitH: FIT_HEIGHTS.filter((s) => height <= s).join(' '),
    wide: WIDE_WIDTHS.filter((s) => width >= s).join(' '),
  }
}

/**
 * The blacklist as it stands right now, readable outside React.
 *
 * Scanners need it at the moment a scan starts, not as something to react
 * to, so threading the whole settings object through every module view
 * would be ceremony. Same storage, same source.
 */
export function currentBlacklist(): string[] {
  return load().blacklist
}

/** Whether a theme setting means dark right now; 'system' asks the OS. */
export function resolveDark(theme: Theme): boolean {
  return theme === 'dark' || (theme === 'system' && !window.matchMedia('(prefers-color-scheme: light)').matches)
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)
  // During render, not in an effect: the children rendered next must already read the new language.
  setLanguage(settings.language)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings))
  }, [settings])

  // Applied to the root element rather than a wrapper so nothing inside has
  // to know it is being scaled.
  useEffect(() => {
    function apply() {
      const scale =
        settings.uiScale === 'auto' ? autoScale(window.innerWidth, window.innerHeight) : Number(settings.uiScale)
      const root = document.documentElement
      root.style.zoom = String(scale)
      Object.assign(root.dataset, fitSteps(window.innerWidth / scale, window.innerHeight / scale))
    }
    apply()
    // Even at a fixed scale, a resized window changes the space the worlds lay out in.
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [settings.uiScale])

  // Mode, look and every override are attributes on the root element, so
  // the stylesheet follows from tokens rather than a second set of rules.
  // Re-run on any setting: a handful of attribute writes, cheaper than a
  // dependency list that drifts each time an override is added.
  useEffect(() => {
    const root = document.documentElement
    const apply = () => {
      const dark = resolveDark(settings.theme)
      root.dataset.theme = dark ? 'dark' : 'light'
      applyAppearance(root, settings, dark)
    }
    apply()
    if (settings.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: light)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [settings])

  const set = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }, [])

  const addToBlacklist = useCallback((path: string) => {
    setSettings((prev) =>
      prev.blacklist.includes(path) ? prev : { ...prev, blacklist: [...prev.blacklist, path] },
    )
  }, [])

  const removeFromBlacklist = useCallback((path: string) => {
    setSettings((prev) => ({ ...prev, blacklist: prev.blacklist.filter((p) => p !== path) }))
  }, [])

  return useMemo(
    () => ({ settings, set, addToBlacklist, removeFromBlacklist }),
    [settings, set, addToBlacklist, removeFromBlacklist],
  )
}

export type SettingsState = ReturnType<typeof useSettings>
