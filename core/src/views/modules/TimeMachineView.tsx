import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Preparing } from '../../components/Preparing'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'

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
      ? 'Usunąć wszystkie lokalne migawki Time Machine oprócz najnowszej?'
      : 'Usunąć wszystkie lokalne migawki Time Machine? Kopie na dysku zapasowym zostają, ale do następnej kopii nie da się wrócić do stanu sprzed niej z tego Maca.'
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
        Błąd: {error}
        <br />
        <button className="btn btn-ghost" onClick={load}>Spróbuj ponownie</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title="Sprawdzam migawki Time Machine" note="Pytam tmutil o lokalne migawki dysku startowego." />
  }

  return (
    <>
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value mono">{scan.snapshots.length}</div>
          <div className="xc-summary-label">lokalnych migawek na dysku startowym</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => remove(true)} disabled={busy || scan.snapshots.length < 2}>
            Zostaw najnowszą
          </button>
          <button className="btn btn-primary" onClick={() => remove(false)} disabled={busy || scan.snapshots.length === 0}>
            {busy ? 'Usuwam…' : 'Usuń wszystkie'}
          </button>
        </div>
      </div>

      {(scan.error || result) && (
        <div className="glass xc-result">
          {scan.error && <div className="xc-error">tmutil: {scan.error}</div>}
          {result && (result.success ? result.output : <div className="xc-error">Nie udało się: {result.error}</div>)}
        </div>
      )}

      {scan.snapshots.length === 0 ? (
        <div className="glass empty-state">Brak lokalnych migawek — nic tu nie zajmuje miejsca.</div>
      ) : (
        <div className="clean-list">
          {[...scan.snapshots].reverse().map((s, i) => (
            <div key={s} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path mono">{snapshotDate(s)}</span>
              {i === 0 && <span className="chip low">najnowsza</span>}
            </div>
          ))}
        </div>
      )}
    </>
  )
}
