import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Preparing } from '../../components/Preparing'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

interface ScanData {
  /** Oldest first, as tmutil names them: 2026-10-19-101500. */
  snapshots: string[]
  error: string | null
}

interface ExecResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

/** "2026-10-19-101500" -> "19.10.2026 10:15:00"; anything else as it is. */
function snapshotDate(name: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(name)
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]}:${m[6]}` : name
}

/**
 * macOS keeps local snapshots between real backups and frees them itself
 * when space runs short, but until then they count as used. Deleting goes
 * through the broker, which lists them again as root — the request only
 * says whether the newest stays.
 */
export function TimeMachineView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ExecResult | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callModule<ScanData>('time-machine', { cmd: 'scan' })
      if (res.ok) setScan(res.data)
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function remove(keepLatest: boolean) {
    const question = keepLatest
      ? t('view.time-machine.remove.confirm-keep')
      : t('view.time-machine.remove.confirm-all')
    if (!(await confirmAction(question))) return
    setBusy(true)
    setResult(null)
    try {
      await invoke('request_permission', { capability: 'fs-system' })
      const res = await invoke<ApiResponse<ExecResult>>('delete_local_snapshots', { keepLatest })
      setResult(res.ok ? res.data : { success: false, output: '', error: res.error })
      await load()
    } catch (e) {
      setResult({ success: false, output: '', error: String(e) })
    } finally {
      setBusy(false)
    }
  }

  if (error && !scan) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        {t('view.time-machine.error', { error })}
        <br />
        <button className="btn btn-ghost" onClick={load}>{t('view.time-machine.retry')}</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title={t('view.time-machine.preparing.title')} note={t('view.time-machine.preparing.note')} />
  }

  return (
    <>
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value mono">{scan.snapshots.length}</div>
          <div className="xc-summary-label">{t('view.time-machine.count', { n: scan.snapshots.length })}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => remove(true)} disabled={busy || scan.snapshots.length < 2}>
            {t('view.time-machine.keep-latest')}
          </button>
          <button className="btn btn-primary" onClick={() => remove(false)} disabled={busy || scan.snapshots.length === 0}>
            {busy ? t('view.time-machine.removing') : t('view.time-machine.remove-all')}
          </button>
        </div>
      </div>

      {(scan.error || result) && (
        <div className="glass xc-result">
          {scan.error && <div className="xc-error">tmutil: {scan.error}</div>}
          {result && (result.success ? result.output : <div className="xc-error">{t('view.time-machine.failed', { error: result.error ?? '' })}</div>)}
        </div>
      )}

      {scan.snapshots.length === 0 ? (
        <div className="glass empty-state">{t('view.time-machine.empty')}</div>
      ) : (
        <div className="clean-list">
          {[...scan.snapshots].reverse().map((s, i) => (
            <div key={s} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path mono">{snapshotDate(s)}</span>
              {i === 0 && <span className="chip low">{t('view.time-machine.chip.latest')}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
