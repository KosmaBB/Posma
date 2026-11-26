import { useMemo } from 'react'
import type { AppState } from '../../state/appState'
import { applyOrder, catalogNumbers, folders, modulesInFolder, riskLabel } from '../../data/modules'
import { t } from '../../i18n'
import { Pair } from './pairs'

/** One folder: how many modules it holds, then the table that proves it. */
export function Folder({ app, folderId }: { app: AppState; folderId: string }) {
  const { installedSet, setModuleInstalled, setView, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const folder = folders.find((f) => f.id === folderId)

  if (!folder) {
    return (
      <div className="mono-pairs">
        <Pair
          id="mono-folder"
          claim={<h1>{t('world.monochrom.folder.missing')}</h1>}
          proof={<button className="btn btn-ghost" onClick={() => setView({ kind: 'dashboard' })}>{t('world.monochrom.back')}</button>}
        />
      </div>
    )
  }

  const items = applyOrder(modulesInFolder(folder.id, os, linuxProfile), moduleOrder[folder.id])
  const on = items.filter((m) => installedSet.has(m.id)).length
  const n = items.length
  const open = (id: string) => setView({ kind: 'module', moduleId: id })

  return (
    <div className="mono-pairs">
      <Pair
        id="mono-folder"
        stack
        claim={
          <>
            <h1>{n ? t('world.monochrom.folder.title', { name: folder.name, n }) : t('world.monochrom.folder.title-empty', { name: folder.name })}</h1>
            <p>
              {n
                ? t('world.monochrom.folder.enabled', { on, n })
                : t('world.monochrom.folder.empty')}
            </p>
          </>
        }
        proof={
          n > 0 && (
            <div className="mono-shot">
              <table className="mono-table mono-table--modules" data-tour="folder-list">
                <thead>
                  <tr>
                    <th className="mono-col-no">{t('world.monochrom.folder.col.no')}</th>
                    <th>{t('world.monochrom.folder.col.module')}</th>
                    <th>{t('world.monochrom.folder.col.risk')}</th>
                    <th className="num">{t('world.monochrom.folder.col.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((m) => {
                    const enabled = installedSet.has(m.id)
                    return (
                      <tr key={m.id} className={enabled ? 'mono-table__go' : 'mono-table__off'} onClick={enabled ? () => open(m.id) : undefined}>
                        <td className="mono-col-no"><span className="mono-no">{numbers.get(m.id)}</span></td>
                        <td>
                          <b className="mono-table__name">{m.name}</b>
                          <span className="mono-table__desc">{m.desc}</span>
                        </td>
                        <td><span className={`chip ${m.risk}`}>{riskLabel[m.risk]}</span></td>
                        <td className="num">
                          <span className="mono-row-actions">
                            {enabled ? (
                              <>
                                <button className="btn btn-ghost btn-mini" onClick={(e) => { e.stopPropagation(); open(m.id) }}>
                                  {m.quickAction ?? t('common.open')}
                                </button>
                                <button
                                  className="btn btn-ghost btn-mini mono-quiet-btn"
                                  title={t('world.monochrom.folder.hide-title')}
                                  onClick={(e) => { e.stopPropagation(); setModuleInstalled(m.id, false) }}
                                >
                                  {t('world.monochrom.folder.hide')}
                                </button>
                              </>
                            ) : (
                              <button className="btn btn-ghost btn-mini" onClick={() => setModuleInstalled(m.id, true)}>{t('world.monochrom.folder.show')}</button>
                            )}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      />
    </div>
  )
}
