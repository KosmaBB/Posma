import { useEffect, useRef, useState } from 'react'
import type { AppState } from '../../state/appState'
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
const HISTORY_LEN = 40

/**
 * One reading kept for the graph. The top processes travel with it, so
 * pointing at a spike can answer what caused it rather than only how big
 * it was.
 */
interface Sample {
  cpu: number
  ram: number
  top: ProcessInfo[]
}

/**
 * Eases a value toward its target every frame.
 *
 * Readings arrive every POLL_MS; without this the numbers and bars jump in
 * steps. Lowering the poll interval would smooth it at the cost of doing
 * far more work, which is the trade this avoids — the data rate is
 * unchanged, only the drawing is continuous.
 */
function useSmoothed(target: number, rate = 0.18): number {
  const [value, setValue] = useState(target)
  const current = useRef(target)

  useEffect(() => {
    let raf = 0
    const step = () => {
      const delta = target - current.current
      if (Math.abs(delta) < 0.05) {
        current.current = target
        setValue(target)
        return
      }
      current.current += delta * rate
      setValue(current.current)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, rate])

  return value
}

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

function Sparkline({
  values,
  max,
  color,
  hover,
  onHover,
}: {
  values: number[]
  max: number
  color: string
  hover: number | null
  onHover: (index: number | null) => void
}) {
  const w = 220
  const h = 44
  if (values.length < 2) {
    return <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="hm-spark" />
  }

  const step = w / (HISTORY_LEN - 1)
  const xOf = (i: number) => w - (values.length - 1 - i) * step
  const yOf = (v: number) => h - Math.min(v / max, 1) * (h - 3) - 1.5
  const points = values.map((v, i) => `${xOf(i).toFixed(1)},${yOf(v).toFixed(1)}`)

  // Index nearest the pointer, in the graph's own coordinates rather than
  // the element's, so it stays right whatever the interface is scaled to.
  function pick(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * w
    let best = 0
    let bestDist = Infinity
    for (let i = 0; i < values.length; i++) {
      const d = Math.abs(xOf(i) - x)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    }
    onHover(best)
  }

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="hm-spark"
      onMouseMove={pick}
      onMouseLeave={() => onHover(null)}
    >
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {hover !== null && hover < values.length && (
        <>
          <line
            x1={xOf(hover)}
            y1={0}
            x2={xOf(hover)}
            y2={h}
            stroke="var(--muted)"
            strokeWidth="1"
            strokeDasharray="2 3"
            opacity="0.7"
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={xOf(hover)} cy={yOf(values[hover])} r="3" fill={color} />
        </>
      )}
    </svg>
  )
}

function StatTile({
  label,
  value,
  sub,
  history,
  max,
  color,
  hover,
  onHover,
  frozen,
}: {
  label: string
  value: string
  sub?: string
  history: number[]
  max: number
  color: string
  hover?: number | null
  onHover?: (index: number | null) => void
  /** Reading being pointed at, shown instead of the live one. */
  frozen?: string
}) {
  return (
    <div className="glass hm-tile" data-frozen={frozen !== undefined}>
      <div className="hm-tile-head">
        <div>
          <div className="hm-tile-label">
            {label}
            {frozen !== undefined && <span className="hm-frozen">zatrzymany</span>}
          </div>
          <div className="hm-tile-value">{frozen ?? value}</div>
          {sub && <div className="hm-tile-sub">{sub}</div>}
        </div>
      </div>
      <Sparkline
        values={history}
        max={max}
        color={color}
        hover={hover ?? null}
        onHover={onHover ?? (() => {})}
      />
    </div>
  )
}

