/**
 * Gęsto's home: a portal front page. Every box is a numbered tab with one
 * reading and at most one action; the side column carries notices that are
 * true right now and the folder ranking.
 */
import { DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, plural, size, systemName, usedPct, type DiskInfo } from '../../state/machine'
import { folderNumber, folders, modulesInFolder, orderedModules } from '../../data/modules'
import { Bar, Box, installedIn, type Ctx } from './parts'

const pct = (v: number) => `${v.toFixed(0)}%`
const mean = (row: number[]) => row.reduce((a, b) => a + b, 0) / (row.length || 1)
const real = (disks: DiskInfo[]) => disks.filter((d) => d.total_bytes > 0)

function Waiting({ ctx }: { ctx: Ctx }) {
  const { error, info } = ctx.machine
  return <p className="g-quiet">{error && !info ? `Brak odczytu: ${error}` : 'Czekam na pierwszy odczyt…'}</p>
}

/** Mean load over the kept readings, its peak dashed, a quarter grid behind. */
function Spark({ samples }: { samples: number[][] }) {
  const means = samples.map(mean)
  const step = 100 / (HISTORY - 1)
  const start = 100 - (means.length - 1) * step
  const points = means.map((v, i) => `${(start + i * step).toFixed(2)},${(100 - v).toFixed(2)}`).join(' ')
  const peak = 100 - Math.max(...means)
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

function CpuBox({ ctx }: { ctx: Ctx }) {
  const { app, settings, machine } = ctx
  const { cpu, record, coreCount } = machine
  const last = record.samples[record.samples.length - 1] ?? []
  const health = app.installedSet.has('health-monitor')
  return (
    <Box
      no="001"
      title="Procesor"
      className="g-a-cpu"
      tour="cpu"
      meta={coreCount > 0 ? `${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')} · co ${UP_TO_ONE.format(settings.settings.refreshMs / 1000)} s` : undefined}
      more={health ? { label: 'Monitor zdrowia', onClick: () => app.setView({ kind: 'module', moduleId: 'health-monitor' }) } : undefined}
    >
      {cpu ? (
        <>
          <p className="g-fig">
            {pct(cpu.value)}
            <span>obciążenie średnio</span>
          </p>
          {last.length > 0 && (
            <div className="g-cores" aria-hidden="true">
              {last.map((v, i) => (
                <i key={i} title={`Rdzeń ${i}: ${pct(v)}`} className={v >= 90 ? 'hot' : undefined}>
                  <b style={{ height: `${Math.max(2, v)}%` }} />
                </i>
              ))}
            </div>
          )}
          {record.samples.length > 1 ? (
            <Spark samples={record.samples} />
          ) : (
            <p className="g-spark g-quiet">Zbieram odczyty do wykresu…</p>
          )}
          <p className="g-legend">
            <span>linia: średnia ze wszystkich rdzeni</span>
            <span>kreski: szczyt z {record.samples.length} odczytów</span>
          </p>
        </>
      ) : (
        <Waiting ctx={ctx} />
      )}
    </Box>
  )
}

function MemoryBox({ ctx }: { ctx: Ctx }) {
  const { ram } = ctx.machine
  return (
    <Box no="002" title="Pamięć" className="g-a-mem">
      {ram ? (
        <>
          <p className="g-fig">
            {pct(ram.value)}
            <span>zajęte</span>
          </p>
          <Bar pct={ram.value} hot={ram.value >= DISK_WARN_PCT} />
          {ram.detail && <p className="g-sub-fig">{ram.detail}</p>}
        </>
      ) : (
        <Waiting ctx={ctx} />
      )}
    </Box>
  )
}

function TempBox({ ctx }: { ctx: Ctx }) {
  const { metrics, temp, info } = ctx.machine
  const temps = metrics.filter((m) => m.kind === 'temperature')
  return (
    <Box no="003" title="Temperatury" className="g-a-tmp">
      {temp && (
        <p className="g-fig">
          {temp.value.toFixed(0)}
          <small>°C</small>
          <span>{temp.label.toLocaleLowerCase('pl')}</span>
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
        <p className="g-quiet">Czujniki nie podają temperatury.</p>
      ) : (
        <Waiting ctx={ctx} />
      )}
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
      title="Dyski"
      className="g-a-dsk"
      meta={disks.length ? `${disks.length} ${plural(disks.length, 'wolumin', 'woluminy', 'woluminów')}` : undefined}
      more={mapOn ? { label: 'Mapa dysków', onClick: () => app.setView({ kind: 'module', moduleId: 'disk-map' }) } : undefined}
    >
      {disks.length ? (
        <table className="g-disks">
          <thead>
            <tr>
              <th scope="col">Punkt montowania</th>
              <th scope="col">Zajęte</th>
              <th scope="col">Wolne</th>
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
                    {full && <span className="g-badge g-badge--warn">Uwaga</span>}
                  </td>
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
    ['System', systemName(app)],
    ['Procesor', coreCount ? `${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}` : '—'],
    ['Pamięć', ram?.detail?.split(' z ')[1] ?? '—'],
    ['Dysk główny', mainDisk ? `${mainDisk.model ?? mainDisk.name} · ${gb(mainDisk.total_bytes)}` : '—'],
    ['Dostęp', app.onboarding?.accessLevel === 'full' ? 'pełny' : 'wybiórczy'],
    ['Moduły', `${app.installedSet.size} z ${available} włączonych`],
  ]
  return (
    <Box no="005" title="Ten komputer" className="g-a-mch" tour="machine">
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
        <p className="g-quiet">Żaden włączony moduł nie zwalnia miejsca na dysku.</p>
        <button type="button" className="btn btn-ghost btn-mini" onClick={() => app.setView({ kind: 'manager' })}>
          Zarządzanie modułami
        </button>
      </>
    )
  if (reclaim.kind === 'scanning')
    return (
      <div className="g-progress" role="status">
        <p>
          Sprawdzam <b>{reclaim.done}</b> / {sources.length}
        </p>
        <Bar pct={(reclaim.done / sources.length) * 100} />
      </div>
    )
  if (reclaim.kind === 'idle')
    return (
      <>
        <p>Moduły czyszczące policzą, ile miejsca zwolnią ich domyślne wybory.</p>
        <ul className="g-sources">
          {sources.map((m) => (
            <li key={m.id}>
              <b>{numbers.get(m.id)}</b>
              {m.name}
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-primary" onClick={r.check}>
          Sprawdź, co da się odzyskać
        </button>
      </>
    )
  const ranked = [...reclaim.rows].sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1))
  return (
    <>
      <p className="g-fig g-fig--hot" role="status">
        {size(r.total)}
        <span>do odzyskania</span>
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
                  {row.error ? <em title={row.error}>nie odczytano</em> : <strong>{size(row.bytes ?? 0)}</strong>}
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="g-quiet">Moduły nie znalazły nic do odzyskania.</p>
      )}
      <button type="button" className="btn btn-ghost btn-mini" onClick={r.check}>
        Sprawdź ponownie
      </button>
    </>
  )
}

function ReclaimBox({ ctx }: { ctx: Ctx }) {
  const { reclaim, sources } = ctx.reclaim
  return (
    <Box
      no="006"
      title="Do odzyskania"
      className="g-a-rec"
      tour="reclaim"
      busy={reclaim.kind === 'scanning'}
      meta={sources.length ? `${sources.length} ${plural(sources.length, 'moduł', 'moduły', 'modułów')}` : undefined}
    >
      <ReclaimBody ctx={ctx} />
      <p className="g-note">Tylko odczyt. Usuwasz w module, po jego potwierdzeniu.</p>
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
      title="Szybkie akcje"
      className="g-a-idx"
      tour="index"
      more={{ label: 'Wszystkie moduły', onClick: () => app.setView({ kind: 'manager' }) }}
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
        <p className="g-quiet">Żaden włączony moduł nie ma szybkiej akcji.</p>
      )}
    </Box>
  )
}

