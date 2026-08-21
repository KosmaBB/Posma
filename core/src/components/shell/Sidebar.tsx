import { useState } from 'react'
import type { AppState } from '../../state/appState'
import { folders, modulesInFolder } from '../../data/modules'
import { Icon } from '../Icons'

export function Sidebar({ app }: { app: AppState }) {
  const { view, setView, installedSet, onboarding } = app
  const [openFolders, setOpenFolders] = useState<Set<string>>(() => new Set(['data']))

  function toggleFolder(id: string) {
    setOpenFolders((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const os = onboarding?.os

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <b>POSMA</b>
        <span>v0.1.0</span>
      </div>

      <button
        className={`nav-item${view.kind === 'dashboard' ? ' active' : ''}`}
        onClick={() => setView({ kind: 'dashboard' })}
      >
        <span className="nav-ico" style={{ '--g1': 'var(--g-teal-1)', '--g2': 'var(--g-blue-2)' } as React.CSSProperties}>
          <Icon name="dashboard" />
        </span>
        Pulpit
      </button>

      <div className="sidebar-section">Moduły</div>
      {folders.map((folder) => {
        const items = modulesInFolder(folder.id, os).filter((m) => installedSet.has(m.id))
        const open = openFolders.has(folder.id)
        return (
          <div key={folder.id}>
            <button
              className={`nav-item${view.kind === 'folder' && view.folderId === folder.id ? ' active' : ''}`}
              onClick={() => {
                // Opens the folder and shows it. Expanding alone left the
                // click doing nothing when the folder was already open, and
                // the inline list only ever holds the installed modules.
                toggleFolder(folder.id)
                setView({ kind: 'folder', folderId: folder.id })
              }}
              aria-expanded={open}
            >
              <span className="nav-ico" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
                <Icon name={folder.icon} />
              </span>
              {folder.name}
              <span className="count">{items.length}</span>
              <span className={`chevron${open ? ' open' : ''}`}>
                <Icon name="chevron" className="chev-svg" />
              </span>
            </button>
            {open && (
              <div className="nav-children">
                {items.length === 0 && <span className="nav-child" style={{ cursor: 'default', opacity: 0.6 }}>brak zainstalowanych</span>}
                {items.map((m) => (
                  <button
                    key={m.id}
                    className={`nav-child${view.kind === 'module' && view.moduleId === m.id ? ' active' : ''}`}
                    style={{ '--g1': folder.gradient.g1 } as React.CSSProperties}
                    onClick={() => setView({ kind: 'module', moduleId: m.id })}
                  >
                    <span className="dot" />
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}

      <div className="sidebar-section">Aplikacja</div>
      <button className={`nav-item${view.kind === 'manager' ? ' active' : ''}`} onClick={() => setView({ kind: 'manager' })}>
        <span className="nav-ico plain"><Icon name="manager" /></span>
        Zarządzanie modułami
      </button>
      <button className={`nav-item${view.kind === 'settings' ? ' active' : ''}`} onClick={() => setView({ kind: 'settings' })}>
        <span className="nav-ico plain"><Icon name="settings" /></span>
        Ustawienia
      </button>
      <button className={`nav-item${view.kind === 'links' ? ' active' : ''}`} onClick={() => setView({ kind: 'links' })}>
        <span className="nav-ico plain"><Icon name="links" /></span>
        Linki
      </button>

      <div className="sidebar-foot">
        <span>{os ? { windows: 'Windows', linux: 'Linux', macos: 'macOS' }[os] : '—'}</span>
        <span>{onboarding?.accessLevel === 'full' ? 'pełny dostęp' : 'wybiórczy'}</span>
      </div>
    </aside>
  )
}
