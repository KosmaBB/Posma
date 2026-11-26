/**
 * Gęsto's shell: header band, folder tabs, the open folder's modules, a
 * category rail and the page. The machine and the reclaim check live here,
 * so every page and the navigation read the same numbers.
 */
import { useMemo } from 'react'
import type { ShellProps } from '../index'
import type { AppState } from '../../state/appState'
import { useMachine, useReclaim } from '../../state/machine'
import { catalogNumbers, moduleById, type FolderId } from '../../data/modules'
import { APP_PAGES } from '../../components/shell/Sidebar'
import { t } from '../../i18n'
import { Tour } from '../../components/tour/Tour'
import { Settings } from '../../views/Settings'
import { ModuleManager } from '../../views/ModuleManager'
import { Links } from '../../views/Links'
import { Header, Rail, SubNav, Tabs, type Section } from './Nav'
import { Home } from './Home'
import { Folder } from './Folder'
import { ModuleFrame } from './ModuleFrame'
import { Crumbs, type Ctx } from './parts'

function sectionOf(app: AppState): Section {
  const { view } = app
  if (view.kind === 'folder') return view.folderId as FolderId
  if (view.kind === 'module') return moduleById(view.moduleId, app.linuxProfile)?.folder ?? null
  if (view.kind === 'dashboard') return null
  return 'app'
}

/** Settings, the module manager and links, framed as pages of the 900 folder. */
function AppPage({ ctx, kind }: { ctx: Ctx; kind: 'manager' | 'settings' | 'links' }) {
  const { app, settings } = ctx
  const page = APP_PAGES.find((p) => p.kind === kind)!
  return (
    <div className="g-page g-app">
      <Crumbs items={[{ label: t('nav.dashboard'), onClick: () => app.setView({ kind: 'dashboard' }) }, { label: page.name }]} />
      <header className="g-phead">
        <span className="g-tag g-tag--big">{page.no}</span>
        <div>
          <h1>{page.name}</h1>
        </div>
      </header>
      <div className="g-sheet">
        {kind === 'manager' && <ModuleManager app={app} />}
        {kind === 'settings' && <Settings app={app} settings={settings} />}
        {kind === 'links' && <Links />}
      </div>
    </div>
  )
}

export function Shell({ app, settings }: ShellProps) {
  const machine = useMachine(settings.settings.refreshMs)
  const reclaim = useReclaim(app)
  const os = app.onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, app.linuxProfile), [os, app.linuxProfile])
  const ctx: Ctx = { app, settings, machine, reclaim, numbers }
  const section = sectionOf(app)
  const { view } = app
  const pageKey = view.kind === 'module' ? view.moduleId : view.kind === 'folder' ? view.folderId : view.kind

  return (
    <div className="g-shell">
      <a className="g-skip" href="#g-content">
        {t('world.gesto.skip')}
      </a>
      <Header ctx={ctx} />
      <Tabs ctx={ctx} section={section} />
      <SubNav ctx={ctx} section={section} />
      <div className="g-body">
        <Rail ctx={ctx} section={section} />
        {/* Keyed so a new page starts at the top instead of the old page's scroll. */}
        <main className="g-content" id="g-content" tabIndex={-1} key={pageKey} data-view={view.kind}>
          {view.kind === 'dashboard' && <Home ctx={ctx} />}
          {view.kind === 'folder' && <Folder ctx={ctx} folderId={view.folderId as FolderId} />}
          {view.kind === 'module' && <ModuleFrame ctx={ctx} moduleId={view.moduleId} />}
          {(view.kind === 'manager' || view.kind === 'settings' || view.kind === 'links') && <AppPage ctx={ctx} kind={view.kind} />}
        </main>
      </div>
      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}
