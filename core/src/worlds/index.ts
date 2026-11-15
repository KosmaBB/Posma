/**
 * Every world's shell and its small preview for the picker. Katalog ships
 * with the window; the others load the first time they are chosen or shown,
 * together with their stylesheet and faces.
 *
 * A world's stylesheet keeps to the looks' rule: structure under
 * [data-world='x'] (0,1,0) so the person's overrides in custom.css (0,2,0)
 * still win, colours under [data-world='x'][data-theme='…'] (0,2,0).
 */
import { lazy, type ComponentType } from 'react'
import type { AppState } from '../state/appState'
import type { SettingsState } from '../state/settings'
import type { World } from '../state/looks'
import { Shell as KatalogShell } from '../components/shell/Shell'

export interface ShellProps {
  app: AppState
  settings: SettingsState
}

interface WorldModule {
  Shell: ComponentType<ShellProps>
  Preview: ComponentType
}

type Built = Exclude<World, 'katalog'>

const LOADERS: Record<Built, () => Promise<WorldModule>> = {
  gesto: () => import('./gesto'),
  kaseta: () => import('./kaseta'),
  strumien: () => import('./strumien'),
  ksiazeczka: () => import('./ksiazeczka'),
  monochrom: () => import('./monochrom'),
}

const built = Object.keys(LOADERS) as Built[]

/** Starts loading a world's code and stylesheet, so screens drawn outside its shell (onboarding) are styled too. */
export function loadWorld(world: World): void {
  // A failure here surfaces again in the shell's own import, where App falls back to Katalog.
  if (world !== 'katalog') LOADERS[world]().catch(() => {})
}

export const WORLD_SHELLS = {
  katalog: KatalogShell,
  ...Object.fromEntries(built.map((id) => [id, lazy(() => LOADERS[id]().then((m) => ({ default: m.Shell })))])),
} as Record<World, ComponentType<ShellProps>>

/** Katalog's preview is the look gallery's own card, so it is not listed here. */
export const WORLD_PREVIEWS = Object.fromEntries(
  built.map((id) => [id, lazy(() => LOADERS[id]().then((m) => ({ default: m.Preview })))]),
) as unknown as Record<Built, ComponentType>