export function HealthMonitorView({ app }: { app: AppState }) {
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [samples, setSamples] = useState<Sample[]>([])
  const [disks, setDisks] = useState<BlockDevice[]>([])
  const [smart, setSmart] = useState<Map<string, SmartInfo | 'loading'>>(new Map())
  const [killResult, setKillResult] = useState<string | null>(null)
  /** Sample the pointer is on. While set, the graph stops advancing. */
  const [hover, setHover] = useState<number | null>(null)
  const timerRef = useRef<number | null>(null)
  const hoverRef = useRef<number | null>(null)
  hoverRef.current = hover

  const latest = samples.length > 0 ? samples[samples.length - 1] : undefined
  const smoothCpu = useSmoothed(latest?.cpu ?? 0)
  const smoothRam = useSmoothed(latest?.ram ?? 0)

  async function poll() {
    try {
      const res = await invoke<ApiResponse<Snapshot>>('health_snapshot')
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setSnap(res.data)
      // Held still while the pointer is on the graph: appending would slide
      // the reading out from under the cursor mid-inspection.
      if (hoverRef.current !== null) return
      setSamples((prev) =>
        [
          ...prev,
          {
            cpu: res.data.cpu_percent,
            ram: (res.data.ram_used_bytes / res.data.ram_total_bytes) * 100,
            top: res.data.top_processes.slice(0, 3),
          },
        ].slice(-HISTORY_LEN),
      )
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
      // Goes through the broker now, so consent has to exist before the
      // call rather than the call failing with a permission error.
      await invoke('request_permission', { capability: 'disk-smart' })
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

  const maxCoreUsage = 100

  const cpuHistory = samples.map((x) => x.cpu)
  const ramHistory = samples.map((x) => x.ram)
  const pointed = hover !== null ? samples[hover] : null

  async function killProcess(pid: number, name: string) {
    if (!window.confirm(`Zakończyć proces „${name}" (PID ${pid})? Niezapisane dane w nim przepadną.`)) return
    setKillResult(null)
    try {
      const res = await invoke<ApiResponse<{ success: boolean; message: string }>>('health_kill', { pid })
      setKillResult(res.ok ? res.data.message : res.error)
    } catch (e) {
      setKillResult(String(e))
    }
  }

  return (
    <div>
      <div className="hm-grid">
        <StatTile
          label="Procesor"
          value={`${smoothCpu.toFixed(0)}%`}
          history={cpuHistory}
          max={100}
          color="var(--accent)"
          hover={hover}
          onHover={setHover}
          frozen={pointed ? `${pointed.cpu.toFixed(0)}%` : undefined}
        />
        <StatTile
          label="Pamięć RAM"
          value={`${smoothRam.toFixed(0)}%`}
          sub={`${formatBytes(snap.ram_used_bytes)} / ${formatBytes(snap.ram_total_bytes)}`}
          history={ramHistory}
          max={100}
          color="var(--g-blue-2)"
          hover={hover}
          onHover={setHover}
          frozen={pointed ? `${pointed.ram.toFixed(0)}%` : undefined}
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

      <div className="section-head">
        <h2>Najbardziej obciążające procesy</h2>
        {pointed && <span className="count">z zatrzymanego odczytu</span>}
      </div>
      {killResult && <div className="glass hm-killed">{killResult}</div>}
      {/* Without headings the four figures on each row are a guess — and
          CPU above 100% looks like a fault until you know it is summed
          across cores. */}
      <div className="hm-legend">
        <span className="cr-path">Proces</span>
        <span className="cr-files">PID</span>
        <span className="cr-size" title="Suma po wszystkich rdzeniach — 150% to półtora rdzenia">
          CPU Σ
        </span>
        <span className="cr-size">Pamięć</span>
        <span className="hm-legend__gap" />
      </div>
      <div className="clean-list">
        {(pointed ? pointed.top : snap.top_processes).map((p) => (
          <div key={p.pid} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
            <span className="cr-path mono">{p.name}</span>
            <span className="cr-files">PID {p.pid}</span>
            <span className="cr-size mono">{p.cpu_percent.toFixed(1)}%</span>
            <span className="cr-size mono">{formatBytes(p.mem_bytes)}</span>
            <button className="btn btn-ghost btn-mini" onClick={() => killProcess(p.pid, p.name)}>
              Zakończ
            </button>
          </div>
        ))}
      </div>

      <div className="section-head"><h2>Dyski</h2></div>
      <div className="clean-list">
        {snap.disks.map((d) => (
          <button
            key={d.mount_point}
            className="glass clean-row hm-disk"
            title={`Pokaż mapę dysku dla ${d.mount_point}`}
            onClick={() => app.setView({ kind: 'module', moduleId: 'disk-map', param: d.mount_point })}
          >
            <span className="cr-path mono">{d.mount_point}</span>
            <span className="cr-files">{d.name}</span>
            <span className="cr-size mono">{formatBytes(d.total_bytes - d.available_bytes)} / {formatBytes(d.total_bytes)}</span>
            <span className="hm-disk-go" aria-hidden="true">→</span>
          </button>
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
