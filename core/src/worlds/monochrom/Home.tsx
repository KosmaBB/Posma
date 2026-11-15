import { useMemo } from 'react'
import type { ShellProps } from '../index'
import { catalogNumbers, moduleById, orderedModules } from '../../data/modules'
import { CpuProfile } from '../../components/CpuProfile'
import {
  DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, plural, size, useMachine, useReclaim, usedPct,
  type DiskInfo, type Machine, type Metric, type ReclaimState,
} from '../../state/machine'
import { Pair, PairRail, Shot } from './pairs'

const NB = ' '
/** Keeps a figure and its unit on one line inside a claim. */
const nb = (s: string) => s.replace(/ /g, NB)
const pct = (n: number) => `${Math.round(n)}${NB}%`

/** Below this the processor is resting, above the second it is busy. */
const CPU_RESTING = 15
const CPU_BUSY = 60

const RAIL = [
  { id: 'mono-disk', label: 'Dysk' },
  { id: 'mono-reclaim', label: 'Do odzyskania' },
  { id: 'mono-cpu', label: 'Procesor' },
  { id: 'mono-memory', label: 'Pamięć' },
  { id: 'mono-shortcuts', label: 'Skróty' },
]

export function Home({ app, settings }: ShellProps) {
  const refreshMs = settings.settings.refreshMs
  const machine = useMachine(refreshMs)
  const reclaim = useReclaim(app)
  const every = `odczyt co ${UP_TO_ONE.format(refreshMs / 1000)}${NB}s`

  return (
    <>
      <div className="mono-pairs">
        <DiskPair machine={machine} every={every} />
        <ReclaimPair app={app} reclaim={reclaim} />
        <CpuPair machine={machine} settings={settings} every={every} />
        <MemoryPair machine={machine} />
        <ShortcutsPair app={app} reclaim={reclaim} />
      </div>
      <PairRail items={RAIL} />
    </>
  )
}

/* ------------------------------------------------------------------ dysk */

function DiskPair({ machine, every }: { machine: Machine; every: string }) {
  const { info, error, disks, mainDisk, crowded } = machine
  // Empty mounts (overlays, pseudo file systems) report 0 bytes and say nothing about space.
  const real = disks.filter((d) => d.total_bytes > 0 && d !== mainDisk)
  const disksInOrder = mainDisk ? [mainDisk, ...real] : real
  const what = (d: DiskInfo) => d.model ?? d.mount_point
  let claim: string
  let sub: string
  if (mainDisk) {
    const full = usedPct(mainDisk) >= DISK_WARN_PCT
    claim = `Na dysku systemowym zostało ${full ? 'tylko ' : ''}${nb(gb(mainDisk.available_bytes))}.`
    sub = `${pct(usedPct(mainDisk))} z ${nb(gb(mainDisk.total_bytes))} zajęte.`
    if (crowded.length === 1) sub += ` Dysk ${what(crowded[0])} jest pełny w ${pct(usedPct(crowded[0]))}.`
    if (crowded.length > 1) sub += ` Prawie pełne są też: ${crowded.map(what).join(', ')}.`
  } else if (error) {
    claim = 'Nie udało się odczytać stanu maszyny.'
    sub = 'Moduł system-info nie odpowiada. Kolejna próba przy następnym odczycie.'
  } else if (info) {
    claim = 'Nie widać żadnego dysku.'
    sub = 'system-info nie zgłosił żadnego nośnika.'
  } else {
    claim = 'Czytam stan maszyny…'
    sub = 'Pierwszy odczyt zwykle trwa sekundę.'
  }

  return (
    <Pair
      id="mono-disk"
      proofTour="machine"
      claim={
        <>
          <h1>{claim}</h1>
          <p>{sub}</p>
        </>
      }
      proof={
        <Shot title="Dyski" note={every}>
          {disksInOrder.length === 0 && <div className="mono-empty">{error ? 'Brak odczytu.' : <span className="mono-ghost" />}</div>}
          {disksInOrder.map((d) => (
            <DiskRow key={d.mount_point} disk={d} main={d === mainDisk} />
          ))}
        </Shot>
      }
    />
  )
}

function DiskRow({ disk, main }: { disk: DiskInfo; main: boolean }) {
  const used = usedPct(disk)
  const full = used >= DISK_WARN_PCT
  const what = main ? 'dysk systemowy' : disk.model ?? disk.name
  return (
    <div className={`mono-disk${full ? ' mono-disk--full' : ''}`}>
      <div className="mono-disk__name">
        <b title={disk.mount_point}>{disk.mount_point}</b>
        <small>
          {full && <span className="mono-flag">prawie pełny · </span>}
          {what} · {gb(disk.total_bytes - disk.available_bytes).replace(' GB', '')} z {gb(disk.total_bytes)}
        </small>
      </div>
      <div className="mono-meter" role="img" aria-label={`Zajęte ${Math.round(used)} procent`}>
        <i style={{ width: `${Math.min(100, used)}%` }} />
      </div>
      <div className="mono-disk__pct">{pct(used)}</div>
    </div>
  )
}

/* ----------------------------------------------------------- odzyskanie */

