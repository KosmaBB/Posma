import { useMemo, useState } from 'react'
import { version } from '../../../package.json'
import type { AppState } from '../../state/appState'
import { applyOrder, catalogNumbers, folderNumber, folders, modulesInFolder } from '../../data/modules'
import { t } from '../../i18n'
import { Icon } from '../Icons'

/** The app's own pages sit after the module folders, in their own hundred. */
export const APP_PAGES = [
  { kind: 'manager', no: '901', get name() { return t('page.manager') } },
  { kind: 'settings', no: '902', get name() { return t('page.settings') } },
  { kind: 'links', no: '903', get name() { return t('page.links') } },
] as const

export function Sidebar({ app }: { app: AppState }) {
  const { view, setView, installedSet, onboarding, moduleOrder, linuxProfile } = app
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(['data']))
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])

  function toggleFolder(id: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <b>POSMA</b>
        <span>v{version}</span>
      </div>

      <button
        className={`nav-item${view.kind === 'dashboard' ? ' active' : ''}`}
        onClick={() => setView({ kind: 'dashboard' })}
      >
        <span className="nav-no">000</span>
        {t('nav.dashboard')}
      </button>

      {folders.map((folder) => {
        const all = modulesInFolder(folder.id, os, linuxProfile)
        // Same arrangement the folder view holds, so a card dragged there
        // moves here too — this list is a third window onto it, not a
        // separate one that happened to match.
        const items = applyOrder(all, moduleOrder[folder.id]).filter((m) => installedSet.has(m.id))
        const open = openFolders.has(folder.id)
        return (
          <div key={folder.id}>
            <button
              className={`nav-folder${view.kind === 'folder' && view.folderId === folder.id ? ' active' : ''}`}
              data-tour="folder"
              onClick={() => {
                // Opens the folder and shows it. Expanding alone left the
                // click doing nothing when the folder was already open, and
                // the inline list only ever holds the installed modules.
                toggleFolder(folder.id)
                setView({ kind: 'folder', folderId: folder.id })
              }}
              aria-expanded={open}
            >
              <span className="nav-no">{folderNumber(folder.id)}</span>
              <span className="nav-folder__name">{folder.name}</span>
              <span className="code" style={{ '--code': folder.gradient.g1 } as React.CSSProperties} />
              <span className={`chevron${open ? ' open' : ''}`}>
                <Icon name="chevron" />
              </span>
            </button>
            {open && (
              <div className="nav-children">
                {items.length === 0 && <span className="nav-empty">{t('nav.none-enabled')}</span>}
                {items.map((m) => (
                  <button
                    key={m.id}
                    className={`nav-child${view.kind === 'module' && view.moduleId === m.id ? ' active' : ''}`}
                    onClick={() => setView({ kind: 'module', moduleId: m.id })}
                  >
                    <span className="nav-no">{numbers.get(m.id)}</span>
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="nav-folder nav-folder--static">
        <span className="nav-no">900</span>
        <span className="nav-folder__name">{t('nav.app')}</span>
      </div>
      {APP_PAGES.map((p) => (
        <button key={p.kind} className={`nav-child${view.kind === p.kind ? ' active' : ''}`} onClick={() => setView({ kind: p.kind })}>
          <span className="nav-no">{p.no}</span>
          {p.name}
        </button>
      ))}
      <button className="nav-child" data-tour="tour" onClick={app.startTour}>
        <span className="nav-no">904</span>
        {t('nav.tour')}
      </button>

      <div className="sidebar-foot">
        <span>{os === 'linux' && linuxProfile ? linuxProfile.name : os ? { windows: 'Windows', linux: 'Linux', macos: 'macOS' }[os] : '—'}</span>
        <span>{t(onboarding?.accessLevel === 'full' ? 'nav.access.full' : 'nav.access.selective')}</span>
      </div>
    </aside>
  )
}
