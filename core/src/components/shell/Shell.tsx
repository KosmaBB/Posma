import type { AppState } from '../../state/appState'
import { FolderView } from '../../views/FolderView'
import { catalogNumbers, folderNumber, folders, moduleById } from '../../data/modules'
import { APP_PAGES, Sidebar } from './Sidebar'
import { Dashboard } from '../../views/Dashboard'
import { ModuleManager } from '../../views/ModuleManager'
import { Settings } from '../../views/Settings'
import type { SettingsState } from '../../state/settings'
import { Links } from '../../views/Links'
import { ModuleView } from '../../views/ModuleView'
import { Tour } from '../tour/Tour'
import { t } from '../../i18n'

function viewTitle(app: AppState): { no: string; title: string; crumb: string } {
  const { view } = app
  switch (view.kind) {
    case 'dashboard':
      return { no: '000', title: t('nav.dashboard'), crumb: 'posma://dashboard' }
    case 'manager':
    case 'settings':
    case 'links': {
      const page = APP_PAGES.find((p) => p.kind === view.kind)!
      const path = view.kind === 'manager' ? 'modules' : view.kind
      return { no: page.no, title: page.name, crumb: `posma://${path}` }
    }
    case 'module': {
      const mod = moduleById(view.moduleId, app.linuxProfile)
      const no = catalogNumbers(app.onboarding?.os, app.linuxProfile).get(view.moduleId) ?? '—'
      return { no, title: mod?.name ?? t('shell.module'), crumb: `posma://module/${view.moduleId}` }
    }
    case 'folder': {
      const folder = folders.find((f) => f.id === view.folderId)
      const no = folder ? folderNumber(folder.id) : '—'
      return { no, title: folder?.name ?? t('shell.folder'), crumb: `posma://folder/${view.folderId}` }
    }
  }
}

export function Shell({ app, settings }: { app: AppState; settings: SettingsState }) {
  const { view } = app
  const { no, title, crumb } = viewTitle(app)

  return (
    <div className="shell">
      <Sidebar app={app} />
      <div className="main">
        <div className="topbar">
          <span className="topbar-no">{no}</span>
          <h1>{title}</h1>
          <span className="crumb">{crumb}</span>
        </div>
        <div className="content" data-view={view.kind}>
          {view.kind === 'dashboard' && <Dashboard app={app} settings={settings} />}
          {view.kind === 'manager' && <ModuleManager app={app} />}
          {view.kind === 'settings' && <Settings app={app} settings={settings} />}
          {view.kind === 'links' && <Links />}
          {view.kind === 'module' && <ModuleView app={app} moduleId={view.moduleId} />}
          {view.kind === 'folder' && <FolderView app={app} folderId={view.folderId} />}
        </div>
      </div>
      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}
