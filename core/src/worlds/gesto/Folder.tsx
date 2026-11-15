/**
 * A folder in Gęsto is a category results page: one dense row per module,
 * its number, what it does, how risky it is, what it already knows and the
 * one thing to do with it.
 */
import { applyOrder, folderNumber, folders, modulesInFolder, riskLabel, type FolderId } from '../../data/modules'
import { plural, size } from '../../state/machine'
import { Box, Crumbs, readingOf, type Ctx } from './parts'

export function Folder({ ctx, folderId }: { ctx: Ctx; folderId: FolderId }) {
  const { app, numbers, reclaim } = ctx
  const folder = folders.find((f) => f.id === folderId)
  const mods = applyOrder(modulesInFolder(folderId, app.onboarding?.os, app.linuxProfile), app.moduleOrder[folderId])
  const on = mods.filter((m) => app.installedSet.has(m.id))
  const bytes = on.reduce((acc, m) => acc + (reclaim.foundOf(m.id)?.bytes ?? 0), 0)
  const home = () => app.setView({ kind: 'dashboard' })
  if (!folder) return <p className="g-page g-quiet">Nie ma takiego folderu.</p>

  return (
    <div className="g-page g-split">
      <div className="g-main">
        <Crumbs items={[{ label: 'Pulpit', onClick: home }, { label: folder.name }]} />
        <header className="g-phead">
          <span className="g-tag g-tag--big">{folderNumber(folderId)}</span>
          <div>
            <h1>{folder.name}</h1>
            <p>
              {mods.length} {plural(mods.length, 'moduł', 'moduły', 'modułów')} dla tego systemu, {on.length} {plural(on.length, 'włączony', 'włączone', 'włączonych')}
            </p>
          </div>
        </header>

        <Box no={folderNumber(folderId)} title="Moduły w folderze" meta={`${mods.length} ${plural(mods.length, 'wynik', 'wyniki', 'wyników')}`}>
          {mods.length ? (
            <ul className="g-rows" data-tour="folder-list">
              {mods.map((m) => {
                const isOn = app.installedSet.has(m.id)
                const open = () => app.setView({ kind: 'module', moduleId: m.id })
                const r = isOn ? readingOf(m, ctx) : null
                return (
                  <li key={m.id} className="g-row" data-on={isOn}>
                    <b className="g-row__no">{numbers.get(m.id)}</b>
                    <div className="g-row__text">
                      {isOn ? (
                        <button type="button" className="g-row__name" onClick={open}>
                          {m.name}
                        </button>
                      ) : (
                        <span className="g-row__name">{m.name}</span>
                      )}
                      <p>{m.desc}</p>
                    </div>
                    <span className={`chip ${m.risk}`}>{riskLabel[m.risk]}</span>
                    <span className={r?.hot ? 'g-row__fig hot' : 'g-row__fig'}>{isOn ? r?.text ?? '' : 'wyłączony'}</span>
                    <div className="g-row__act">
                      {isOn ? (
                        <>
                          <button type="button" className="btn btn-primary btn-mini" onClick={open}>
                            {m.quickAction ?? 'Otwórz'}
                          </button>
                          <button type="button" className="btn btn-ghost btn-mini" onClick={() => app.setModuleInstalled(m.id, false)}>
                            Wyłącz
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => app.setModuleInstalled(m.id, true)}>
                          Włącz moduł
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="g-quiet" data-tour="folder-list">
              W tym folderze nie ma modułów dla tego systemu.
            </p>
          )}
        </Box>
      </div>

      <aside className="g-side" aria-label="O folderze">
        <Box no={folderNumber(folderId)} title="Ten folder">
          <table className="g-spec">
            <tbody>
              <tr>
                <th scope="row">Włączone</th>
                <td>
                  {on.length} z {mods.length}
                </td>
              </tr>
              {reclaim.sources.some((m) => m.folder === folderId) && (
                <tr>
                  <th scope="row">Do odzyskania</th>
                  <td className={bytes > 0 ? 'hot' : undefined}>{reclaim.reclaim.kind === 'done' ? size(bytes) : 'nie sprawdzono'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Box>
        <Box no="?" title="Pomoc">
          <p>Wyłączony moduł znika z menu i z pulpitu. Włączysz go z powrotem tutaj albo w zarządzaniu modułami.</p>
          <button type="button" className="g-link" onClick={() => app.setView({ kind: 'manager' })}>
            901 Zarządzanie modułami
          </button>
        </Box>
      </aside>
    </div>
  )
}
