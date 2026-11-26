import { moduleById } from '../../data/modules'
import type { AppState, View } from '../../state/appState'
import { t } from '../../i18n'

export interface TourStep {
  /** Where the step sits in the sleeve: side and chapter, shown on the card. */
  chapter: string
  view: View
  /** CSS selector; every match is framed together, so a step can hold a group of rows. */
  target: string
  title: string
  text: string
}

const at = (name: string) => `[data-tour="${name}"]`

/**
 * The module the module chapter opens: the temp cleaner when it is on,
 * otherwise the first installed module this system has. Null when nothing
 * is installed, and the chapter is left out rather than shown on an empty page.
 */
function sampleModule(app: AppState): string | null {
  const ids = app.onboarding?.installedModules ?? []
  if (ids.includes('temp-clean')) return 'temp-clean'
  return ids.find((id) => moduleById(id, app.linuxProfile)) ?? null
}

export function tourSteps(app: AppState): TourStep[] {
  const dashboard: View = { kind: 'dashboard' }
  // Some steps describe Katalog's own controls; every other world gets wording true for all of them.
  const katalog = (document.documentElement.dataset.world ?? 'katalog') === 'katalog'
  const moduleId = sampleModule(app)
  const moduleSteps: TourStep[] = moduleId
    ? [
        {
          chapter: t('tour.chapter.module'),
          view: { kind: 'module', moduleId },
          target: at('module-hero'),
          title: t('tour.module.hero.title'),
          text: t('tour.module.hero.text'),
        },
        {
          chapter: t('tour.chapter.module'),
          view: { kind: 'module', moduleId },
          target: `${at('module')} > :nth-child(2)`,
          title: t('tour.module.flow.title'),
          text: t('tour.module.flow.text'),
        },
      ]
    : []

  return [
    {
      chapter: t('tour.chapter.dashboard'),
      view: dashboard,
      target: at('cpu'),
      title: t('tour.cpu.title'),
      text: katalog
        ? t('tour.cpu.text.katalog')
        : t('tour.cpu.text.other'),
    },
    {
      chapter: t('tour.chapter.dashboard'),
      view: dashboard,
      target: at('machine'),
      title: t('tour.machine.title'),
      text: katalog
        ? t('tour.machine.text.katalog')
        : t('tour.machine.text.other'),
    },
    {
      chapter: t('tour.chapter.dashboard'),
      view: dashboard,
      // The block shrinks inside its scrolling column; its children are the real extent.
      target: `${at('reclaim')} > *`,
      title: t('tour.reclaim.title'),
      text: t('tour.reclaim.text'),
    },
    {
      chapter: t('tour.chapter.dashboard'),
      view: dashboard,
      target: at('index'),
      title: t('tour.index.title'),
      text: katalog
        ? t('tour.index.text.katalog')
        : t('tour.index.text.other'),
    },
    {
      chapter: t('tour.chapter.catalog'),
      view: dashboard,
      target: at('folder'),
      title: t('tour.numbers.title'),
      text: t('tour.numbers.text'),
    },
    {
      chapter: t('tour.chapter.catalog'),
      view: { kind: 'folder', folderId: 'data' },
      target: at('folder-list'),
      title: t('tour.folder.title'),
      text: katalog
        ? t('tour.folder.text.katalog')
        : t('tour.folder.text.other'),
    },
    ...moduleSteps,
    {
      chapter: t('tour.chapter.security'),
      view: { kind: 'folder', folderId: 'security' },
      target: at('folder-list'),
      title: t('tour.security.title'),
      text: t('tour.security.text'),
    },
    {
      chapter: t('tour.chapter.modules'),
      view: { kind: 'manager' },
      target: `${at('manager')} > section:first-of-type .cat-row:nth-child(-n+3)`,
      title: t('tour.manager.title'),
      text: katalog
        ? t('tour.manager.text.katalog')
        : t('tour.manager.text.other'),
    },
    {
      chapter: t('tour.chapter.settings'),
      view: { kind: 'settings' },
      target: at('access'),
      title: t('tour.access.title'),
      text: t('tour.access.text'),
    },
    {
      chapter: t('tour.chapter.settings'),
      view: { kind: 'settings' },
      target: at('blacklist'),
      title: t('tour.blacklist.title'),
      text: t('tour.blacklist.text'),
    },
    {
      chapter: t('tour.chapter.settings'),
      view: { kind: 'settings' },
      target: at('look'),
      title: t('tour.look.title'),
      text: t('tour.look.text'),
    },
    {
      chapter: t('tour.chapter.return'),
      view: dashboard,
      target: at('tour'),
      title: t('tour.return.title'),
      text: t('tour.return.text'),
    },
  ]
}
