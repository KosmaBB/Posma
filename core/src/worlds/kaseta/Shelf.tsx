import { useMemo, type CSSProperties } from 'react'
import type { AppState } from '../../state/appState'
import { applyOrder, catalogNumbers, folderNumber, folders, modulesInFolder, type ModuleDef } from '../../data/modules'
import { APP_PAGES } from '../../components/shell/Sidebar'

interface SpineProps {
  no: string
  name: string
  value?: string | null
  current?: boolean
  onClick: () => void
}

/** One cassette on the shelf: number, hand-written name, a reading, the folder's colour band. */
function Spine({ no, name, value, current, onClick }: SpineProps) {
  return (
    <button type="button" className="ks-spine" aria-current={current ? 'page' : undefined} title={name} onClick={onClick}>
      <span className="ks-spine__no">{no}</span>
      <span className="ks-spine__name">{name}</span>
      {value && <span className="ks-spine__val">{value}</span>}
      <span className="ks-spine__code" aria-hidden="true" />
    </button>
  )
}

/**
 * The shelf: one spine per enabled module, grouped by folder, in the order
 * the folder page holds. It is also the index — each spine carries the
 * module's latest reading — and the app's own pages sit apart below it.
 */
export function Shelf({ app, reading }: { app: AppState; reading: (m: ModuleDef) => string | null }) {
  const { view, setView, installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])

  return (
    <nav className="ks-shelf" aria-label="Półka z kasetami">
      <Spine no="000" name="Pulpit" current={view.kind === 'dashboard'} onClick={() => setView({ kind: 'dashboard' })} />

      {folders.map((folder) => {
        const all = modulesInFolder(folder.id, os, linuxProfile)
        if (all.length === 0) return null
        const items = applyOrder(all, moduleOrder[folder.id]).filter((m) => installedSet.has(m.id))
        return (
          <section key={folder.id} className="ks-shelf__group" style={{ '--code': folder.gradient.g1 } as CSSProperties}>
            <button
              type="button"
              className="ks-shelf__label"
              data-tour="folder"
              aria-current={view.kind === 'folder' && view.folderId === folder.id ? 'page' : undefined}
              onClick={() => setView({ kind: 'folder', folderId: folder.id })}
            >
              <span>{folderNumber(folder.id)}</span>
              {folder.name}
            </button>
            <div className="ks-shelf__spines" data-tour="index">
              {items.length === 0 ? (
                <span className="ks-shelf__empty">żadnej włączonej kasety</span>
              ) : (
                items.map((m) => (
                  <Spine
                    key={m.id}
                    no={numbers.get(m.id) ?? '—'}
                    name={m.name}
                    value={reading(m)}
                    current={view.kind === 'module' && view.moduleId === m.id}
                    onClick={() => setView({ kind: 'module', moduleId: m.id })}
                  />
                ))
              )}
            </div>
          </section>
        )
      })}

      <div className="ks-shelf__app">
        {APP_PAGES.map((p) => (
          <button
            key={p.kind}
            type="button"
            className="ks-applink"
            aria-current={view.kind === p.kind ? 'page' : undefined}
            onClick={() => setView({ kind: p.kind })}
          >
            <span>{p.no}</span>
            {p.name}
          </button>
        ))}
        <button type="button" className="ks-applink" data-tour="tour" onClick={app.startTour}>
          <span>904</span>
          Samouczek
        </button>
      </div>
    </nav>
  )
}
