import type { AppState } from '../state/appState'
import { folders, modules, riskLabel } from '../data/modules'
import { Icon } from '../components/Icons'
import { TempCleanView } from './modules/TempCleanView'
import { DuplicatesView } from './modules/DuplicatesView'
import { BigFilesView } from './modules/BigFilesView'
import { AutostartView } from './modules/AutostartView'
import { ShredderView } from './modules/ShredderView'
import { MetadataView } from './modules/MetadataView'
import { DiskMapView } from './modules/DiskMapView'
import { BrowserHygieneView } from './modules/BrowserHygieneView'
import { HealthMonitorView } from './modules/HealthMonitorView'
import { UninstallerView } from './modules/UninstallerView'
import { VaultView } from './modules/VaultView'
import { JournaldTrimView } from './modules/JournaldTrimView'
import { PkgCacheView } from './modules/PkgCacheView'
import { KernelMgrView } from './modules/KernelMgrView'
import { GrubEditorView } from './modules/GrubEditorView'
import { DesktopThemeView } from './modules/DesktopThemeView'

/** Modules with a real UI — everything else falls back to the placeholder. */
const MODULE_VIEWS: Record<string, () => React.ReactElement> = {
  'temp-clean': TempCleanView,
  duplicates: DuplicatesView,
  'big-files': BigFilesView,
  autostart: AutostartView,
  shredder: ShredderView,
  metadata: MetadataView,
  'disk-map': DiskMapView,
  'browser-hygiene': BrowserHygieneView,
  'health-monitor': HealthMonitorView,
  uninstaller: UninstallerView,
  vault: VaultView,
  'journald-trim': JournaldTrimView,
  'pkg-cache': PkgCacheView,
  'kernel-mgr': KernelMgrView,
  'grub-editor': GrubEditorView,
  'desktop-theme': DesktopThemeView,
}

/** Generic placeholder page for an installed module — real module UIs replace this per-module. */
export function ModuleView({ app, moduleId }: { app: AppState; moduleId: string }) {
  const { setView } = app
  const mod = modules.find((m) => m.id === moduleId)
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
        <ActiveModuleView key={mod.id} />
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
