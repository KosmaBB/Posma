import { useEffect, useMemo, useRef } from 'react'
import { version } from '../../../package.json'
import type { ShellProps } from '../index'
import { catalogNumbers, folderNumber, folders, type ModuleDef } from '../../data/modules'
import { UP_TO_ONE, size, systemName, usedPct, useMachine, useReclaim } from '../../state/machine'
import { FolderView } from '../../views/FolderView'
import { ModuleManager } from '../../views/ModuleManager'
import { Settings } from '../../views/Settings'
import { Links } from '../../views/Links'
import { Tour } from '../../components/tour/Tour'
import { Shelf } from './Shelf'
import { Home } from './Home'
import { ModuleFrame } from './ModuleFrame'
import { Page } from './Page'
import { t } from '../../i18n'

/** Away from the home screen the readings only feed the shelf's spines. */
const SHELF_REFRESH_MS = 15000

/**
 * Kaseta: the disk is a tape. A shelf of cassette spines on the left, an
 * unfolded j-card in the middle, deck keys under it for the real actions.
 */
export function Shell({ app, settings }: ShellProps) {
  const { view, onboarding, installedSet, linuxProfile } = app
  const refreshMs = settings.settings.refreshMs
  // shortcut: the shelf's readings poll every 15 s off the home screen; poll faster if a page ever shows them live.
  const machine = useMachine(view.kind === 'dashboard' ? refreshMs : Math.max(refreshMs, SHELF_REFRESH_MS))
  const reclaim = useReclaim(app)
  const numbers = useMemo(() => catalogNumbers(onboarding?.os, linuxProfile), [onboarding?.os, linuxProfile])
  const enabled = [...numbers.keys()].filter((id) => installedSet.has(id)).length

  // A new page starts at its top, not where the last one was scrolled to.
  const main = useRef<HTMLElement>(null)
  const place = view.kind === 'module' ? view.moduleId : view.kind === 'folder' ? view.folderId : view.kind
  useEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [place])

  /** What a spine can say about its module without asking it anything. */
  function reading(m: ModuleDef): string | null {
    const hit = reclaim.foundOf(m.id)
    if (hit) return hit.error ? t('world.kaseta.top.error') : size(hit.bytes ?? 0)
    if (m.id === 'disk-map' && machine.mainDisk) return `${usedPct(machine.mainDisk).toFixed(0)} %`
    if (m.id === 'health-monitor' && machine.temp) return `${machine.temp.value.toFixed(0)} °C`
    return null
  }

  const folder = view.kind === 'folder' ? folders.find((f) => f.id === view.folderId) : undefined

  return (
    <div className="ks">
      <header className="ks-top">
        <b>POSMA</b>
        <span>{version}</span>
        <span>{systemName(app)}</span>
        <span>{t('world.kaseta.top.live', { s: UP_TO_ONE.format(refreshMs / 1000) })}</span>
        <span>{t('world.kaseta.top.access', { level: t(onboarding?.accessLevel === 'full' ? 'world.kaseta.access.full' : 'world.kaseta.access.selective') })}</span>
        <span className="ks-top__push">
          {t('world.kaseta.top.shelf', { n: enabled })}
        </span>
      </header>

      <Shelf app={app} reading={reading} />

      <main className="ks-main" ref={main} data-view={view.kind}>
        {view.kind === 'dashboard' && <Home app={app} settings={settings} machine={machine} reclaim={reclaim} />}
        {view.kind === 'module' && <ModuleFrame key={view.moduleId} app={app} moduleId={view.moduleId} />}
        {view.kind === 'folder' && (
          <Page no={folder ? folderNumber(folder.id) : '—'} spine={folder?.name ?? t('world.kaseta.spine.folder')}>
            <div className="ks-folder">
              <FolderView app={app} folderId={view.folderId} />
            </div>
          </Page>
        )}
        {view.kind === 'manager' && (
          <Page no="901" title={t('page.manager')} spine={t('world.kaseta.spine.modules')}>
            <ModuleManager app={app} />
          </Page>
        )}
        {view.kind === 'settings' && (
          <Page no="902" title={t('page.settings')} spine={t('page.settings')}>
            <Settings app={app} settings={settings} />
          </Page>
        )}
        {view.kind === 'links' && (
          <Page no="903" title={t('page.links')} spine={t('page.links')}>
            <Links />
          </Page>
        )}
      </main>

      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}
