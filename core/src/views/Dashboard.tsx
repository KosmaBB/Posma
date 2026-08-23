import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AppState } from '../state/appState'
import type { SettingsState } from '../state/settings'
import { folders, modulesInFolder, orderedModules } from '../data/modules'
import { Icon } from '../components/Icons'

interface DiskInfo {
  name: string
  mount_point: string
  total_bytes: number
  available_bytes: number
  model?: string
  solid_state?: boolean
}

/**
 * One reading the machine was willing to give up. Everything past `value`
 * is optional because the sidecar omits what it cannot obtain — a metric
 * that is missing simply is not in the array, so nothing here has to model
 * "absent" as a special value.
 */
interface Metric {
  id: string
  label: string
  value: number
  unit: string
  percent?: number
  detail?: string
  kind: 'load' | 'capacity' | 'temperature'
}

interface SystemInfo {
  metrics: Metric[]
  disks: DiskInfo[]
}

type SystemInfoResponse = { ok: true; data: SystemInfo } | { ok: false; error: string }

/** Samples kept per plotted metric. How long that covers depends on the
 * chosen refresh rate, which is the point: the graph holds the same number
 * of readings either way. */
const HISTORY = 60
/** Above this, a disk is worth pointing at rather than just listing. */
const DISK_WARN_PCT = 90

/** Distinct colour per plotted metric, falling back for unknown ids. */
function sparkColour(id: string): string {
  if (id === 'cpu') return 'var(--g-teal-1)'
  if (id === 'ram') return 'var(--g-blue-2)'
  return 'var(--g-violet-1)'
}

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function usedPct(d: DiskInfo): number {
  if (d.total_bytes === 0) return 0
  return ((d.total_bytes - d.available_bytes) / d.total_bytes) * 100
}

/** Fill colour by severity, so a full disk reads as full without a label. */
function diskGradient(pct: number): string {
  if (pct >= DISK_WARN_PCT) return 'linear-gradient(90deg, var(--g-red-1), var(--g-amber-1))'
  if (pct >= 75) return 'linear-gradient(90deg, var(--g-amber-1), var(--g-amber-2))'
  return 'linear-gradient(90deg, var(--g-teal-1), var(--g-teal-2))'
}

/**
 * Recent history as bars. Drawn from the same polling the cards use, so it
 * costs nothing extra — the numbers were already arriving and were being
 * thrown away every two seconds.
 */
function Spark({ values, from, to }: { values: number[]; from: string; to: string }) {
  if (values.length < 2) return <div className="spark" aria-hidden="true" />
  return (
    <div className="spark" aria-hidden="true">
      {values.map((v, i) => (
        <i
          key={i}
          style={{
            height: `${Math.max(2, Math.min(100, v))}%`,
            background: `linear-gradient(180deg, ${from}, ${to})`,
          }}
        />
      ))}
    </div>
  )
}

