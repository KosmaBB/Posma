import { useState } from 'react'
import type { AppState } from '../state/appState'
import { applyOrder, folders, modulesInFolder, riskLabel } from '../data/modules'
import { Icon } from '../components/Icons'

/**
 * Everything in one folder, installed or not.
 *
 * This is deliberately not what the sidebar does. The sidebar is a jump
 * list: installed modules only, names only. This is the browsing surface —
 * it shows what the folder *could* hold, what each module does and what it
 * would be allowed to touch, and lets a module be switched on without a
 * detour through the manager.
 *
 * That also fixes a real gap: a module shipped in an update was invisible
 * until the user happened to open the module manager.
 */
export function FolderView({ app, folderId }: { app: AppState; folderId: string }) {
  const { installedSet, setModuleInstalled, setView, onboarding, moduleOrder, setFolderOrder } = app
  const folder = folders.find((f) => f.id === folderId)

  /** Index being dragged, and the slot it is currently hovering over. */
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  /** Card that has just landed, so it can play its settle animation once. */
  const [settling, setSettling] = useState<string | null>(null)

  if (!folder) {
    return (
      <div className="glass empty-state">
        Nie ma takiego folderu.
        <br />
        <button className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>
          Wróć na pulpit
        </button>
      </div>
    )
  }

  const items = applyOrder(modulesInFolder(folder.id, onboarding?.os), moduleOrder[folder.id])
  const installed = items.filter((m) => installedSet.has(m.id))

  /** Moves the dragged card into the slot it was dropped on and stores it. */
  function drop(target: number) {
    if (dragging === null || dragging === target) return
    const next = [...items]
    const [moved] = next.splice(dragging, 1)
    next.splice(target, 0, moved)
    setFolderOrder(folder!.id, next.map((m) => m.id))
    setDragging(null)
    setOver(null)
    // Cleared after the animation so the class does not stick and block a
    // second drop of the same card.
    setSettling(moved.id)
    window.setTimeout(() => setSettling((cur) => (cur === moved.id ? null : cur)), 500)
  }

  const gradientVars = {
    '--g1': folder.gradient.g1,
    '--g2': folder.gradient.g2,
  } as React.CSSProperties

  return (
    <div className="view-enter">
      <button className="back-link" onClick={() => setView({ kind: 'dashboard' })}>
        <span className="back-link__arrow" aria-hidden="true">
          <Icon name="chevron" />
        </span>
        Pulpit
      </button>

      <header className="folder-head glass" style={gradientVars}>
        <span className="folder-head__ico" style={gradientVars}>
          <Icon name={folder.icon} />
        </span>
        <div>
          <h1 className="folder-head__name">{folder.name}</h1>
          <p className="folder-head__count">
            {installed.length} z {items.length}{' '}
            {items.length === 1 ? 'modułu włączony' : 'modułów włączonych'}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="glass empty-state">
          W tym folderze nie ma jeszcze modułów dla Twojego systemu.
        </div>
      ) : (
        <div className="module-grid">
          {items.map((m, i) => {
            const on = installedSet.has(m.id)
            return (
              <article
                key={m.id}
                className="glass folder-card"
                data-on={on}
                data-dragging={dragging === i}
                data-over={over === i && dragging !== i}
                data-settling={settling === m.id}
                draggable
                onDragStart={(e) => {
                  setDragging(i)
                  e.dataTransfer.effectAllowed = 'move'
                  // Firefox refuses to start a drag without payload.
                  e.dataTransfer.setData('text/plain', m.id)
                }}
                onDragEnd={() => {
                  setDragging(null)
                  setOver(null)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (over !== i) setOver(i)
                }}
                onDragLeave={() => setOver((cur) => (cur === i ? null : cur))}
                onDrop={(e) => {
                  e.preventDefault()
                  drop(i)
                }}
                // Whole card opens the module. Only when it is switched on:
                // enabling is a change to the user's setup and should not
                // happen from a stray click on the body of a card.
                onClick={on ? () => setView({ kind: 'module', moduleId: m.id }) : undefined}
              >
                <span className="folder-card__grip" aria-hidden="true" title="Przeciągnij, aby zmienić kolejność">
                  ⠿
                </span>
                <div className="folder-card__top">
                  <span className="ico-badge" style={gradientVars}>
                    <Icon name={m.icon} />
                  </span>
                  <span className={`chip ${m.risk}`}>
                    {m.risk === 'critical' ? '⚠ ' : ''}
                    {riskLabel[m.risk]}
                  </span>
                </div>

                <h2 className="folder-card__name">{m.name}</h2>
                <p className="folder-card__desc">{m.desc}</p>

                <div className="folder-card__foot">
                  {on ? (
                    <button
                      className="btn btn-primary btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        setView({ kind: 'module', moduleId: m.id })
                      }}
                    >
                      {m.quickAction ?? 'Otwórz'}
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        setModuleInstalled(m.id, true)
                      }}
                    >
                      Włącz moduł
                    </button>
                  )}

                  {on && (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        setModuleInstalled(m.id, false)
                      }}
                      title="Ukryj ten moduł — pliki zostają na dysku"
                    >
                      Wyłącz
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
