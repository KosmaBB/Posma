import { useMemo } from 'react'
import type { ShellProps } from '../index'
import { catalogNumbers, moduleById, orderedModules } from '../../data/modules'
import { CpuProfile } from '../../components/CpuProfile'
import {
  DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, size, useMachine, useReclaim, usedPct,
  type DiskInfo, type Machine, type Metric, type ReclaimState,
} from '../../state/machine'
import { Pair, PairRail, Shot } from './pairs'
import { t } from '../../i18n'

const NB = ' '
/** Keeps a figure and its unit on one line inside a claim. */
const nb = (s: string) => s.replace(/ /g, NB)
const pct = (n: number) => `${Math.round(n)}${NB}%`

/** Below this the processor is resting, above the second it is busy. */
const CPU_RESTING = 15
const CPU_BUSY = 60

const rail = () => [
  { id: 'mono-disk', label: t('world.monochrom.rail.disk') },
  { id: 'mono-reclaim', label: t('world.monochrom.rail.reclaim') },
  { id: 'mono-cpu', label: t('world.monochrom.rail.cpu') },
  { id: 'mono-memory', label: t('world.monochrom.rail.memory') },
  { id: 'mono-shortcuts', label: t('world.monochrom.rail.shortcuts') },
]

export function Home({ app, settings }: ShellProps) {
  const refreshMs = settings.settings.refreshMs
  const machine = useMachine(refreshMs)
  const reclaim = useReclaim(app)
  const every = t('world.monochrom.home.every', { s: UP_TO_ONE.format(refreshMs / 1000) })

  return (
    <>
      <div className="mono-pairs">
        <DiskPair machine={machine} every={every} />
        <ReclaimPair app={app} reclaim={reclaim} />
        <CpuPair machine={machine} settings={settings} every={every} />
        <MemoryPair machine={machine} />
        <ShortcutsPair app={app} reclaim={reclaim} />
      </div>
      <PairRail items={rail()} />
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
    claim = t(full ? 'world.monochrom.disk.claim-full' : 'world.monochrom.disk.claim', { free: nb(gb(mainDisk.available_bytes)) })
    sub = t('world.monochrom.disk.used', { pct: pct(usedPct(mainDisk)), total: nb(gb(mainDisk.total_bytes)) })
    if (crowded.length === 1) sub += ' ' + t('world.monochrom.disk.crowded-one', { name: what(crowded[0]), pct: pct(usedPct(crowded[0])) })
    if (crowded.length > 1) sub += ' ' + t('world.monochrom.disk.crowded-many', { names: crowded.map(what).join(', ') })
  } else if (error) {
    claim = t('world.monochrom.disk.error')
    sub = t('world.monochrom.disk.error-sub')
  } else if (info) {
    claim = t('world.monochrom.disk.none')
    sub = t('world.monochrom.disk.none-sub')
  } else {
    claim = t('world.monochrom.disk.loading')
    sub = t('world.monochrom.disk.loading-sub')
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
        <Shot title={t('world.monochrom.disk.title')} note={every}>
          {disksInOrder.length === 0 && <div className="mono-empty">{error ? t('world.monochrom.disk.no-reading') : <span className="mono-ghost" />}</div>}
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
  const what = main ? t('world.monochrom.disk.system') : disk.model ?? disk.name
  return (
    <div className={`mono-disk${full ? ' mono-disk--full' : ''}`}>
      <div className="mono-disk__name">
        <b title={disk.mount_point}>{disk.mount_point}</b>
        <small>
          {full && <span className="mono-flag">{t('world.monochrom.disk.almost-full')}</span>}
          {t('world.monochrom.disk.row-detail', { what, used: gb(disk.total_bytes - disk.available_bytes).replace(' GB', ''), total: gb(disk.total_bytes) })}
        </small>
      </div>
      <div className="mono-meter" role="img" aria-label={t('world.monochrom.disk.meter', { n: Math.round(used) })}>
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
    title = t('world.monochrom.reclaim.none')
    sub = t('world.monochrom.reclaim.none-sub')
  } else if (state.kind === 'idle') {
    title = t('world.monochrom.reclaim.idle')
    sub = t('world.monochrom.reclaim.idle-sub', { n })
  } else if (state.kind === 'scanning') {
    title = t('world.monochrom.reclaim.scanning', { done: state.done, n })
    sub = t('world.monochrom.reclaim.scanning-sub')
  } else if (total > 0) {
    title = t('world.monochrom.reclaim.found', { size: nb(size(total)) })
    sub = t('world.monochrom.reclaim.found-sub', { n })
    if (failed.length) sub += ' ' + t('world.monochrom.reclaim.failed', { n: failed.length })
  } else {
    title = t(failed.length ? 'world.monochrom.reclaim.nothing-counted' : 'world.monochrom.reclaim.nothing')
    sub = t(failed.length ? 'world.monochrom.reclaim.nothing-counted-sub' : 'world.monochrom.reclaim.nothing-sub')
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
              <button className="btn btn-ghost" onClick={() => app.setView({ kind: 'manager' })}>{t('world.monochrom.reclaim.manage')}</button>
            )}
            {n > 0 && state.kind === 'idle' && <button className="btn btn-primary" onClick={check}>{t('world.monochrom.reclaim.check')}</button>}
            {state.kind === 'done' && top && (
              <button className="btn btn-primary" onClick={() => open(top.id)}>{t('world.monochrom.reclaim.open', { name: top.name })}</button>
            )}
            {state.kind === 'done' && <button className="btn btn-ghost" onClick={check}>{t('world.monochrom.reclaim.recheck')}</button>}
          </div>
        </>
      }
      proof={
        <Shot
          title={t('world.monochrom.rail.reclaim')}
          note={state.kind === 'scanning' ? <span className="mono-run" aria-hidden="true" /> : state.kind === 'done' ? t('world.monochrom.reclaim.read-only') : t('world.monochrom.reclaim.not-checked')}
          foot={state.kind === 'done' && total > 0 ? <>{t('world.monochrom.reclaim.total')}<strong>{size(total)}</strong></> : undefined}
        >
          {rows.length === 0 ? (
            <div className="mono-empty">{t('world.monochrom.reclaim.no-modules')}</div>
          ) : (
            <table className="mono-table">
              <thead>
                <tr><th>{t('world.monochrom.reclaim.col.module')}</th><th className="num">{t('world.monochrom.rail.reclaim')}</th></tr>
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
                          <span className="mono-err" title={r.error}>{t('world.monochrom.reclaim.no-answer')}</span>
                        ) : r.bytes === null ? (
                          <span className="mono-quiet">{state.kind === 'scanning' ? t('world.monochrom.reclaim.counting') : '—'}</span>
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
      ? t(error ? 'world.monochrom.cpu.error' : 'world.monochrom.cpu.loading')
      : t(v < CPU_RESTING ? 'world.monochrom.cpu.resting' : v < CPU_BUSY ? 'world.monochrom.cpu.working' : 'world.monochrom.cpu.busy', { pct: pct(v) })
  const sub = [
    coreCount ? t('world.monochrom.cpu.cores', { n: coreCount }) : null,
    temp ? `${Math.round(temp.value)}${NB}°C` : null,
    busiest !== null ? t('world.monochrom.cpu.busiest', { pct: pct(busiest) }) : null,
  ].filter(Boolean).join(', ')

  return (
    <Pair
      id="mono-cpu"
      proofTour="cpu"
      claim={
        <>
          <h2>{claim}</h2>
          {sub && <p>{sub[0].toUpperCase() + sub.slice(1)}.</p>}
          <p className="mono-note">{t('world.monochrom.cpu.hint')}</p>
        </>
      }
      proof={
        <Shot title={coreCount ? t('world.monochrom.cpu.title-cores', { cores: t('world.monochrom.cpu.cores', { n: coreCount }) }) : t('world.monochrom.cpu.title')} note={every}>
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
                {t(error ? 'world.monochrom.cpu.read-failed' : 'world.monochrom.cpu.waiting')}
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
  const claim = ram?.detail
    ? t('world.monochrom.memory.detail', { detail: nb(ram.detail) })
    : ram
      ? t('world.monochrom.memory.used', { pct: pct(ram.value) })
      : t(error ? 'world.monochrom.memory.none' : 'world.monochrom.memory.loading')
  return (
    <Pair
      id="mono-memory"
      flip
      claim={
        <>
          <h2>{claim}</h2>
          {ram && <p>{t('world.monochrom.memory.in-use', { pct: pct(ram.value) })}</p>}
        </>
      }
      proof={
        <Shot title={t('world.monochrom.memory.title')} note={t('world.monochrom.memory.sensors', { n: rest.length })}>
          {rest.length === 0 && <div className="mono-empty">{info ? t('world.monochrom.memory.no-others') : <span className="mono-ghost" />}</div>}
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
          <h2>{quick.length ? t('world.monochrom.shortcuts.count', { n: quick.length }) : t('world.monochrom.shortcuts.none')}</h2>
          <p>{t(quick.length ? 'world.monochrom.shortcuts.hint' : 'world.monochrom.shortcuts.hint-none')}</p>
        </>
      }
      proof={
        <Shot title={t('world.monochrom.rail.shortcuts')} note={t('world.monochrom.shortcuts.note')}>
          {quick.length === 0 && <div className="mono-empty">{t('world.monochrom.shortcuts.empty')}</div>}
          <ul className="mono-quick">
            {quick.map((m) => {
              const hit = reclaim.foundOf(m.id)
              return (
                <li key={m.id}>
                  <button className="mono-quick__row" onClick={() => app.setView({ kind: 'module', moduleId: m.id })}>
                    <span className="mono-no">{numbers.get(m.id)}</span>
                    <span className="mono-quick__name">{m.name}</span>
                    <span className="mono-quick__reading">{hit?.bytes ? t('world.monochrom.shortcuts.reclaimable', { size: size(hit.bytes) }) : ''}</span>
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
