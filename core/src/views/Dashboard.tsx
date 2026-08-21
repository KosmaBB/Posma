import { useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AppState } from '../state/appState'
import { folders, modules, modulesInFolder } from '../data/modules'
import { Icon } from '../components/Icons'

interface DiskInfo {
  name: string
  mount_point: string
  total_bytes: number
  available_bytes: number
}

interface SystemInfo {
  cpu_percent: number
  ram_used_bytes: number
  ram_total_bytes: number
  disks: DiskInfo[]
}

type SystemInfoResponse = { ok: true; data: SystemInfo } | { ok: false; error: string }

const REFRESH_MS = 2000
/** Two minutes of history at the poll rate — enough to see a spike pass. */
const HISTORY = 60
/** Above this, a disk is worth pointing at rather than just listing. */
const DISK_WARN_PCT = 90

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

export function Dashboard({ app }: { app: AppState }) {
  const { installedSet, setView, onboarding } = app
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Kept in a ref as well so the poll can append without re-subscribing.
  const cpuHistory = useRef<number[]>([])
  const ramHistory = useRef<number[]>([])
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
          const ram = (res.data.ram_used_bytes / res.data.ram_total_bytes) * 100
          cpuHistory.current = [...cpuHistory.current, res.data.cpu_percent].slice(-HISTORY)
          ramHistory.current = [...ramHistory.current, ram].slice(-HISTORY)
          forceTick((n) => n + 1)
        } else {
          setError(res.error)
        }
      } catch (e) {
        if (!cancelled) setError(String(e))
      }
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const quickActions = modules.filter((m) => installedSet.has(m.id) && m.quickAction)
  const disks = info?.disks ?? []
  const mainDisk = disks.find((d) => d.mount_point === '/' || d.mount_point.startsWith('C:')) ?? disks[0]
  const ramPct = info ? (info.ram_used_bytes / info.ram_total_bytes) * 100 : 0
  const crowded = disks.filter((d) => usedPct(d) >= DISK_WARN_PCT)

  return (
    <div className="view-enter">
      {/* ------------------------------------------------------- vitals */}
      <div className="vitals-row">
        <div className="glass vital-card">
          <div className="vital-label">CPU</div>
          <div className="vital-value mono">
            {info ? info.cpu_percent.toFixed(0) : '—'}
            <span>%</span>
          </div>
          <div className="vital-sub">{error ? 'moduł system-info niedostępny' : 'obciążenie procesora'}</div>
          <Spark values={cpuHistory.current} from="var(--g-teal-1)" to="transparent" />
        </div>

        <div className="glass vital-card">
          <div className="vital-label">RAM</div>
          <div className="vital-value mono">
            {info ? ramPct.toFixed(0) : '—'}
            <span>%</span>
          </div>
          <div className="vital-sub">{info ? `${gb(info.ram_used_bytes)} / ${gb(info.ram_total_bytes)}` : ' '}</div>
          <Spark values={ramHistory.current} from="var(--g-blue-2)" to="transparent" />
        </div>

        <div className="glass vital-card">
          <div className="vital-label">Dysk {mainDisk ? `(${mainDisk.mount_point})` : ''}</div>
          <div className="vital-value mono">
            {mainDisk ? usedPct(mainDisk).toFixed(0) : '—'}
            <span>%</span>
          </div>
          <div className="vital-sub">
            {mainDisk ? `${gb(mainDisk.available_bytes)} wolnego z ${gb(mainDisk.total_bytes)}` : ' '}
          </div>
          <div className="vital-track">
            <div
              className="vital-fill"
              style={{
                width: `${mainDisk ? usedPct(mainDisk) : 0}%`,
                background: diskGradient(mainDisk ? usedPct(mainDisk) : 0),
              }}
            />
          </div>
        </div>
      </div>

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
                  <span className="disk-row__mount mono">{d.mount_point}</span>
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
