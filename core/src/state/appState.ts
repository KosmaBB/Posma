/**
 * App-level state: onboarding result, installed modules, current view.
 * Persisted to localStorage for now — will move to Tauri store/backed
 * settings once the backend settings layer exists.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Os } from '../data/modules'

export type AccessLevel = 'full' | 'selective'

export interface OnboardingResult {
  consentAccepted: boolean
  os: Os
  accessLevel: AccessLevel
  installedModules: string[]
  tutorialDone: boolean
}

export type View =
  | { kind: 'dashboard' }
  | { kind: 'module'; moduleId: string }
  | { kind: 'settings' }
  | { kind: 'manager' }
  | { kind: 'links' }

const STORAGE_KEY = 'posma.onboarding.v1'

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

  useEffect(() => {
    if (onboarding) localStorage.setItem(STORAGE_KEY, JSON.stringify(onboarding))
  }, [onboarding])

  const completeOnboarding = useCallback((result: OnboardingResult) => {
    setOnboarding(result)
    setView({ kind: 'dashboard' })
  }, [])

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

  const installedSet = useMemo(() => new Set(onboarding?.installedModules ?? []), [onboarding])

  return {
    onboarding,
    view,
    setView,
    completeOnboarding,
    resetOnboarding,
    setModuleInstalled,
    installedSet,
  }
}

export type AppState = ReturnType<typeof useAppState>
