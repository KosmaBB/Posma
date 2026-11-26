/**
 * A folder in Gęsto is a category results page: one dense row per module,
 * its number, what it does, how risky it is, what it already knows and the
 * one thing to do with it.
 */
import { applyOrder, folderNumber, folders, modulesInFolder, riskLabel, type FolderId } from '../../data/modules'
import { size } from '../../state/machine'
import { t } from '../../i18n'
import { Box, Crumbs, readingOf, type Ctx } from './parts'

export function Folder({ ctx, folderId }: { ctx: Ctx; folderId: FolderId }) {
  const { app, numbers, reclaim } = ctx
  const folder = folders.find((f) => f.id === folderId)
  const mods = applyOrder(modulesInFolder(folderId, app.onboarding?.os, app.linuxProfile), app.moduleOrder[folderId])
  const on = mods.filter((m) => app.installedSet.has(m.id))
  const bytes = on.reduce((acc, m) => acc + (reclaim.foundOf(m.id)?.bytes ?? 0), 0)
  const home = () => app.setView({ kind: 'dashboard' })
  if (!folder) return <p className="g-page g-quiet">{t('world.gesto.folder.missing')}</p>

  return (
    <div className="g-page g-split">
      <div className="g-main">
        <Crumbs items={[{ label: t('nav.dashboard'), onClick: home }, { label: folder.name }]} />
        <header className="g-phead">
          <span className="g-tag g-tag--big">{folderNumber(folderId)}</span>
          <div>
            <h1>{folder.name}</h1>
            <p>
              {t('world.gesto.folder.summary', { modules: t('world.gesto.folder.modules', { n: mods.length }), enabled: t('world.gesto.folder.enabled', { n: on.length }) })}
            </p>
          </div>
        </header>

        <Box no={folderNumber(folderId)} title={t('world.gesto.folder.box')} meta={t('world.gesto.folder.results', { n: mods.length })}>
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
                    <span className={r?.hot ? 'g-row__fig hot' : 'g-row__fig'}>{isOn ? r?.text ?? '' : t('world.gesto.folder.off')}</span>
                    <div className="g-row__act">
                      {isOn ? (
                        <>
                          <button type="button" className="btn btn-primary btn-mini" onClick={open}>
                            {m.quickAction ?? t('common.open')}
                          </button>
                          <button type="button" className="btn btn-ghost btn-mini" onClick={() => app.setModuleInstalled(m.id, false)}>
                            {t('world.gesto.folder.disable')}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-ghost btn-mini" onClick={() => app.setModuleInstalled(m.id, true)}>
                          {t('world.gesto.folder.enable')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="g-quiet" data-tour="folder-list">
              {t('world.gesto.folder.none')}
            </p>
          )}
        </Box>
      </div>

      <aside className="g-side" aria-label={t('world.gesto.folder.aside')}>
        <Box no={folderNumber(folderId)} title={t('world.gesto.folder.this')}>
          <table className="g-spec">
            <tbody>
              <tr>
                <th scope="row">{t('world.gesto.folder.enabled-head')}</th>
                <td>
                  {t('world.gesto.folder.enabled-of', { on: on.length, total: mods.length })}
                </td>
              </tr>
              {reclaim.sources.some((m) => m.folder === folderId) && (
                <tr>
                  <th scope="row">{t('world.gesto.reclaim')}</th>
                  <td className={bytes > 0 ? 'hot' : undefined}>{reclaim.reclaim.kind === 'done' ? size(bytes) : t('world.gesto.folder.not-checked')}</td>
                </tr>
              )}
            </tbody>
          </table>
        </Box>
        <Box no="?" title={t('world.gesto.folder.help')}>
          <p>{t('world.gesto.folder.help.text')}</p>
          <button type="button" className="g-link" onClick={() => app.setView({ kind: 'manager' })}>
            {t('world.gesto.folder.manager-link')}
          </button>
        </Box>
      </aside>
    </div>
  )
}
