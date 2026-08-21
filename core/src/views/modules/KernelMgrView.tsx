import { useEffect, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'

interface KernelEntry {
  package: string
  version: string
  size_bytes: number
  is_running: boolean
  is_latest: boolean
}

interface ScanData {
  running: string
  latest: string
  kernels: KernelEntry[]
}

interface ExecResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

export function KernelMgrView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, ExecResult>>({})

  async function loadScan() {
    setScanError(null)
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_kernels')
      if (res.ok) setScan(res.data)
      else setScanError(res.error)
    } catch (e) {
      setScanError(String(e))
    }
  }

  useEffect(() => {
    loadScan()
  }, [])

  async function removeKernel(entry: KernelEntry) {
    if (
      !window.confirm(
        `Usunąć jądro ${entry.version} (${formatBytes(entry.size_bytes)})? Tej operacji nie można cofnąć. Aktywne i najnowsze jądro są zawsze chronione, ale sprawdź, czy na pewno tego nie potrzebujesz.`,
      )
    ) {
      return
    }
    setRemoving(entry.package)
    try {
      await invoke('request_permission', { capability: 'boot' })
      await invoke('request_permission', { capability: 'pkg' })
      const res = await invoke<ApiResponse<ExecResult>>('remove_kernel', { package: entry.package })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setResults((prev) => ({ ...prev, [entry.package]: result }))
      if (result.success) loadScan()
    } catch (e) {
      setResults((prev) => ({ ...prev, [entry.package]: { success: false, output: '', error: String(e) } }))
    } finally {
      setRemoving(null)
    }
  }

  if (scanError) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        Błąd: {scanError}
        <br />
        <button className="btn btn-ghost" onClick={loadScan}>Spróbuj ponownie</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title="Sprawdzam zainstalowane jądra" note="Ustalam, które jądro jest uruchomione i które jest najnowsze — oba zostaną zablokowane przed usunięciem." />
  }

  const removable = scan.kernels.filter((k) => !k.is_running && !k.is_latest)

  return (
    <div>
      <div className="clean-summary glass">
        <div>
          <div className="cs-label">Aktywne jądro</div>
          <div className="cs-value mono" style={{ fontSize: 15 }}>{scan.running || 'nieznane'}</div>
        </div>
        <div>
          <div className="cs-label">Najnowsze zainstalowane</div>
          <div className="cs-value mono" style={{ fontSize: 15 }}>{scan.latest || 'nieznane'}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost" onClick={loadScan}>Odśwież</button>
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 14 }}>Zainstalowane jądra</h2>
      </div>
      {removable.length === 0 && (
        <div className="glass empty-state">Nie ma tu nic do usunięcia — zostały tylko aktywne i najnowsze jądro.</div>
      )}
      <div className="clean-list">
        {scan.kernels.map((k) => {
          const locked = k.is_running || k.is_latest
          const result = results[k.package]
          return (
            <div key={k.package}>
              <div className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
                <span className="cr-path mono">{k.version}</span>
                {k.is_running && <span className="chip critical">Aktywne</span>}
                {k.is_latest && !k.is_running && <span className="chip medium">Najnowsze</span>}
                <span className="cr-size mono">{formatBytes(k.size_bytes)}</span>
                <button
                  className="btn btn-ghost btn-mini"
                  disabled={locked || removing !== null}
                  title={locked ? 'Chronione — nie można usunąć' : undefined}
                  style={locked ? { opacity: 0.4, cursor: 'not-allowed', color: 'var(--critical)' } : { color: 'var(--critical)' }}
                  onClick={() => removeKernel(k)}
                >
                  {removing === k.package ? 'Usuwanie...' : 'Usuń'}
                </button>
              </div>
              {result && !result.success && (
                <div className="form-warning" style={{ marginTop: 4, marginBottom: 4, color: 'var(--critical)' }}>
                  Nie udało się: {result.error}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
