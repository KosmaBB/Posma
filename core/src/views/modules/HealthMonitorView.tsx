import { useEffect, useRef, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'
import { MissingDependency } from '../../components/MissingDependency'

interface ProcessInfo {
  pid: number
  name: string
  cpu_percent: number
  mem_bytes: number
}

interface DiskInfo {
  name: string
  mount_point: string
  total_bytes: number
  available_bytes: number
}

interface Snapshot {
  cpu_percent: number
  cores: number[]
  ram_used_bytes: number
  ram_total_bytes: number
  swap_used_bytes: number
  swap_total_bytes: number
  uptime_secs: number
  top_processes: ProcessInfo[]
  disks: DiskInfo[]
}

interface BlockDevice {
  device: string
  size_bytes: number | null
}

interface SmartInfo {
  device: string
  available: boolean
  model: string | null
  passed: boolean | null
  temperature_c: number | null
  power_on_hours: number | null
  error: string | null
  missing_tool: string | null
  install_hint: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

const POLL_MS = 1500
const HISTORY_LEN = 30

function formatUptime(secs: number): string {
  if (secs < 60) return `${secs} s`
  const mins = Math.floor(secs / 60)
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  const remMins = mins % 60
  if (hours < 24) return `${hours} godz ${remMins} min`
  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  return `${days} dni ${remHours} godz`
}

function Sparkline({ values, max, color }: { values: number[]; max: number; color: string }) {
  const w = 120
  const h = 30
  if (values.length < 2) return <svg width={w} height={h} />
  const step = w / (HISTORY_LEN - 1)
  const points = values.map((v, i) => {
    const x = w - (values.length - 1 - i) * step
    const y = h - Math.min(v / max, 1) * (h - 2) - 1
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  return (
    <svg width={w} height={h} className="hm-spark">
      <polyline points={points.join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StatTile({ label, value, sub, history, max, color }: { label: string; value: string; sub?: string; history: number[]; max: number; color: string }) {
  return (
    <div className="glass hm-tile">
      <div className="hm-tile-head">
        <div>
          <div className="hm-tile-label">{label}</div>
          <div className="hm-tile-value">{value}</div>
          {sub && <div className="hm-tile-sub">{sub}</div>}
        </div>
      </div>
      <Sparkline values={history} max={max} color={color} />
    </div>
  )
}

export function HealthMonitorView() {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cpuHistory, setCpuHistory] = useState<number[]>([])
  const [ramHistory, setRamHistory] = useState<number[]>([])
  const [disks, setDisks] = useState<BlockDevice[]>([])
  const [smart, setSmart] = useState<Map<string, SmartInfo | 'loading'>>(new Map())
  const timerRef = useRef<number | null>(null)

  async function poll() {
    try {
      const res = await invoke<ApiResponse<Snapshot>>('health_snapshot')
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setSnap(res.data)
      setCpuHistory((prev) => [...prev, res.data.cpu_percent].slice(-HISTORY_LEN))
      setRamHistory((prev) => [...prev, res.data.ram_used_bytes / res.data.ram_total_bytes * 100].slice(-HISTORY_LEN))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    poll()
    timerRef.current = window.setInterval(poll, POLL_MS)
    invoke<ApiResponse<BlockDevice[]>>('health_list_disks').then((res) => {
      if (res.ok) setDisks(res.data)
    })
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkSmart(device: string) {
    setSmart((prev) => new Map(prev).set(device, 'loading'))
    try {
      const res = await invoke<ApiResponse<SmartInfo>>('health_smart', { device })
      setSmart((prev) => new Map(prev).set(device, res.ok ? res.data : { device, available: false, model: null, passed: null, temperature_c: null, power_on_hours: null, error: res.error, missing_tool: null, install_hint: null }))
    } catch (e) {
      setSmart((prev) => new Map(prev).set(device, { device, available: false, model: null, passed: null, temperature_c: null, power_on_hours: null, error: String(e), missing_tool: null, install_hint: null }))
    }
  }

  if (error && !snap) {
    return <div className="glass empty-state" style={{ color: 'var(--critical)' }}>Błąd: {error}</div>
  }
  if (!snap) {
    return <Preparing title="Odpytuję podzespoły" note="Zbieram temperatury, obciążenie i stan dysków. Pierwszy odczyt trwa dłużej niż kolejne." />
  }

  const ramUsedFrac = snap.ram_used_bytes / snap.ram_total_bytes
  const maxCoreUsage = 100

  return (
    <div>
      <div className="hm-grid">
        <StatTile
          label="Procesor"
          value={`${snap.cpu_percent.toFixed(0)}%`}
          history={cpuHistory}
          max={100}
          color="var(--accent)"
        />
        <StatTile
          label="Pamięć RAM"
          value={`${(ramUsedFrac * 100).toFixed(0)}%`}
          sub={`${formatBytes(snap.ram_used_bytes)} / ${formatBytes(snap.ram_total_bytes)}`}
          history={ramHistory}
          max={100}
          color="var(--g-blue-2)"
        />
        <div className="glass hm-tile">
          <div className="hm-tile-label">Czas działania</div>
          <div className="hm-tile-value">{formatUptime(snap.uptime_secs)}</div>
          {snap.swap_total_bytes > 0 && (
            <div className="hm-tile-sub">Swap: {formatBytes(snap.swap_used_bytes)} / {formatBytes(snap.swap_total_bytes)}</div>
          )}
        </div>
      </div>

      <div className="section-head"><h2>Rdzenie ({snap.cores.length})</h2></div>
      <div className="hm-cores">
        {snap.cores.map((usage, i) => (
          <div key={i} className="hm-core" title={`Rdzeń ${i}: ${usage.toFixed(0)}%`}>
            <div className="hm-core-fill" style={{ height: `${Math.max(usage, 2)}%`, opacity: 0.35 + (usage / maxCoreUsage) * 0.65 }} />
          </div>
        ))}
      </div>

      <div className="section-head"><h2>Najbardziej obciążające procesy</h2></div>
      <div className="clean-list">
        {snap.top_processes.map((p) => (
          <div key={p.pid} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
            <span className="cr-path mono">{p.name}</span>
            <span className="cr-files">PID {p.pid}</span>
            <span className="cr-size mono">{p.cpu_percent.toFixed(1)}%</span>
            <span className="cr-size mono">{formatBytes(p.mem_bytes)}</span>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>Dyski</h2></div>
      <div className="clean-list">
        {snap.disks.map((d) => (
          <div key={d.mount_point} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
            <span className="cr-path mono">{d.mount_point}</span>
            <span className="cr-files">{d.name}</span>
            <span className="cr-size mono">{formatBytes(d.total_bytes - d.available_bytes)} / {formatBytes(d.total_bytes)}</span>
          </div>
        ))}
      </div>

      {disks.length > 0 && (
        <>
          <div className="section-head"><h2>S.M.A.R.T.</h2></div>
          <div className="clean-list">
            {disks.map((d) => {
              const s = smart.get(d.device)
              return (
                <div key={d.device} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
                  <span className="cr-path mono">{d.device}</span>
                  <span className="cr-files">{d.size_bytes ? formatBytes(d.size_bytes) : ''}</span>
                  {s === 'loading' ? (
                    <span className="cr-size">sprawdzanie...</span>
                  ) : s && s.available ? (
                    <>
                      <span className={`chip ${s.passed ? 'low' : 'critical'}`}>{s.passed ? 'Sprawne' : 'Błędy'}</span>
                      {s.temperature_c != null && <span className="cr-size mono">{s.temperature_c}°C</span>}
                      {s.power_on_hours != null && <span className="cr-files">{s.power_on_hours} godz. pracy</span>}
                    </>
                  ) : s && s.missing_tool ? (
                    <MissingDependency tool={s.missing_tool} installHint={s.install_hint ?? undefined} />
                  ) : s && s.error ? (
                    <span className="chip os">{s.error}</span>
                  ) : (
                    <button className="btn btn-ghost btn-mini" onClick={() => checkSmart(d.device)}>Sprawdź</button>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
