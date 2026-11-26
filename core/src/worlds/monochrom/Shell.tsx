import { useEffect, useRef } from 'react'
import type { ShellProps } from '../index'
import type { AppState, View } from '../../state/appState'
import { folders, moduleById, modulesInFolder, type FolderId } from '../../data/modules'
import { ModuleManager } from '../../views/ModuleManager'
import { Settings } from '../../views/Settings'
import { Links } from '../../views/Links'
import { Tour } from '../../components/tour/Tour'
import { t } from '../../i18n'
import { Home } from './Home'
import { Folder } from './Folder'
import { ModuleFrame } from './ModuleFrame'
import { Search } from './Search'

/** The folder a view belongs to, so its tab stays underlined inside a module. */
function folderOf(view: View, app: AppState): FolderId | null {
  if (view.kind === 'folder') return view.folderId as FolderId
  if (view.kind === 'module') return moduleById(view.moduleId, app.linuxProfile)?.folder ?? null
  return null
}

const viewKey = (v: View) => JSON.stringify(v)

export function Shell({ app, settings }: ShellProps) {
  const { view, setView, onboarding, linuxProfile } = app
  const os = onboarding?.os
  const page = useRef<HTMLElement>(null)
  const inFolder = folderOf(view, app)
  const appPage = view.kind === 'settings' || view.kind === 'manager' || view.kind === 'links'
  // Folders with nothing for this system would only lead to an empty table.
  const tabs = folders.filter((f) => modulesInFolder(f.id, os, linuxProfile).length > 0)
  const system = os === 'linux'
    ? [linuxProfile?.name, linuxProfile?.family, linuxProfile?.desktop].filter(Boolean).join(' · ') || 'Linux'
    : os ? { windows: 'Windows', macos: 'macOS', linux: 'Linux' }[os] : '—'

  // Every new view starts at its first claim.
  const key = viewKey(view)
  useEffect(() => {
    page.current?.scrollTo({ top: 0 })
  }, [key])

  return (
    <div className="mono-shell">
      <header className="mono-bar">
        <button className="mono-mark" onClick={() => setView({ kind: 'dashboard' })} aria-label={t('world.monochrom.bar.mark')}>
          posma
        </button>
        <span className="mono-sys">
          {system}
          <span className="mono-access">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 5 6.3v5.2c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6.3z" /></svg>
            {onboarding?.accessLevel === 'full' ? t('nav.access.full') : t('world.monochrom.bar.access-selective')}
          </span>
        </span>
        <nav className="mono-tabs" aria-label={t('world.monochrom.bar.sections')}>
          <button aria-current={view.kind === 'dashboard' ? 'page' : undefined} onClick={() => setView({ kind: 'dashboard' })}>
            {t('world.monochrom.overview')}
          </button>
          {tabs.map((f) => (
            <button
              key={f.id}
              data-tour="folder"
              aria-current={inFolder === f.id ? 'page' : undefined}
              onClick={() => setView({ kind: 'folder', folderId: f.id })}
            >
              {f.name}
            </button>
          ))}
          <button aria-current={appPage ? 'page' : undefined} onClick={() => setView({ kind: 'settings' })}>
            {t('page.settings')}
          </button>
        </nav>
        <div className="mono-bar__end">
          <Search app={app} />
          <button className="btn btn-ghost btn-mini mono-help" data-tour="tour" onClick={app.startTour}>
            {t('nav.tour')}
          </button>
        </div>
      </header>

      <main className="mono-page" ref={page} data-view={view.kind}>
        <div className="mono-wrap" key={key}>
          {view.kind === 'dashboard' && <Home app={app} settings={settings} />}
          {view.kind === 'folder' && <Folder app={app} folderId={view.folderId} />}
          {view.kind === 'module' && <ModuleFrame app={app} moduleId={view.moduleId} />}
          {appPage && <AppPage app={app} settings={settings} kind={view.kind} />}
        </div>
      </main>

      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}

const appTabs = () => [
  { kind: 'settings', name: t('page.settings') },
  { kind: 'manager', name: t('world.monochrom.app.tab.manager') },
  { kind: 'links', name: t('page.links') },
] as const

/** Settings, the module manager and links: a claim on top, the page itself as its proof. */
function AppPage({ app, settings, kind }: ShellProps & { kind: 'settings' | 'manager' | 'links' }) {
  const total = allModules(app)
  const on = total.filter((m) => app.installedSet.has(m.id)).length
  const claim = {
    settings: { h: t('world.monochrom.app.settings.h'), p: t('world.monochrom.app.settings.p') },
    manager: {
      h: t('world.monochrom.app.manager.h', { on, n: total.length }),
      p: t('world.monochrom.app.manager.p'),
    },
    links: { h: t('world.monochrom.app.links.h'), p: t('world.monochrom.app.links.p') },
  }[kind]

  return (
    <div className="mono-pairs">
      <header className="mono-modhead">
        <nav className="mono-subnav" aria-label={t('nav.app')}>
          {appTabs().map((tab) => (
            <button key={tab.kind} aria-current={tab.kind === kind ? 'page' : undefined} onClick={() => app.setView({ kind: tab.kind })}>
              {tab.name}
            </button>
          ))}
        </nav>
        <h1>{claim.h}</h1>
        <p>{claim.p}</p>
      </header>
      <div className={`mono-proof mono-proof--page mono-proof--${kind}`}>
        {kind === 'settings' && <Settings app={app} settings={settings} />}
        {kind === 'manager' && <ModuleManager app={app} />}
        {kind === 'links' && <Links />}
      </div>
    </div>
  )
}

/** Every module this system has, installed or not. */
function allModules(app: AppState) {
  return folders.flatMap((f) => modulesInFolder(f.id, app.onboarding?.os, app.linuxProfile))
}
