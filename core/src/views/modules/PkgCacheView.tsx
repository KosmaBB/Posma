import { useEffect, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

interface SnapRevisionEntry {
  name: string
  revision: number
  size_bytes: number
}

interface ScanData {
  /** apt | pacman | dnf | zypper — null gdzie pakietami systemu nie zarządzamy */
  manager: string | null
  unsupported: string | null
  cache_bytes: number
  cache_files: number
  orphans: string[]
  snap_available: boolean
  snap_old_revisions: SnapRevisionEntry[]
}

interface ExecResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

function snapKey(e: SnapRevisionEntry): string {
  return `${e.name}:${e.revision}`
}

function ResultBanner({ result }: { result: ExecResult }) {
  return (
    <div
      className="form-warning"
      style={
        result.success
          ? { marginTop: 10, color: 'var(--good)', background: 'color-mix(in srgb, var(--good) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--good) 30%, transparent)' }
          : { marginTop: 10, color: 'var(--critical)' }
      }
    >
      {result.success ? t('view.pkg-cache.done') : t('view.pkg-cache.failed', { error: result.error ?? '' })}
    </div>
  )
}

export function PkgCacheView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const [aptCleaning, setAptCleaning] = useState(false)
  const [aptCleanResult, setAptCleanResult] = useState<ExecResult | null>(null)

  const [autoremoveRunning, setAutoremoveRunning] = useState(false)
  const [autoremoveResult, setAutoremoveResult] = useState<ExecResult | null>(null)

  const [checkedSnaps, setCheckedSnaps] = useState<Set<string>>(new Set())
  const [snapRemoving, setSnapRemoving] = useState(false)
  const [snapErrors, setSnapErrors] = useState<string[]>([])

  async function loadScan() {
    setScanError(null)
    try {
      const res = await callModule<ScanData>('pkg-cache', { cmd: 'scan' })
      if (res.ok) setScan(res.data)
      else setScanError(res.error)
    } catch (e) {
      setScanError(String(e))
    }
  }

  useEffect(() => {
    loadScan()
  }, [])

  async function cleanAptCache() {
    if (!scan) return
    if (!scan.manager) return
    // Na dystrybucji kroczącej cache to także droga powrotu do poprzedniej
    // wersji pakietu po nieudanej aktualizacji.
    const rollback = scan.manager === 'pacman' ? ' ' + t('view.pkg-cache.clean.rollback') : ''
    if (!(await confirmAction(t('view.pkg-cache.clean.confirm', { size: formatBytes(scan.cache_bytes), manager: scan.manager }) + rollback))) return
    setAptCleaning(true)
    try {
      await invoke('request_permission', { capability: 'fs-system' })
      const res = await invoke<ApiResponse<ExecResult>>('pkg_cache_clean', { source: scan.manager })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setAptCleanResult(result)
      if (result.success) loadScan()
    } catch (e) {
      setAptCleanResult({ success: false, output: '', error: String(e) })
    } finally {
      setAptCleaning(false)
    }
  }

  async function runAutoremove() {
    if (!scan || !scan.manager || scan.orphans.length === 0) return
    if (!(await confirmAction(t('view.pkg-cache.orphans.confirm', { n: scan.orphans.length, list: scan.orphans.join(', ') })))) return
    setAutoremoveRunning(true)
    try {
      await invoke('request_permission', { capability: 'pkg' })
      const res = await invoke<ApiResponse<ExecResult>>('pkg_autoremove', { source: scan.manager })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setAutoremoveResult(result)
      if (result.success) loadScan()
    } catch (e) {
      setAutoremoveResult({ success: false, output: '', error: String(e) })
    } finally {
      setAutoremoveRunning(false)
    }
  }

  function toggleSnap(key: string) {
    setCheckedSnaps((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleAllSnaps() {
    if (!scan) return
    const allOn = scan.snap_old_revisions.every((e) => checkedSnaps.has(snapKey(e)))
    setCheckedSnaps(allOn ? new Set() : new Set(scan.snap_old_revisions.map(snapKey)))
  }

  async function removeSelectedSnaps() {
    if (checkedSnaps.size === 0) return
    if (!(await confirmAction(t('view.pkg-cache.snaps.confirm', { n: checkedSnaps.size })))) return
    setSnapRemoving(true)
    const errors: string[] = []
    try {
      await invoke('request_permission', { capability: 'pkg' })
      for (const key of checkedSnaps) {
        const [name, revStr] = key.split(':')
        const revision = Number(revStr)
        try {
          const res = await invoke<ApiResponse<ExecResult>>('snap_remove_revision', { name, revision })
          if (!res.ok) errors.push(`${name} (${revision}): ${res.error}`)
          else if (!res.data.success) errors.push(`${name} (${revision}): ${res.data.error}`)
        } catch (e) {
          errors.push(`${name} (${revision}): ${String(e)}`)
        }
      }
    } finally {
      setSnapErrors(errors)
      setCheckedSnaps(new Set())
      setSnapRemoving(false)
      loadScan()
    }
  }

  if (scanError) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        {t('view.pkg-cache.error', { error: scanError })}
        <br />
        <button className="btn btn-ghost" onClick={loadScan}>{t('view.pkg-cache.retry')}</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title={t('view.pkg-cache.preparing.title')} note={t('view.pkg-cache.preparing.note')} />
  }

  return (
    <div>
      {scan.manager && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">{t('view.pkg-cache.cache', { manager: scan.manager })}</div>
              <div className="cs-value mono">{formatBytes(scan.cache_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">{t('view.pkg-cache.cache-files')}</div>
              <div className="cs-value mono">{scan.cache_files}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn btn-primary" disabled={aptCleaning || scan.cache_bytes === 0} onClick={cleanAptCache}>
                {aptCleaning ? t('view.pkg-cache.cleaning') : t('view.pkg-cache.clean', { manager: scan.manager })}
              </button>
            </div>
          </div>
          {aptCleanResult && <ResultBanner result={aptCleanResult} />}

          <div className="section-head" style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 14 }}>{t('view.pkg-cache.orphans')}</h2>
            <button className="btn btn-primary btn-mini" disabled={autoremoveRunning || scan.orphans.length === 0} onClick={runAutoremove}>
              {autoremoveRunning ? t('view.pkg-cache.removing') : t('view.pkg-cache.orphans.remove')}
            </button>
          </div>
          {scan.orphans.length === 0 ? (
            <div className="glass empty-state">{t('view.pkg-cache.orphans.empty')}</div>
          ) : (
            <div className="clean-list">
              {scan.orphans.map((name) => (
                <div key={name} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
                  <span className="cr-path mono">{name}</span>
                </div>
              ))}
            </div>
          )}
          {autoremoveResult && <ResultBanner result={autoremoveResult} />}
        </>
      )}

      {scan.snap_available && (
        <>
          <div className="section-head" style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 14 }}>{t('view.pkg-cache.snaps')}</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {scan.snap_old_revisions.length > 1 && (
                <button className="btn btn-ghost btn-mini" onClick={toggleAllSnaps}>
                  {scan.snap_old_revisions.every((e) => checkedSnaps.has(snapKey(e))) ? t('view.pkg-cache.deselect-all') : t('view.pkg-cache.select-all')}
                </button>
              )}
              <button className="btn btn-primary btn-mini" disabled={checkedSnaps.size === 0 || snapRemoving} onClick={removeSelectedSnaps}>
                {snapRemoving ? t('view.pkg-cache.removing') : t('view.pkg-cache.snaps.remove-selected', { count: checkedSnaps.size })}
              </button>
            </div>
          </div>
          {scan.snap_old_revisions.length === 0 ? (
            <div className="glass empty-state">{t('view.pkg-cache.snaps.empty')}</div>
          ) : (
            <div className="clean-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {scan.snap_old_revisions.map((e) => {
                const key = snapKey(e)
                return (
                  <label key={key} className={`glass clean-row${checkedSnaps.has(key) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={checkedSnaps.has(key)} onChange={() => toggleSnap(key)} disabled={snapRemoving} />
                    <span className="cr-path">{e.name} <span className="mono" style={{ color: 'var(--muted)', fontSize: 13 }}>{t('view.pkg-cache.snaps.rev', { rev: e.revision })}</span></span>
                    <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
                  </label>
                )
              })}
            </div>
          )}
          {snapErrors.length > 0 && (
            <div className="form-warning" style={{ marginTop: 10, color: 'var(--critical)' }}>
              {snapErrors.map((err) => <div key={err}>{err}</div>)}
            </div>
          )}
        </>
      )}

      {scan.unsupported && <div className="glass empty-state">{scan.unsupported}</div>}
    </div>
  )
}
