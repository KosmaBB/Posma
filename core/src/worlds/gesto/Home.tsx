/**
 * Gęsto's home: a portal front page. Every box is a numbered tab with one
 * reading and at most one action; the side column carries notices that are
 * true right now and the folder ranking.
 */
import { DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, size, systemName, usedPct, type DiskInfo } from '../../state/machine'
import { folderNumber, folders, modulesInFolder, orderedModules } from '../../data/modules'
import { locale, t } from '../../i18n'
import { Bar, Box, installedIn, type Ctx } from './parts'

const pct = (v: number) => `${v.toFixed(0)}%`
const mean = (row: number[]) => row.reduce((a, b) => a + b, 0) / (row.length || 1)
const real = (disks: DiskInfo[]) => disks.filter((d) => d.total_bytes > 0)

function Waiting({ ctx }: { ctx: Ctx }) {
  const { error, info } = ctx.machine
  return <p className="g-quiet">{error && !info ? t('world.gesto.home.no-reading', { error }) : t('world.gesto.home.waiting')}</p>
}

/** Readings as polyline points in a 100 × 100 box, the newest at the right edge. */
function linePoints(values: number[]): string {
  const step = 100 / (HISTORY - 1)
  const start = 100 - (values.length - 1) * step
  return values.map((v, i) => `${(start + i * step).toFixed(2)},${(100 - v).toFixed(2)}`).join(' ')
}

/** Kept readings on a 0–100 scale as a line, their peak dashed, a quarter grid behind. */
function Spark({ values }: { values: number[] }) {
  const points = linePoints(values)
  const peak = 100 - Math.max(...values)
  return (
    <svg className="g-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {[25, 50, 75].map((y) => (
        <line key={y} className="grid" x1="0" x2="100" y1={y} y2={y} />
      ))}
      <line className="peak" x1="0" x2="100" y1={peak} y2={peak} />
      <polyline className="mean" points={points} />
    </svg>
  )
}

/** A reading's recent history; the stylesheet shows it only in a wide window. */
function History({ values, what }: { values: number[]; what: string }) {
  if (values.length < 2) return null
  return (
    <div className="g-hist">
      <Spark values={values} />
      <p className="g-legend">
        <span>{t('world.gesto.home.legend.line', { what })}</span>
        <span>{t('world.gesto.home.legend.peak', { n: values.length })}</span>
      </p>
    </div>
  )
}

function CpuBox({ ctx }: { ctx: Ctx }) {
  const { app, settings, machine } = ctx
  const { cpu, record, coreCount } = machine
  const last = record.samples[record.samples.length - 1] ?? []
  const health = app.installedSet.has('health-monitor')
  return (
    <Box
      no="001"
      title={t('world.gesto.cpu')}
      className="g-a-cpu"
      tour="cpu"
      meta={coreCount > 0 ? t('world.gesto.home.cpu.meta', { cores: t('world.gesto.home.cores', { n: coreCount }), every: UP_TO_ONE.format(settings.settings.refreshMs / 1000) }) : undefined}
      more={health ? { label: t('module.health-monitor.name'), onClick: () => app.setView({ kind: 'module', moduleId: 'health-monitor' }) } : undefined}
    >
      {cpu ? (
        <>
          <p className="g-fig">
            {pct(cpu.value)}
            <span>{t('world.gesto.home.cpu.load')}</span>
          </p>
          {last.length > 0 && (
            <div className="g-cores" aria-hidden="true">
              {last.map((v, i) => (
                <i key={i} title={t('world.gesto.home.core', { i, pct: pct(v) })} className={v >= 90 ? 'hot' : undefined}>
                  <b style={{ height: `${Math.max(2, v)}%` }} />
                </i>
              ))}
            </div>
          )}
          {record.samples.length > 1 ? (
            <Spark values={record.samples.map(mean)} />
          ) : (
            <p className="g-spark g-quiet">{t('world.gesto.home.cpu.collecting')}</p>
          )}
          {/* Each core's own history; the stylesheet shows it only in a wide window. */}
          {record.samples.length > 1 && (
            <ol className="g-coregrid">
              {last.map((v, i) => (
                <li key={i} className={v >= 90 ? 'hot' : undefined} title={t('world.gesto.home.core', { i, pct: pct(v) })}>
                  <b>{t('world.gesto.home.core-short', { i })}</b>
                  <span>{pct(v)}</span>
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    <polyline points={linePoints(record.samples.map((s) => s[i] ?? 0))} />
                  </svg>
                </li>
              ))}
            </ol>
          )}
          <p className="g-legend">
            <span>{t('world.gesto.home.cpu.legend')}</span>
            <span>{t('world.gesto.home.legend.peak', { n: record.samples.length })}</span>
          </p>
        </>
      ) : (
        <Waiting ctx={ctx} />
      )}
    </Box>
  )
}