export function Dashboard({ app, settings }: { app: AppState; settings: SettingsState }) {
  const { installedSet, setView, onboarding, moduleOrder } = app
  const refreshMs = settings.settings.refreshMs
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keyed by metric id rather than by a fixed set of fields, so a metric
  // that starts or stops being reported gains or loses its history without
  // anything here needing to know it exists.
  const history = useRef<Record<string, number[]>>({})
  const [, forceTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await invoke<SystemInfoResponse>('get_system_info')
        if (cancelled) return
        if (res.ok) {
          setInfo(res.data)
          setError(null)
          for (const m of res.data.metrics) {
            if (m.kind !== 'load') continue
            history.current[m.id] = [...(history.current[m.id] ?? []), m.value].slice(-HISTORY)
          }
          forceTick((n) => n + 1)
        } else {
          setError(res.error)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    refresh()
    const timer = setInterval(refresh, refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshMs])

  // Same ordering the folder view arranges, so dragging a card in a folder
  // moves it here too rather than the two lists drifting apart.
  const quickActions = orderedModules(onboarding?.os, moduleOrder).filter(
    (m) => installedSet.has(m.id) && m.quickAction,
  )
  const disks = info?.disks ?? []
  const metrics = info?.metrics ?? []
  const mainDisk = disks.find((d) => d.mount_point === '/' || d.mount_point.startsWith('C:')) ?? disks[0]
  const crowded = disks.filter((d) => usedPct(d) >= DISK_WARN_PCT)

  // The main volume is a metric like any other, but it comes from the disk
  // list rather than the sensor sweep, so it is appended here.
  const cards: Metric[] = [...metrics]
  if (mainDisk) {
    const pct = usedPct(mainDisk)
    cards.push({
      id: 'disk-main',
      label: `Dysk ${mainDisk.mount_point}`,
      value: pct,
      unit: '%',
      percent: pct,
      detail: `${gb(mainDisk.available_bytes)} wolnego z ${gb(mainDisk.total_bytes)}`,
      kind: 'capacity',
    })
  }

  return (
    <div className="view-enter">
      {/* ------------------------------------------------------- vitals */}
      {error && (
        <div className="glass empty-state" style={{ marginBottom: 18 }}>
          Nie udało się odczytać stanu maszyny — moduł system-info nie odpowiada.
        </div>
      )}

      {/* Until the first reading lands there is nothing to lay out, and an
          empty region reads as a broken page. Placeholders hold the shape
          the real tiles will take, so nothing jumps when they arrive. */}
      {!info && !error && (
        <div className="vitals-row">
          {Array.from({ length: 6 }, (_, i) => (
            <div className="glass vital-card vital-card--ghost" key={i} aria-hidden="true">
              <div className="ghost-line ghost-line--label" />
              <div className="ghost-line ghost-line--value" />
              <div className="ghost-line ghost-line--sub" />
            </div>
          ))}
          <span className="sr-only" role="status">Odczytuję stan maszyny…</span>
        </div>
      )}

      {cards.length > 0 && (
        <div className="vitals-row">
          {cards.map((m) => (
            <div className="glass vital-card" key={m.id}>
              <div className="vital-label">{m.label}</div>
              <div className="vital-value mono">
                {m.value.toFixed(0)}
                <span>{m.unit}</span>
              </div>
              {m.detail && <div className="vital-sub">{m.detail}</div>}

              {/* Treatment follows the kind, so a metric the sidecar starts
                  reporting tomorrow renders correctly without a change here. */}
              {m.kind === 'load' && (
                <Spark values={history.current[m.id] ?? []} from={sparkColour(m.id)} to="transparent" />
              )}
              {m.kind !== 'load' && m.percent !== undefined && (
                <div className="vital-track">
                  <div
                    className="vital-fill"
                    style={{ width: `${m.percent}%`, background: diskGradient(m.percent) }}
                  />
                </div>
              )}
              {m.kind === 'temperature' && <div className="vital-spacer" />}
            </div>
          ))}
        </div>
      )}

      {/* Only appears when there is something to warn about. */}
      {crowded.map((d) => (
        <button
          key={d.mount_point}
          className="glass advisory"
          onClick={() => setView({ kind: 'module', moduleId: 'disk-map' })}
        >
          <span className="advisory__ico">
            <Icon name="alert" />
          </span>
          <span className="advisory__text">
            <b>
              {d.mount_point} zapełniony w {usedPct(d).toFixed(0)}%
            </b>
            <span>Zostało {gb(d.available_bytes)}. Mapa dysków pokaże, co zajmuje najwięcej miejsca.</span>
          </span>
          <span className="advisory__go" aria-hidden="true">→</span>
        </button>
      ))}

      {/* -------------------------------------------------------- disks */}
      {disks.length > 1 && (
        <>
          <div className="section-head">
            <h2>Nośniki</h2>
            <span className="count">{disks.length} zamontowane</span>
          </div>
          <div className="glass disk-list">
            {disks.map((d) => {
              const pct = usedPct(d)
              return (
                <div className="disk-row" key={d.mount_point}>
                  <span className="disk-row__mount">
                    <span className="mono">{d.mount_point}</span>
                    {/* Model and type are omitted by the sidecar when the
                        kernel does not describe the device, so this line
                        disappears rather than showing an empty label. */}
                    {(d.model || d.solid_state !== undefined) && (
                      <span className="disk-row__model">
                        {[d.solid_state === undefined ? null : d.solid_state ? 'SSD' : 'HDD', d.model]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </span>
                  <div className="disk-row__track">
                    <div className="disk-row__fill" style={{ width: `${pct}%`, background: diskGradient(pct) }} />
                  </div>
                  <span className="disk-row__free">{gb(d.available_bytes)} wolnego</span>
                  <span className="disk-row__pct mono">{pct.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ------------------------------------------------------ folders */}
      <div className="section-head">
        <h2>Foldery</h2>
        <span className="count">{installedSet.size} modułów włączonych</span>
      </div>
      <div className="folder-tiles">
        {folders.map((folder) => {
          const items = modulesInFolder(folder.id, onboarding?.os)
          const on = items.filter((m) => installedSet.has(m.id)).length
          const off = items.length - on
          return (
            <button
              key={folder.id}
              className="glass folder-tile"
              style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}
              onClick={() => setView({ kind: 'folder', folderId: folder.id })}
            >
              <span className="folder-tile__ico">
                <Icon name={folder.icon} />
              </span>
              <span className="folder-tile__name">{folder.name}</span>
              <span className="folder-tile__meta">
                {on} / {items.length}
                {/* Surfaces modules the user has never switched on — including
                    ones that arrived in an update and would otherwise stay
                    invisible until they opened the manager. */}
                {off > 0 && <em className="folder-tile__off">{off} dostępne</em>}
              </span>
            </button>
          )
        })}
      </div>

      {/* ------------------------------------------------------ actions */}
      <div className="section-head">
        <h2>Proponowane akcje</h2>
        <span className="count">z włączonych modułów</span>
      </div>
      {quickActions.length > 0 ? (
        <div className="quick-grid">
          {quickActions.map((m) => {
            const folder = folders.find((f) => f.id === m.folder)!
            return (
              <button
                key={m.id}
                className="glass quick-card"
                style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}
                onClick={() => setView({ kind: 'module', moduleId: m.id })}
              >
                <div className="ico-badge" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
                  <Icon name={m.icon} />
                </div>
                <div className="qc-text">
                  <div className="qc-action">{m.quickAction}</div>
                  <div className="qc-module">{m.name}</div>
                </div>
              </button>
            )
          })}
        </div>
      ) : (
        <div className="glass empty-state">
          Nie masz jeszcze włączonych modułów z szybkimi akcjami.
          <br />
          <button className="btn btn-primary" onClick={() => setView({ kind: 'manager' })}>
            Przeglądaj moduły
          </button>
        </div>
      )}
    </div>
  )
}
