import type { AppState } from '../../state/appState'
import { FolderView } from '../../views/FolderView'
import { folders, modules } from '../../data/modules'
import { Sidebar } from './Sidebar'
import { Dashboard } from '../../views/Dashboard'
import { ModuleManager } from '../../views/ModuleManager'
import { Settings } from '../../views/Settings'
import type { SettingsState } from '../../state/settings'
import { Links } from '../../views/Links'
import { ModuleView } from '../../views/ModuleView'

function viewTitle(app: AppState): { title: string; crumb: string } {
  const { view } = app
  switch (view.kind) {
    case 'dashboard':
      return { title: 'Pulpit', crumb: 'posma://dashboard' }
    case 'manager':
      return { title: 'Zarządzanie modułami', crumb: 'posma://modules' }
    case 'settings':
      return { title: 'Ustawienia', crumb: 'posma://settings' }
    case 'links':
      return { title: 'Linki', crumb: 'posma://links' }
    case 'module': {
      const mod = modules.find((m) => m.id === view.moduleId)
      return { title: mod?.name ?? 'Moduł', crumb: `posma://module/${view.moduleId}` }
    }
    case 'folder': {
      const folder = folders.find((f) => f.id === view.folderId)
      return { title: folder?.name ?? 'Folder', crumb: `posma://folder/${view.folderId}` }
    }
  }
}

export function Shell({ app, settings }: { app: AppState; settings: SettingsState }) {
  const { view } = app
  const { title, crumb } = viewTitle(app)

  return (
    <div className="shell">
      <Sidebar app={app} />
      <div className="main">
        <div className="topbar">
          <div>
            <h1>{title}</h1>
            <div className="crumb">{crumb}</div>
          </div>
          <div className="topbar-right" />
        </div>
        <div className="content">
          <div className="content-wash" aria-hidden />
          {view.kind === 'dashboard' && <Dashboard app={app} settings={settings} />}
          {view.kind === 'manager' && <ModuleManager app={app} />}
          {view.kind === 'settings' && <Settings app={app} settings={settings} />}
          {view.kind === 'links' && <Links />}
          {view.kind === 'module' && <ModuleView app={app} moduleId={view.moduleId} />}
          {view.kind === 'folder' && <FolderView app={app} folderId={view.folderId} />}
        </div>
      </div>
    </div>
  )
}
