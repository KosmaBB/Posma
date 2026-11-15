import type { ShellProps } from '../index'
import type { AppState } from '../../state/appState'
import {
  applyOrder,
  catalogNumbers,
  folderNumber,
  folders,
  moduleById,
  modulesInFolder,
  riskLabel,
  type FolderId,
} from '../../data/modules'
import { APP_PAGES } from '../../components/shell/Sidebar'
import { Tour } from '../../components/tour/Tour'
import { ModuleBody } from '../../views/ModuleView'
import { ModuleManager } from '../../views/ModuleManager'
import { Settings } from '../../views/Settings'
import { Links } from '../../views/Links'
import { Home } from './Home'

/**
 * The whole window: navigation, then one view at a time. Every view kind has
 * to be handled here; a module's own interface is shared (ModuleBody), and so
 * are settings, the module manager and links.
 */
export function Shell({ app, settings }: ShellProps) {
  const { view, setView, onboarding, linuxProfile } = app
  const os = onboarding?.os
  // A folder with nothing for this system would only lead to an empty page.
  const shown = folders.filter((f) => modulesInFolder(f.id, os, linuxProfile).length > 0)
  const openFolder =
    view.kind === 'folder' ? view.folderId : view.kind === 'module' ? moduleById(view.moduleId, linuxProfile)?.folder : null

  return (
    <div className="st-shell">
      <header className="st-bar">
        <button className="st-brand" onClick={() => setView({ kind: 'dashboard' })}>
          POSMA
        </button>
        <nav className="st-nav" aria-label="Sekcje">
          <button aria-current={view.kind === 'dashboard' ? 'page' : undefined} onClick={() => setView({ kind: 'dashboard' })}>
            Pulpit
          </button>
          {shown.map((f) => (
            <button
              key={f.id}
              data-tour="folder"
              aria-current={openFolder === f.id ? 'page' : undefined}
              onClick={() => setView({ kind: 'folder', folderId: f.id })}
            >
              {f.name}
            </button>
          ))}
          {APP_PAGES.map((p) => (
            <button key={p.kind} aria-current={view.kind === p.kind ? 'page' : undefined} onClick={() => setView({ kind: p.kind })}>
              {p.name}
            </button>
          ))}
        </nav>
        <button className="btn btn-ghost btn-mini" data-tour="tour" onClick={app.startTour}>
          Samouczek
        </button>
      </header>

      <main className="st-main">
        {view.kind === 'dashboard' && <Home app={app} settings={settings} />}
        {view.kind === 'folder' && <Folder app={app} folderId={view.folderId as FolderId} />}
        {view.kind === 'module' && <Module app={app} moduleId={view.moduleId} />}
        {view.kind === 'settings' && <Settings app={app} settings={settings} />}
        {view.kind === 'manager' && <ModuleManager app={app} />}
        {view.kind === 'links' && <Links />}
      </main>

      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}

/** The switched-on modules of one folder, in the order the person set. */
function Folder({ app, folderId }: { app: AppState; folderId: FolderId }) {
  const { onboarding, linuxProfile, installedSet, moduleOrder, setView } = app
  const folder = folders.find((f) => f.id === folderId)
  if (!folder) return <p className="st-empty">Nie ma takiego folderu.</p>
  const numbers = catalogNumbers(onboarding?.os, linuxProfile)
  const mods = applyOrder(modulesInFolder(folderId, onboarding?.os, linuxProfile), moduleOrder[folderId]).filter((m) =>
    installedSet.has(m.id),
  )

  return (
    <section className="st-page">
      <h1>
        <span className="st-no">{folderNumber(folderId)}</span> {folder.name}
      </h1>
      {mods.length === 0 ? (
        <p className="st-empty">Żaden moduł z tego folderu nie jest włączony. Włączysz je w Zarządzaniu modułami.</p>
      ) : (
        <ul className="st-list" data-tour="folder-list">
          {mods.map((m) => (
            <li key={m.id}>
              <button className="st-list__name" onClick={() => setView({ kind: 'module', moduleId: m.id })}>
                <span className="st-no">{numbers.get(m.id)}</span> {m.name}
              </button>
              <p>{m.desc}</p>
              <span className="chip">{riskLabel[m.risk]}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** A module: its name and description, then its own interface. */
function Module({ app, moduleId }: { app: AppState; moduleId: string }) {
  const mod = moduleById(moduleId, app.linuxProfile)
  if (!mod) return <p className="st-empty">Nie znaleziono modułu.</p>
  const no = catalogNumbers(app.onboarding?.os, app.linuxProfile).get(mod.id)

  // The tour points at the second child of [data-tour="module"]: keep the interface there.
  return (
    <section className="st-page" data-tour="module">
      <header data-tour="module-hero">
        <h1>
          <span className="st-no">{no}</span> {mod.name}
        </h1>
        <p>{mod.desc}</p>
      </header>
      <div className="st-body">
        <ModuleBody app={app} mod={mod} />
      </div>
    </section>
  )
}
