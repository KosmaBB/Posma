import { useEffect, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

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
  /** Powód, dla którego na tym systemie nie usuwa się jąder — wtedy lista jest tylko do wglądu. */
  removal_unavailable: string | null
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
      const res = await callModule<ScanData>('kernel-mgr', { cmd: 'scan' })
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
      !(await confirmAction(
        t('view.kernel-mgr.remove.confirm', { version: entry.version, size: formatBytes(entry.size_bytes) }),
      ))
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
        {t('view.kernel-mgr.error', { error: scanError })}
        <br />
        <button className="btn btn-ghost" onClick={loadScan}>{t('view.kernel-mgr.retry')}</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title={t('view.kernel-mgr.preparing.title')} note={t('view.kernel-mgr.preparing.note')} />
  }

  const removable = scan.kernels.filter((k) => !k.is_running && !k.is_latest)

  return (
    <div>
      <div className="clean-summary glass">
        <div>
          <div className="cs-label">{t('view.kernel-mgr.running')}</div>
          <div className="cs-value mono" style={{ fontSize: 15 }}>{scan.running || t('view.kernel-mgr.unknown')}</div>
        </div>
        <div>
          <div className="cs-label">{t('view.kernel-mgr.latest')}</div>
          <div className="cs-value mono" style={{ fontSize: 15 }}>{scan.latest || t('view.kernel-mgr.unknown')}</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost" onClick={loadScan}>{t('view.kernel-mgr.refresh')}</button>
        </div>
      </div>

      <div className="section-head" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.kernel-mgr.installed')}</h2>
      </div>
      {scan.removal_unavailable ? (
        <div className="glass empty-state">{scan.removal_unavailable}</div>
      ) : (
        removable.length === 0 && (
          <div className="glass empty-state">{t('view.kernel-mgr.nothing-to-remove')}</div>
        )
      )}
      <div className="clean-list">
        {scan.kernels.map((k) => {
          const locked = k.is_running || k.is_latest || scan.removal_unavailable !== null
          const result = results[k.package]
          return (
            <div key={k.package}>
              <div className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
                <span className="cr-path mono">{k.version}</span>
                {k.is_running && <span className="chip critical">{t('view.kernel-mgr.chip.running')}</span>}
                {k.is_latest && !k.is_running && <span className="chip medium">{t('view.kernel-mgr.chip.latest')}</span>}
                <span className="cr-size mono">{formatBytes(k.size_bytes)}</span>
                <button
                  className="btn btn-ghost btn-mini"
                  disabled={locked || removing !== null}
                  title={locked ? (scan.removal_unavailable ?? t('view.kernel-mgr.protected')) : undefined}
                  style={locked ? { opacity: 0.4, cursor: 'not-allowed', color: 'var(--critical)' } : { color: 'var(--critical)' }}
                  onClick={() => removeKernel(k)}
                >
                  {removing === k.package ? t('view.kernel-mgr.removing') : t('common.remove')}
                </button>
              </div>
              {result && !result.success && (
                <div className="form-warning" style={{ marginTop: 4, marginBottom: 4, color: 'var(--critical)' }}>
                  {t('view.kernel-mgr.failed', { error: result.error ?? '' })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
