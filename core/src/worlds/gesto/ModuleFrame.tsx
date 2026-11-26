/**
 * A module in Gęsto: a results page. Breadcrumb, a red-numbered header, the
 * module's own body in the main column and a slim column of context beside
 * it: what the last reclaim check found here, the disks, the folder's other
 * modules.
 */
import { ModuleBody } from '../../views/ModuleView'
import { folderNumber, folders, moduleById, riskLabel } from '../../data/modules'
import { DISK_WARN_PCT, size, usedPct } from '../../state/machine'
import { t } from '../../i18n'
import { Bar, Box, Crumbs, installedIn, type Ctx } from './parts'

function ReclaimSide({ ctx, id }: { ctx: Ctx; id: string }) {
  const { reclaim } = ctx
  if (!reclaim.sources.some((m) => m.id === id)) return null
  const hit = reclaim.foundOf(id)
  const state = reclaim.reclaim.kind
  return (
    <Box no="006" title={t('world.gesto.reclaim')}>
      {state === 'done' ? (
        hit?.error ? (
          <p className="g-quiet" title={hit.error}>
            {t('world.gesto.reclaim.unread-module')}
          </p>
        ) : (
          <p className="g-fig g-fig--hot">
            {size(hit?.bytes ?? 0)}
            <span>{t('world.gesto.reclaim.default-choice')}</span>
          </p>
        )
      ) : (
        <p className="g-quiet" role="status">
          {state === 'scanning' ? t('world.gesto.reclaim.checking-ellipsis') : t('world.gesto.reclaim.never-checked')}
        </p>
      )}
      {state !== 'scanning' && (
        <button type="button" className="btn btn-ghost btn-mini" onClick={reclaim.check}>
          {state === 'done' ? t('world.gesto.reclaim.check-again') : t('world.gesto.reclaim.check-now')}
        </button>
      )}
    </Box>
  )
}

function DisksSide({ ctx }: { ctx: Ctx }) {
  const disks = ctx.machine.disks.filter((d) => d.total_bytes > 0)
  if (!disks.length) return null
  return (
    <Box no="004" title={t('world.gesto.disks')}>
      <ul className="g-mini-disks">
        {disks.map((d) => {
          const used = usedPct(d)
          return (
            <li key={`${d.name}${d.mount_point}`} title={d.mount_point}>
              <span className="g-path">{d.mount_point}</span>
              <b className={used >= DISK_WARN_PCT ? 'hot' : undefined}>{used.toFixed(0)}%</b>
              <Bar pct={used} hot={used >= DISK_WARN_PCT} />
            </li>
          )
        })}
      </ul>
    </Box>
  )
}

export function ModuleFrame({ ctx, moduleId }: { ctx: Ctx; moduleId: string }) {
  const { app, numbers } = ctx
  const mod = moduleById(moduleId, app.linuxProfile)
  const home = () => app.setView({ kind: 'dashboard' })
  if (!mod)
    return (
      <div className="g-page">
        <div className="g-box g-empty">
          <p>{t('world.gesto.module.missing')}</p>
          <button type="button" className="btn btn-primary" onClick={home}>
            {t('world.gesto.module.back')}
          </button>
        </div>
      </div>
    )
  const folder = folders.find((f) => f.id === mod.folder)!
  const siblings = installedIn(ctx, mod.folder).filter((m) => m.id !== mod.id)

  return (
    <div className="g-page g-split">
      <div className="g-main">
        <Crumbs
          items={[
            { label: t('nav.dashboard'), onClick: home },
            { label: folder.name, onClick: () => app.setView({ kind: 'folder', folderId: folder.id }) },
            { label: mod.name },
          ]}
        />
        <div className="g-mod" data-tour="module">
          <header className="g-phead g-phead--mod" data-tour="module-hero">
            <span className="g-tag g-tag--big">{numbers.get(mod.id) ?? '—'}</span>
            <div>
              <h1>{mod.name}</h1>
              <p>{mod.desc}</p>
            </div>
            <span className={`chip ${mod.risk}`}>{riskLabel[mod.risk]}</span>
          </header>
          <ModuleBody app={app} mod={mod} />
        </div>
      </div>

      <aside className="g-side" aria-label={t('world.gesto.module.aside')}>
        <ReclaimSide ctx={ctx} id={mod.id} />
        <DisksSide ctx={ctx} />
        <Box
          no={folderNumber(folder.id)}
          title={t('world.gesto.module.also-in', { folder: folder.name })}
          more={{ label: t('world.gesto.module.folder'), onClick: () => app.setView({ kind: 'folder', folderId: folder.id }) }}
        >
          {siblings.length ? (
            <ul className="g-links g-links--one">
              {siblings.map((m) => (
                <li key={m.id}>
                  <button type="button" onClick={() => app.setView({ kind: 'module', moduleId: m.id })}>
                    <b>{numbers.get(m.id)}</b>
                    <span>{m.name}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="g-quiet">{t('world.gesto.module.only-one')}</p>
          )}
        </Box>
      </aside>
    </div>
  )
}
