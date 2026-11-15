/**
 * App-level state: onboarding result, installed modules, current view.
 * Persisted to localStorage for now — will move to Tauri store/backed
 * settings once the backend settings layer exists.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Os } from '../data/modules'
import { loadLinuxProfile, saveLinuxProfile as storeLinuxProfile, type LinuxProfile, type ProfileOverrides } from '../data/linuxProfile'

export type AccessLevel = 'full' | 'selective'

export interface OnboardingResult {
  consentAccepted: boolean
  os: Os
  accessLevel: AccessLevel
  installedModules: string[]
  /** True when the last onboarding step asked for the tour; it starts right after. */
  tutorialDone: boolean
}

export type View =
  | { kind: 'dashboard' }
  /** `param` lets one module hand another a starting point — the health
   *  monitor opening the disk map on a particular volume, for instance. */
  | { kind: 'module'; moduleId: string; param?: string }
  | { kind: 'folder'; folderId: string }
  | { kind: 'settings' }
  | { kind: 'manager' }
  | { kind: 'links' }

const STORAGE_KEY = 'posma.onboarding.v1'

/**
 * Module order per folder. Kept apart from the onboarding record so a drag
 * does not rewrite that one-off result.
 */
const ORDER_KEY = 'posma.moduleOrder.v1'

function loadOrder(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(ORDER_KEY)
    return raw ? (JSON.parse(raw) as Record<string, string[]>) : {}
  } catch {
    return {}
  }
}


export function detectOs(): Os {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'macos'
  if (ua.includes('linux')) return 'linux'
  return 'windows'
}

function loadOnboarding(): OnboardingResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as OnboardingResult
  } catch {
    return null
  }
}

export function useAppState() {
  const [onboarding, setOnboarding] = useState<OnboardingResult | null>(loadOnboarding)
  const [view, setView] = useState<View>({ kind: 'dashboard' })
  const [moduleOrder, setModuleOrder] = useState<Record<string, string[]>>(loadOrder)
  // Detected afresh each start rather than stored: a different session
  // (GNOME today, Plasma tomorrow) has to show up without a reset.
  const [linuxProfile, setLinuxProfile] = useState<LinuxProfile | null>(null)
  // Not persisted: a tour cut short by closing the app is restarted from 904.
  const [touring, setTouring] = useState(false)

  useEffect(() => {
    if (detectOs() !== 'linux') return
    loadLinuxProfile()
      .then(setLinuxProfile)
      .catch(() => {
        /* modules keep their generic names and still explain themselves */
      })
  }, [])

  const saveLinuxProfile = useCallback(async (overrides: ProfileOverrides) => {
    setLinuxProfile(await storeLinuxProfile(overrides))
  }, [])

  useEffect(() => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(moduleOrder))
  }, [moduleOrder])

  useEffect(() => {
    if (onboarding) localStorage.setItem(STORAGE_KEY, JSON.stringify(onboarding))
  }, [onboarding])

  const completeOnboarding = useCallback((result: OnboardingResult) => {
    setOnboarding(result)
    setView({ kind: 'dashboard' })
    setTouring(result.tutorialDone)
  }, [])

  const startTour = useCallback(() => setTouring(true), [])
  const endTour = useCallback(() => setTouring(false), [])

  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setOnboarding(null)
  }, [])

  const setModuleInstalled = useCallback((moduleId: string, installed: boolean) => {
    setOnboarding((prev) => {
      if (!prev) return prev
      const has = prev.installedModules.includes(moduleId)
      if (installed === has) return prev
      return {
        ...prev,
        installedModules: installed
          ? [...prev.installedModules, moduleId]
          : prev.installedModules.filter((id) => id !== moduleId),
      }
    })
  }, [])

  const setFolderOrder = useCallback((folderId: string, ids: string[]) => {
    setModuleOrder((prev) => ({ ...prev, [folderId]: ids }))
  }, [])

  const installedSet = useMemo(() => new Set(onboarding?.installedModules ?? []), [onboarding])

  return {
    onboarding,
    view,
    setView,
    completeOnboarding,
    resetOnboarding,
    setModuleInstalled,
    installedSet,
    moduleOrder,
    setFolderOrder,
    linuxProfile,
    saveLinuxProfile,
    touring,
    startTour,
    endTour,
  }
}

export type AppState = ReturnType<typeof useAppState>
