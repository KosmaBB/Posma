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

  useEffect(() => {
    localStorage.setItem(ORDER_KEY, JSON.stringify(moduleOrder))
  }, [moduleOrder])

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
  }
}

export type AppState = ReturnType<typeof useAppState>