function ReclaimPair({ app, reclaim }: { app: ShellProps['app']; reclaim: ReclaimState }) {
  const { reclaim: state, sources, check, found, total } = reclaim
  const numbers = useMemo(() => catalogNumbers(app.onboarding?.os, app.linuxProfile), [app.onboarding?.os, app.linuxProfile])
  const n = sources.length
  const hits = found.filter((r) => (r.bytes ?? 0) > 0).sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0))
  const failed = found.filter((r) => r.error)
  const top = hits[0] && moduleById(hits[0].id, app.linuxProfile)
  const max = hits[0]?.bytes ?? 1
  const open = (id: string) => app.setView({ kind: 'module', moduleId: id })

  let title: string
  let sub: string
  if (n === 0) {
    title = 'Żaden włączony moduł nie liczy miejsca do odzyskania.'
    sub = 'Włącz Czyszczenie Temp albo cache pakietów w zarządzaniu modułami.'
  } else if (state.kind === 'idle') {
    title = 'Sprawdź, ile da się odzyskać.'
    sub = `${n} ${plural(n, 'moduł policzy', 'moduły policzą', 'modułów policzy')}, ile miejsca zwolni. To tylko odczyt — nic nie zostanie usunięte.`
  } else if (state.kind === 'scanning') {
    title = `Sprawdzam… ${state.done} z ${n}.`
    sub = 'Każdy moduł tylko czyta swoje miejsca.'
  } else if (total > 0) {
    title = `Da się odzyskać około ${nb(size(total))}.`
    sub = `${plural(n, 'Sprawdził', 'Sprawdziły', 'Sprawdziło')} ${n} ${plural(n, 'moduł', 'moduły', 'modułów')}, nic jeszcze nie usunięto.`
    if (failed.length) sub += ` ${failed.length} ${plural(failed.length, 'nie odpowiedział', 'nie odpowiedziały', 'nie odpowiedziało')}.`
  } else {
    title = failed.length ? 'Nie udało się nic policzyć.' : 'Nie ma nic do odzyskania.'
    sub = failed.length ? 'Moduły nie odpowiedziały — spróbuj ponownie.' : 'Każdy sprawdzony moduł ma czysto.'
  }

  const rows = state.kind === 'done' ? found : sources.map((m) => ({ id: m.id, bytes: null, error: null }))
  return (
    <Pair
      id="mono-reclaim"
      flip
      tour="reclaim"
      claim={
        <>
          <h2>{title}</h2>
          <p>{sub}</p>
          <div className="mono-actions">
            {n === 0 && (
              <button className="btn btn-ghost" onClick={() => app.setView({ kind: 'manager' })}>Zarządzaj modułami</button>
            )}
            {n > 0 && state.kind === 'idle' && <button className="btn btn-primary" onClick={check}>Sprawdź, co da się odzyskać</button>}
            {state.kind === 'done' && top && (
              <button className="btn btn-primary" onClick={() => open(top.id)}>Otwórz {top.name}</button>
            )}
            {state.kind === 'done' && <button className="btn btn-ghost" onClick={check}>Sprawdź ponownie</button>}
          </div>
        </>
      }
      proof={
        <Shot
          title="Do odzyskania"
          note={state.kind === 'scanning' ? <span className="mono-run" aria-hidden="true" /> : state.kind === 'done' ? 'tylko odczyt' : 'nic jeszcze nie sprawdzono'}
          foot={state.kind === 'done' && total > 0 ? <>Razem<strong>{size(total)}</strong></> : undefined}
        >
          {rows.length === 0 ? (
            <div className="mono-empty">Brak modułów, które liczą miejsce.</div>
          ) : (
            <table className="mono-table">
              <thead>
                <tr><th>Moduł</th><th className="num">Do odzyskania</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const m = moduleById(r.id, app.linuxProfile)
                  return (
                    <tr key={r.id} className="mono-table__go" onClick={() => open(r.id)}>
                      <td>
                        <button className="mono-link" onClick={(e) => { e.stopPropagation(); open(r.id) }}>
                          <span className="mono-no">{numbers.get(r.id)}</span>{m?.name ?? r.id}
                        </button>
                      </td>
                      <td className="num">
                        {r.error ? (
                          <span className="mono-err" title={r.error}>nie odpowiedział</span>
                        ) : r.bytes === null ? (
                          <span className="mono-quiet">{state.kind === 'scanning' ? 'liczę…' : '—'}</span>
                        ) : (
                          <>
                            <span className="mono-sizebar" aria-hidden="true"><i style={{ width: `${Math.max(2, ((r.bytes ?? 0) / max) * 100)}%` }} /></span>
                            <b>{size(r.bytes)}</b>
                          </>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </Shot>
      }
    />
  )
}

/* ------------------------------------------------------------- procesor */

function CpuPair({ machine, settings, every }: { machine: Machine; settings: ShellProps['settings']; every: string }) {
  const { cpu, temp, record, coreCount, error } = machine
  const last = record.samples[record.samples.length - 1] ?? []
  const busiest = last.length ? Math.max(...last) : null
  const v = cpu?.value ?? null
  const claim =
    v === null
      ? error ? 'Procesor nie odpowiada na odczyt.' : 'Czytam procesor…'
      : `${v < CPU_RESTING ? 'Procesor odpoczywa' : v < CPU_BUSY ? 'Procesor pracuje' : 'Procesor jest mocno zajęty'}: ${pct(v)}.`
  const sub = [
    coreCount ? `${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}` : null,
    temp ? `${Math.round(temp.value)}${NB}°C` : null,
    busiest !== null ? `najbardziej zajęty rdzeń: ${pct(busiest)}` : null,
  ].filter(Boolean).join(', ')

  return (
    <Pair
      id="mono-cpu"
      proofTour="cpu"
      claim={
        <>
          <h2>{claim}</h2>
          {sub && <p>{sub[0].toUpperCase() + sub.slice(1)}.</p>}
          <p className="mono-note">Najedź na wykres, żeby odczytać chwilę; kliknij słupek, żeby obserwować rdzeń.</p>
        </>
      }
      proof={
        <Shot title={coreCount ? `Procesor · ${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}` : 'Procesor'} note={every}>
          <div className="mono-cpu">
            {record.samples.length > 1 ? (
              <CpuProfile
                samples={record.samples}
                capacity={HISTORY}
                tick={record.tick}
                intervalMs={settings.settings.refreshMs}
                watched={settings.settings.watchedCores}
                onWatch={(cores) => settings.set('watchedCores', cores)}
              />
            ) : (
              <div className="mono-empty" role="status">
                {error ? 'Nie udało się odczytać procesora.' : 'Wykres potrzebuje dwóch odczytów — czekam na kolejny…'}
              </div>
            )}
          </div>
        </Shot>
      }
    />
  )
}

/* --------------------------------------------------------------- pamięć */

function reading(m: Metric): string {
  if (m.unit === '%') return pct(m.value)
  return `${UP_TO_ONE.format(m.value)}${NB}${m.unit}`
}

function MemoryPair({ machine }: { machine: Machine }) {
  const { ram, metrics, error, info } = machine
  const rest = metrics.filter((m) => m.id !== 'cpu')
  const claim = ram?.detail ? `Pamięć: ${nb(ram.detail)}.` : ram ? `Pamięć zajęta w ${pct(ram.value)}.` : error ? 'Brak odczytu pamięci.' : 'Czytam pamięć…'
  return (
    <Pair
      id="mono-memory"
      flip
      claim={
        <>
          <h2>{claim}</h2>
          {ram && <p>{pct(ram.value)} w użyciu. Obok wszystkie odczyty, które maszyna udostępnia.</p>}
        </>
      }
      proof={
        <Shot title="Odczyty" note={`${rest.length} ${plural(rest.length, 'czujnik', 'czujniki', 'czujników')}`}>
          {rest.length === 0 && <div className="mono-empty">{info ? 'Maszyna nie udostępnia innych odczytów.' : <span className="mono-ghost" />}</div>}
          {rest.map((m) => (
            <div key={m.id} className="mono-reading">
              <div className="mono-reading__name">
                <b>{m.label}</b>
                {m.detail && <small>{m.detail}</small>}
              </div>
              {m.percent !== undefined || m.unit === '%' ? (
                <div className="mono-meter" aria-hidden="true">
                  <i style={{ width: `${Math.min(100, m.percent ?? m.value)}%` }} />
                </div>
              ) : (
                <span />
              )}
              <div className="mono-reading__value">{reading(m)}</div>
            </div>
          ))}
        </Shot>
      }
    />
  )
}

/* ---------------------------------------------------------------- skróty */

function ShortcutsPair({ app, reclaim }: { app: ShellProps['app']; reclaim: ReclaimState }) {
  const { installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const quick = orderedModules(os, moduleOrder, linuxProfile).filter((m) => installedSet.has(m.id) && m.quickAction)
  return (
    <Pair
      id="mono-shortcuts"
      proofTour="index"
      claim={
        <>
          <h2>{quick.length ? `${quick.length} ${plural(quick.length, 'skrót', 'skróty', 'skrótów')} do włączonych modułów.` : 'Nie ma jeszcze skrótów.'}</h2>
          <p>{quick.length ? 'Główna akcja każdego modułu, w kolejności z folderów.' : 'Włącz moduły w zarządzaniu, a ich główne akcje pojawią się tutaj.'}</p>
        </>
      }
      proof={
        <Shot title="Skróty" note="kolejność z folderów">
          {quick.length === 0 && <div className="mono-empty">Brak włączonych modułów z akcją.</div>}
          <ul className="mono-quick">
            {quick.map((m) => {
              const hit = reclaim.foundOf(m.id)
              return (
                <li key={m.id}>
                  <button className="mono-quick__row" onClick={() => app.setView({ kind: 'module', moduleId: m.id })}>
                    <span className="mono-no">{numbers.get(m.id)}</span>
                    <span className="mono-quick__name">{m.name}</span>
                    <span className="mono-quick__reading">{hit?.bytes ? `${size(hit.bytes)} do odzyskania` : ''}</span>
                    <span className="mono-quick__act">{m.quickAction}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </Shot>
      }
    />
  )
}
