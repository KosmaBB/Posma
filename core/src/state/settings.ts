/**
 * User preferences, persisted to localStorage.
 *
 * Kept apart from the onboarding record: that is a one-off result, this
 * changes whenever someone opens Settings.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

export type UiScale = 'auto' | '0.9' | '1' | '1.15' | '1.3' | '1.5'
export type Reminders = 'off' | 'normal' | 'aggressive'
export type Language = 'pl' | 'en'

export interface Settings {
  /** Interface zoom. 'auto' derives one from the window width. */
  uiScale: UiScale
  reminders: Reminders
  language: Language
  /** How often live views poll, in milliseconds. */
  refreshMs: number
  /**
   * Absolute paths scanners must never list or offer to delete. Anything
   * at or below one of these is skipped — someone else's system volume,
   * a photo archive, a client's documents.
   */
  blacklist: string[]
}

const KEY = 'posma.settings.v1'

export const DEFAULTS: Settings = {
  uiScale: 'auto',
  reminders: 'normal',
  language: 'pl',
  refreshMs: 2000,
  blacklist: [],
}

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY)
    // Spread over the defaults so a settings file written by an older
    // version gains new keys instead of leaving them undefined.
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) } : DEFAULTS
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
export function autoScale(width: number): number {
  if (width >= 3400) return 1.5
  if (width >= 2500) return 1.25
  if (width >= 1900) return 1.1
  return 1
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings))
  }, [settings])

  // Applied to the root element rather than a wrapper so nothing inside has
  // to know it is being scaled.
  useEffect(() => {
    function apply() {
      const scale =
        settings.uiScale === 'auto' ? autoScale(window.innerWidth) : Number(settings.uiScale)
      document.documentElement.style.zoom = String(scale)
    }
    apply()
    if (settings.uiScale !== 'auto') return
    window.addEventListener('resize', apply)
    return () => window.removeEventListener('resize', apply)
  }, [settings.uiScale])

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