function MemoryBox({ ctx }: { ctx: Ctx }) {
  const { ram, record } = ctx.machine
  return (
    <Box no="002" title={t('world.gesto.memory')} className="g-a-mem">
      {ram ? (
        <>
          <p className="g-fig">
            {pct(ram.value)}
            <span>{t('world.gesto.home.memory.used')}</span>
          </p>
          <Bar pct={ram.value} hot={ram.value >= DISK_WARN_PCT} />
          {ram.detail && <p className="g-sub-fig">{ram.detail}</p>}
          <History values={record.ram} what={t('world.gesto.home.memory.history')} />
        </>
      ) : (
        <Waiting ctx={ctx} />
      )}
    </Box>
  )
}

function TempBox({ ctx }: { ctx: Ctx }) {
  const { metrics, temp, info, record } = ctx.machine
  const temps = metrics.filter((m) => m.kind === 'temperature')
  return (
    <Box no="003" title={t('world.gesto.home.temp')} className="g-a-tmp">
      {temp && (
        <p className="g-fig">
          {temp.value.toFixed(0)}
          <small>°C</small>
          <span>{temp.label.toLocaleLowerCase(locale())}</span>
        </p>
      )}
      {temps.length > 0 ? (
        <ul className="g-kv">
          {temps
            .filter((m) => m !== temp)
            .map((m) => (
              <li key={m.id}>
                <span>{m.label}</span>
                <b>{m.value.toFixed(0)} °C</b>
              </li>
            ))}
        </ul>
      ) : info ? (
        <p className="g-quiet">{t('world.gesto.home.temp.none')}</p>
      ) : (
        <Waiting ctx={ctx} />
      )}
      {temp && <History values={record.temp} what={t('world.gesto.home.temp.history', { label: temp.label.toLocaleLowerCase(locale()) })} />}
    </Box>
  )
}

