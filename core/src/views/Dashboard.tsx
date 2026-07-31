import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { AppState } from '../state/appState'
import { folders, modules } from '../data/modules'
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

function gb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

export function Dashboard({ app }: { app: AppState }) {
  const { installedSet, setView } = app
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function refresh() {
      try {
        const res = await invoke<SystemInfoResponse>('get_system_info')
        if (cancelled) return
        if (res.ok) {
          setInfo(res.data)
          setError(null)
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
  const mainDisk = info?.disks.find((d) => d.mount_point === '/' || d.mount_point.startsWith('C:')) ?? info?.disks[0]
  const ramPct = info ? (info.ram_used_bytes / info.ram_total_bytes) * 100 : 0
  const diskPct = mainDisk ? ((mainDisk.total_bytes - mainDisk.available_bytes) / mainDisk.total_bytes) * 100 : 0

  return (
    <div className="view-enter">
      <div className="vitals-row">
        <div className="glass vital-card" style={{ '--g1': 'var(--g-teal-1)', '--g2': 'var(--g-teal-2)' } as React.CSSProperties}>
          <div className="vital-label">CPU</div>
          <div className="vital-value mono">
            {info ? info.cpu_percent.toFixed(0) : '—'}
            <span>%</span>
          </div>
          <div className="vital-sub">{error ? 'moduł system-info niedostępny' : 'obciążenie procesora'}</div>
          <div className="vital-track"><div className="vital-fill" style={{ width: `${info?.cpu_percent ?? 0}%` }} /></div>
        </div>
        <div className="glass vital-card" style={{ '--g1': 'var(--g-blue-1)', '--g2': 'var(--g-blue-2)' } as React.CSSProperties}>
          <div className="vital-label">RAM</div>
          <div className="vital-value mono">
            {info ? ramPct.toFixed(0) : '—'}
            <span>%</span>
          </div>
          <div className="vital-sub">{info ? `${gb(info.ram_used_bytes)} / ${gb(info.ram_total_bytes)}` : ' '}</div>
          <div className="vital-track"><div className="vital-fill" style={{ width: `${ramPct}%` }} /></div>
        </div>
        <div className="glass vital-card" style={{ '--g1': 'var(--g-amber-1)', '--g2': 'var(--g-amber-2)' } as React.CSSProperties}>
          <div className="vital-label">Dysk {mainDisk ? `(${mainDisk.mount_point})` : ''}</div>
          <div className="vital-value mono">
            {mainDisk ? diskPct.toFixed(0) : '—'}
            <span>%</span>
          </div>
          <div className="vital-sub">{mainDisk ? `${gb(mainDisk.available_bytes)} wolnego z ${gb(mainDisk.total_bytes)}` : ' '}</div>
          <div className="vital-track"><div className="vital-fill" style={{ width: `${diskPct}%` }} /></div>
        </div>
      </div>

      <div className="section-head">
        <h2>Proponowane akcje</h2>
        <span className="count">z zainstalowanych modułów</span>
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
          Nie masz jeszcze zainstalowanych modułów z szybkimi akcjami.
          <br />
          <button className="btn btn-primary" onClick={() => setView({ kind: 'manager' })}>
            Przeglądaj moduły
          </button>
        </div>
      )}
    </div>
  )
}
