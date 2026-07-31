import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'

interface SnapRevisionEntry {
  name: string
  revision: number
  size_bytes: number
}

interface ScanData {
  apt_available: boolean
  apt_cache_bytes: number
  apt_cache_files: number
  apt_orphans: string[]
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
      {result.success ? 'Gotowe.' : `Nie udało się: ${result.error}`}
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
      const res = await invoke<ApiResponse<ScanData>>('scan_pkg_cache')
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
    if (!window.confirm(`Usunąć ${formatBytes(scan.apt_cache_bytes)} cache apt? Pobrane pakiety trzeba będzie ściągnąć ponownie w razie potrzeby.`)) return
    setAptCleaning(true)
    try {
      await invoke('request_permission', { capability: 'fs-system' })
      const res = await invoke<ApiResponse<ExecResult>>('apt_clean')
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
    if (!scan || scan.apt_orphans.length === 0) return
    if (!window.confirm(`Usunąć ${scan.apt_orphans.length} nieużywanych pakietów (${scan.apt_orphans.join(', ')})?`)) return
    setAutoremoveRunning(true)
    try {
      await invoke('request_permission', { capability: 'pkg' })
      const res = await invoke<ApiResponse<ExecResult>>('apt_autoremove')
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
    if (!window.confirm(`Usunąć ${checkedSnaps.size} starych rewizji snapów? Tej operacji nie można cofnąć.`)) return
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
        Błąd: {scanError}
        <br />
        <button className="btn btn-ghost" onClick={loadScan}>Spróbuj ponownie</button>
      </div>
    )
  }
  if (!scan) {
    return <div className="glass empty-state"><span className="scan-spinner" aria-hidden />Skanowanie...</div>
  }

  return (
    <div>
      {scan.apt_available && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">Cache apt</div>
              <div className="cs-value mono">{formatBytes(scan.apt_cache_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">Pliki .deb</div>
              <div className="cs-value mono">{scan.apt_cache_files}</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <button className="btn btn-primary" disabled={aptCleaning || scan.apt_cache_bytes === 0} onClick={cleanAptCache}>
                {aptCleaning ? 'Czyszczenie...' : 'Wyczyść cache apt'}
              </button>
            </div>
          </div>
          {aptCleanResult && <ResultBanner result={aptCleanResult} />}

          <div className="section-head" style={{ marginTop: 18 }}>
            <h2 style={{ fontSize: 14 }}>Nieużywane pakiety (autoremove)</h2>
            <button className="btn btn-primary btn-mini" disabled={autoremoveRunning || scan.apt_orphans.length === 0} onClick={runAutoremove}>
              {autoremoveRunning ? 'Usuwanie...' : 'Usuń nieużywane'}
            </button>
          </div>
          {scan.apt_orphans.length === 0 ? (
            <div className="glass empty-state">Brak osieroconych pakietów.</div>
          ) : (
            <div className="clean-list">
              {scan.apt_orphans.map((name) => (
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
            <h2 style={{ fontSize: 14 }}>Stare rewizje snapów</h2>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {scan.snap_old_revisions.length > 1 && (
                <button className="btn btn-ghost btn-mini" onClick={toggleAllSnaps}>
                  {scan.snap_old_revisions.every((e) => checkedSnaps.has(snapKey(e))) ? 'Odznacz wszystko' : 'Zaznacz wszystko'}
                </button>
              )}
              <button className="btn btn-primary btn-mini" disabled={checkedSnaps.size === 0 || snapRemoving} onClick={removeSelectedSnaps}>
                {snapRemoving ? 'Usuwanie...' : `Usuń zaznaczone (${checkedSnaps.size})`}
              </button>
            </div>
          </div>
          {scan.snap_old_revisions.length === 0 ? (
            <div className="glass empty-state">Brak starych rewizji do usunięcia.</div>
          ) : (
            <div className="clean-list" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {scan.snap_old_revisions.map((e) => {
                const key = snapKey(e)
                return (
                  <label key={key} className={`glass clean-row${checkedSnaps.has(key) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={checkedSnaps.has(key)} onChange={() => toggleSnap(key)} disabled={snapRemoving} />
                    <span className="cr-path">{e.name} <span className="mono" style={{ color: 'var(--muted)', fontSize: 10.5 }}>rev. {e.revision}</span></span>
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

      {!scan.apt_available && !scan.snap_available && (
        <div className="glass empty-state">Nie wykryto apt ani snap na tym systemie.</div>
      )}
    </div>
  )
}
