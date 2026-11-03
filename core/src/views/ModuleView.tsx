import type { AppState } from '../state/appState'
import { folders, moduleById, riskLabel } from '../data/modules'
import { lazy, Suspense } from 'react'
import { Icon } from '../components/Icons'

type ViewProps = { app: AppState }

/** A module's code is loaded the first time it is opened, not with the window. */
function lazyView<K extends string>(load: () => Promise<Record<K, React.ComponentType<ViewProps>>>, name: K) {
  return lazy(() => load().then((m) => ({ default: m[name] })))
}

/**
 * Modules with a real UI — everything else falls back to the placeholder.
 *
 * Typed as taking the app state so a module can navigate; a view that has
 * no use for it stays declared with no parameters, which TypeScript accepts
 * where more are passed.
 */
const MODULE_VIEWS: Record<string, React.ComponentType<ViewProps>> = {
  'temp-clean': lazyView(() => import('./modules/TempCleanView'), 'TempCleanView'),
  duplicates: lazyView(() => import('./modules/DuplicatesView'), 'DuplicatesView'),
  'big-files': lazyView(() => import('./modules/BigFilesView'), 'BigFilesView'),
  autostart: lazyView(() => import('./modules/AutostartView'), 'AutostartView'),
  shredder: lazyView(() => import('./modules/ShredderView'), 'ShredderView'),
  metadata: lazyView(() => import('./modules/MetadataView'), 'MetadataView'),
  'disk-map': lazyView(() => import('./modules/DiskMapView'), 'DiskMapView'),
  'browser-hygiene': lazyView(() => import('./modules/BrowserHygieneView'), 'BrowserHygieneView'),
  'health-monitor': lazyView(() => import('./modules/HealthMonitorView'), 'HealthMonitorView'),
  uninstaller: lazyView(() => import('./modules/UninstallerView'), 'UninstallerView'),
  vault: lazyView(() => import('./modules/VaultView'), 'VaultView'),
  'journald-trim': lazyView(() => import('./modules/JournaldTrimView'), 'JournaldTrimView'),
  'pkg-cache': lazyView(() => import('./modules/PkgCacheView'), 'PkgCacheView'),
  'kernel-mgr': lazyView(() => import('./modules/KernelMgrView'), 'KernelMgrView'),
  'grub-editor': lazyView(() => import('./modules/GrubEditorView'), 'GrubEditorView'),
  'desktop-theme': lazyView(() => import('./modules/DesktopThemeView'), 'DesktopThemeView'),
  'xcode-cache': lazyView(() => import('./modules/XcodeCacheView'), 'XcodeCacheView'),
  'time-machine': lazyView(() => import('./modules/TimeMachineView'), 'TimeMachineView'),
  bloatware: lazyView(() => import('./modules/BloatwareView'), 'BloatwareView'),
  services: lazyView(() => import('./modules/ServicesView'), 'ServicesView'),
  winsxs: lazyView(() => import('./modules/WinsxsView'), 'WinsxsView'),
  'winget-ui': lazyView(() => import('./modules/WingetView'), 'WingetView'),
}

/** Generic placeholder page for an installed module — real module UIs replace this per-module. */
export function ModuleView({ app, moduleId }: { app: AppState; moduleId: string }) {
  const { setView } = app
  const mod = moduleById(moduleId, app.linuxProfile)
  if (!mod) {
    return (
      <div className="view-enter">
        <div className="glass empty-state">
          Nie znaleziono modułu.
          <br />
          <button className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>Wróć na pulpit</button>
        </div>
      </div>
    )
  }
  const folder = folders.find((f) => f.id === mod.folder)!
  const ActiveModuleView = MODULE_VIEWS[mod.id]

  return (
    <div className="view-enter">
      <div className="glass module-hero" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
        <div className="ico-badge" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
          <Icon name={mod.icon} />
        </div>
        <div>
          <h2>{mod.name}</h2>
          <div className="mh-desc">{mod.desc}</div>
        </div>
        <span className={`chip ${mod.risk}`} style={{ marginLeft: 'auto' }}>{riskLabel[mod.risk]}</span>
      </div>
      {ActiveModuleView ? (
        <Suspense fallback={null}>
          <ActiveModuleView key={mod.id} app={app} />
        </Suspense>
      ) : (
        <div className="glass placeholder-body">
          Interfejs modułu „{mod.name}" powstanie w kolejnych etapach —
          <br />
          tu trafi właściwe UI skanowania, podglądu i akcji tego modułu.
        </div>
      )}
    </div>
  )
}