function DisksBox({ ctx }: { ctx: Ctx }) {
  const { app, machine } = ctx
  const disks = real(machine.disks)
  const mapOn = app.installedSet.has('disk-map')
  return (
    <Box
      no="004"
      title={t('world.gesto.disks')}
      className="g-a-dsk"
      meta={disks.length ? t('world.gesto.home.volumes', { n: disks.length }) : undefined}
      more={mapOn ? { label: t('module.disk-map.name'), onClick: () => app.setView({ kind: 'module', moduleId: 'disk-map' }) } : undefined}
    >
      {disks.length ? (
        <table className="g-disks">
          <thead>
            <tr>
              <th scope="col">{t('world.gesto.home.disks.mount')}</th>
              {/* g-w columns appear only in a wide window. */}
              <th scope="col" className="g-w g-w-dev">{t('world.gesto.home.disks.device')}</th>
              <th scope="col" className="g-w g-w-model">{t('world.gesto.home.disks.model')}</th>
              <th scope="col" className="g-w g-w-kind">{t('world.gesto.home.disks.type')}</th>
              <th scope="col" className="g-w g-w-size">{t('world.gesto.home.disks.size')}</th>
              <th scope="col">{t('world.gesto.home.disks.used')}</th>
              <th scope="col">{t('world.gesto.home.disks.free')}</th>
            </tr>
          </thead>
          <tbody>
            {disks.map((d) => {
              const used = usedPct(d)
              const full = used >= DISK_WARN_PCT
              return (
                <tr key={`${d.name}${d.mount_point}`} className={full ? 'full' : undefined}>
                  <td title={[d.mount_point, d.model].filter(Boolean).join(' · ')}>
                    <span className="g-path">{d.mount_point}</span>
                    {full && <span className="g-badge g-badge--warn">{t('world.gesto.badge.warn')}</span>}
                  </td>
                  <td className="g-w">{d.name}</td>
                  <td className="g-w">{d.model ?? '—'}</td>
                  <td className="g-w">{d.solid_state === undefined ? '—' : d.solid_state ? 'SSD' : 'HDD'}</td>
                  <td className="g-w">{gb(d.total_bytes)}</td>
                  <td>
                    <Bar pct={used} hot={full} />
                    <b>{pct(used)}</b>
                  </td>
                  <td>{gb(d.available_bytes)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <Waiting ctx={ctx} />
      )}
    </Box>
  )
}

function MachineBox({ ctx }: { ctx: Ctx }) {
  const { app, machine } = ctx
  const { mainDisk, ram, coreCount } = machine
  const os = app.onboarding?.os
  const available = os ? orderedModules(os, app.moduleOrder, app.linuxProfile).length : 0
  const rows: [string, string][] = [
    [t('world.gesto.home.machine.system'), systemName(app)],
    [t('world.gesto.cpu'), coreCount ? t('world.gesto.home.cores', { n: coreCount }) : '—'],
    [t('world.gesto.memory'), ram?.detail?.split(' z ')[1] ?? '—'],
    [t('world.gesto.home.machine.main-disk'), mainDisk ? `${mainDisk.model ?? mainDisk.name} · ${gb(mainDisk.total_bytes)}` : '—'],
    [t('world.gesto.home.machine.access'), t(app.onboarding?.accessLevel === 'full' ? 'nav.access.full' : 'nav.access.selective')],
    [t('world.gesto.home.machine.modules'), t('world.gesto.home.machine.modules-value', { on: app.installedSet.size, total: available })],
  ]
  return (
    <Box no="005" title={t('world.gesto.home.machine')} className="g-a-mch" tour="machine">
      <table className="g-spec">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row">{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  )
}

function ReclaimBody({ ctx }: { ctx: Ctx }) {
  const { app, reclaim: r, numbers } = ctx
  const { reclaim, sources } = r
  if (sources.length === 0)
    return (
      <>
        <p className="g-quiet">{t('world.gesto.home.reclaim.none')}</p>
        <button type="button" className="btn btn-ghost btn-mini" onClick={() => app.setView({ kind: 'manager' })}>
          {t('page.manager')}
        </button>
      </>
    )
  if (reclaim.kind === 'scanning')
    return (
      <div className="g-progress" role="status">
        <p>
          {t('world.gesto.home.reclaim.checking')} <b>{reclaim.done}</b> / {sources.length}
        </p>
        <Bar pct={(reclaim.done / sources.length) * 100} />
      </div>
    )
  if (reclaim.kind === 'idle')
    return (
      <>
        <p>{t('world.gesto.home.reclaim.idle')}</p>
        <ul className="g-sources">
          {sources.map((m) => (
            <li key={m.id}>
              <b>{numbers.get(m.id)}</b>
              {m.name}
              <small className="g-w">{m.desc}</small>
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-primary" onClick={r.check}>
          {t('world.gesto.home.reclaim.check')}
        </button>
      </>
    )
  const ranked = [...reclaim.rows].sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1))
  return (
    <>
      <p className="g-fig g-fig--hot" role="status">
        {size(r.total)}
        <span>{t('world.gesto.reclaim').toLocaleLowerCase(locale())}</span>
      </p>
      {ranked.length ? (
        <ol className="g-rank">
          {ranked.map((row, i) => {
            const mod = sources.find((m) => m.id === row.id)
            return (
              <li key={row.id}>
                <button type="button" onClick={() => app.setView({ kind: 'module', moduleId: row.id })}>
                  <i>{i + 1}</i>
                  <b>{numbers.get(row.id)}</b>
                  <span>{mod?.name ?? row.id}</span>
                  {row.error ? <em title={row.error}>{t('world.gesto.unread')}</em> : <strong>{size(row.bytes ?? 0)}</strong>}
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="g-quiet">{t('world.gesto.home.reclaim.nothing')}</p>
      )}
      <button type="button" className="btn btn-ghost btn-mini" onClick={r.check}>
        {t('world.gesto.reclaim.check-again')}
      </button>
    </>
  )
}

function ReclaimBox({ ctx }: { ctx: Ctx }) {
  const { reclaim, sources } = ctx.reclaim
  return (
    <Box
      no="006"
      title={t('world.gesto.reclaim')}
      className="g-a-rec"
      tour="reclaim"
      busy={reclaim.kind === 'scanning'}
      meta={sources.length ? t('world.gesto.home.reclaim.modules', { n: sources.length }) : undefined}
    >
      <ReclaimBody ctx={ctx} />
      <p className="g-note">{t('world.gesto.home.reclaim.note')}</p>
    </Box>
  )
}

function IndexBox({ ctx }: { ctx: Ctx }) {
  const { app, numbers } = ctx
  const actions = orderedModules(app.onboarding?.os, app.moduleOrder, app.linuxProfile).filter(
    (m) => app.installedSet.has(m.id) && m.quickAction,
  )
  return (
    <Box
      no="007"
      title={t('world.gesto.home.quick')}
      className="g-a-idx"
      tour="index"
      more={{ label: t('world.gesto.home.quick.all'), onClick: () => app.setView({ kind: 'manager' }) }}
    >
      {actions.length ? (
        <ul className="g-links">
          {actions.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => app.setView({ kind: 'module', moduleId: m.id })}>
                <b>{numbers.get(m.id)}</b>
                <span>{m.quickAction}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-quiet">{t('world.gesto.home.quick.none')}</p>
      )}
    </Box>
  )
}

function Notices({ ctx }: { ctx: Ctx }) {
  const { app, machine, reclaim } = ctx
  const mapOn = app.installedSet.has('disk-map')
  const full = real(machine.disks).filter((d) => usedPct(d) >= DISK_WARN_PCT)
  const badgeWarn = t('world.gesto.badge.warn')
  const badgeInfo = t('world.gesto.badge.info')
  const badgeNew = t('world.gesto.badge.new')
  const items = [
    ...(machine.error && !machine.info ? [{ key: 'err', badge: badgeWarn, warn: true, text: t('world.gesto.home.notice.error', { error: machine.error }), go: undefined }] : []),
    ...full.map((d) => ({
      key: d.mount_point,
      badge: badgeWarn,
      warn: true,
      text: t('world.gesto.home.notice.full', { mount: d.mount_point, pct: pct(usedPct(d)), free: gb(d.available_bytes) }),
      go: mapOn ? () => app.setView({ kind: 'module', moduleId: 'disk-map' }) : undefined,
    })),
    ...(reclaim.reclaim.kind === 'done' && reclaim.total > 0
      ? [{ key: 'rec', badge: badgeInfo, warn: false, text: t('world.gesto.home.notice.reclaim', { size: size(reclaim.total) }), go: undefined }]
      : []),
    ...(app.onboarding && !app.onboarding.tutorialDone
      ? [{ key: 'tour', badge: badgeNew, warn: false, text: t('world.gesto.home.notice.tour'), go: app.startTour }]
      : []),
  ]
  return (
    <Box no="008" title={t('world.gesto.home.notices')} className="g-a-not" meta={items.length || undefined}>
      {items.length ? (
        <ul className="g-notices">
          {items.map((n) => (
            <li key={n.key}>
              <span className={n.warn ? 'g-badge g-badge--warn' : n.badge === badgeNew ? 'g-badge g-badge--new' : 'g-badge'}>{n.badge}</span>
              {n.go ? (
                <button type="button" className="g-link" onClick={n.go}>
                  {n.text}
                </button>
              ) : (
                <span>{n.text}</span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="g-quiet">{t('world.gesto.home.notices.none')}</p>
      )}
    </Box>
  )
}

function FoldersBox({ ctx }: { ctx: Ctx }) {
  const { app, reclaim } = ctx
  const done = reclaim.reclaim.kind === 'done'
  return (
    <Box no="009" title={t('world.gesto.home.folders')} className="g-a-fld">
      <ul className="g-folders">
        {folders.map((f) => {
          const on = installedIn(ctx, f.id)
          const all = modulesInFolder(f.id, app.onboarding?.os, app.linuxProfile).length
          const bytes = on.reduce((acc, m) => acc + (reclaim.foundOf(m.id)?.bytes ?? 0), 0)
          return (
            <li key={f.id}>
              <button type="button" onClick={() => app.setView({ kind: 'folder', folderId: f.id })}>
                <b>{folderNumber(f.id)}</b>
                <span>{f.name}</span>
                {done && bytes > 0 && <strong>{size(bytes)}</strong>}
                <em>
                  {on.length}/{all}
                </em>
              </button>
            </li>
          )
        })}
      </ul>
    </Box>
  )
}

export function Home({ ctx }: { ctx: Ctx }) {
  return (
    <div className="g-page g-home">
      <div className="g-mosaic">
        <CpuBox ctx={ctx} />
        <MemoryBox ctx={ctx} />
        <TempBox ctx={ctx} />
        <MachineBox ctx={ctx} />
        <ReclaimBox ctx={ctx} />
        <DisksBox ctx={ctx} />
        <IndexBox ctx={ctx} />
      </div>
      <aside className="g-side" aria-label={t('world.gesto.home.aside')}>
        <Notices ctx={ctx} />
        <FoldersBox ctx={ctx} />
      </aside>
    </div>
  )
}
