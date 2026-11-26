import { useMemo, useState } from 'react'
import type { AppState } from '../state/appState'
import { applyOrder, catalogNumbers, folderNumber, folders, modulesInFolder, riskLabel } from '../data/modules'
import { t } from '../i18n'
import { Icon } from '../components/Icons'

/**
 * Everything in one folder, installed or not — the browsing surface, where
 * the sidebar is a jump list of installed modules only. Also how a module
 * shipped in an update becomes visible without opening the manager.
 */
export function FolderView({ app, folderId }: { app: AppState; folderId: string }) {
  const { installedSet, setModuleInstalled, setView, onboarding, moduleOrder, setFolderOrder } = app
  const folder = folders.find((f) => f.id === folderId)

  /** Index being dragged, and the slot it is currently hovering over. */
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)
  /** Card that has just landed, so it can play its settle animation once. */
  const [settling, setSettling] = useState<string | null>(null)
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, app.linuxProfile), [os, app.linuxProfile])

  if (!folder) {
    return (
      <div className="glass empty-state">
        {t('folder-view.missing')}
        <br />
        <button className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>
          {t('folder-view.back')}
        </button>
      </div>
    )
  }

  const items = applyOrder(modulesInFolder(folder.id, onboarding?.os, app.linuxProfile), moduleOrder[folder.id])
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

  const codeVar = { '--code': folder.gradient.g1 } as React.CSSProperties

  return (
    <div className="view-enter" style={codeVar}>
      <button className="back-link" onClick={() => setView({ kind: 'dashboard' })}>
        <span className="back-link__arrow" aria-hidden="true">
          <Icon name="chevron" />
        </span>
        {t('nav.dashboard')}
      </button>

      <header className="folder-head glass">
        <span className="folder-head__no">{folderNumber(folder.id)}</span>
        <div>
          <h1 className="folder-head__name">
            <span className="code" />
            {folder.name}
          </h1>
          <p className="folder-head__count">
            {t('folder-view.enabled', { n: installed.length, total: items.length })}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="glass empty-state">
          {t('folder-view.empty')}
        </div>
      ) : (
        <div className="cat-list" data-tour="folder-list">
          {items.map((m, i) => {
            const on = installedSet.has(m.id)
            return (
              <article
                key={m.id}
                className="cat-row folder-card"
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
                // Whole row opens the module. Only when it is switched on:
                // enabling is a change to the user's setup and should not
                // happen from a stray click on the body of a row.
                onClick={on ? () => setView({ kind: 'module', moduleId: m.id }) : undefined}
              >
                <span className="folder-card__grip" aria-hidden="true" title={t('folder-view.drag')} />
                <span className="cat-row__no">{numbers.get(m.id)}</span>
                <div>
                  <h2 className="cat-row__name">{m.name}</h2>
                  <p className="cat-row__desc">{m.desc}</p>
                </div>
                <span className={`chip ${m.risk}`}>{riskLabel[m.risk]}</span>
                <div className="cat-row__actions">
                  {on ? (
                    <button
                      className="btn btn-primary btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        setView({ kind: 'module', moduleId: m.id })
                      }}
                    >
                      {m.quickAction ?? t('common.open')}
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        setModuleInstalled(m.id, true)
                      }}
                    >
                      {t('folder-view.enable')}
                    </button>
                  )}
                  {on && (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        setModuleInstalled(m.id, false)
                      }}
                      title={t('folder-view.disable.title')}
                    >
                      {t('folder-view.disable')}
                    </button>
                  )}
                </div>
                <span className="code" />
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