function Notices({ ctx }: { ctx: Ctx }) {
  const { app, machine, reclaim } = ctx
  const mapOn = app.installedSet.has('disk-map')
  const full = real(machine.disks).filter((d) => usedPct(d) >= DISK_WARN_PCT)
  const items = [
    ...(machine.error && !machine.info ? [{ key: 'err', badge: 'Uwaga', warn: true, text: `Odczyt systemu nie działa: ${machine.error}`, go: undefined }] : []),
    ...full.map((d) => ({
      key: d.mount_point,
      badge: 'Uwaga',
      warn: true,
      text: `${d.mount_point} zajęty w ${pct(usedPct(d))}, wolne ${gb(d.available_bytes)}.`,
      go: mapOn ? () => app.setView({ kind: 'module', moduleId: 'disk-map' }) : undefined,
    })),
    ...(reclaim.reclaim.kind === 'done' && reclaim.total > 0
      ? [{ key: 'rec', badge: 'Info', warn: false, text: `Do odzyskania ${size(reclaim.total)} w modułach czyszczących.`, go: undefined }]
      : []),
    ...(app.onboarding && !app.onboarding.tutorialDone
      ? [{ key: 'tour', badge: 'Nowe', warn: false, text: 'Samouczek pokaże, gdzie co jest.', go: app.startTour }]
      : []),
  ]
  return (
    <Box no="008" title="Komunikaty" meta={items.length || undefined}>
      {items.length ? (
        <ul className="g-notices">
          {items.map((n) => (
            <li key={n.key}>
              <span className={n.warn ? 'g-badge g-badge--warn' : n.badge === 'Nowe' ? 'g-badge g-badge--new' : 'g-badge'}>{n.badge}</span>
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
        <p className="g-quiet">Brak komunikatów.</p>
      )}
    </Box>
  )
}

function FoldersBox({ ctx }: { ctx: Ctx }) {
  const { app, reclaim } = ctx
  const done = reclaim.reclaim.kind === 'done'
  return (
    <Box no="009" title="Foldery">
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
      <aside className="g-side" aria-label="Komunikaty i foldery">
        <Notices ctx={ctx} />
        <FoldersBox ctx={ctx} />
      </aside>
    </div>
  )
}
