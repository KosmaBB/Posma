import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Preparing } from '../../components/Preparing'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

interface App {
  name: string
  /** PackageFullName — what Remove-AppxPackage takes. */
  package: string
  preinstalled: boolean
}

interface ScanData {
  apps: App[]
  error: string | null
}

interface RemoveData {
  removed: string[]
  errors: string[]
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Store apps Windows lets this account remove. Windows' own promotional
 * ones are marked, never picked for the user. A System Restore point is
 * made before anything is removed, and without one nothing is.
 */
export function BloatwareView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<RemoveData | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callModule<ScanData>('bloatware', { cmd: 'scan' })
      if (res.ok) setScan(res.data)
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  function toggle(pkg: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(pkg)) next.delete(pkg)
      else next.add(pkg)
      return next
    })
  }

  async function remove() {
    const packages = [...picked]
    if (!(await confirmAction(t('view.bloatware.remove.confirm', { n: packages.length })))) return
    setBusy(true)
    setResult(null)
    try {
      await invoke('request_permission', { capability: 'restore-point' })
      const res = await invoke<ApiResponse<RemoveData>>('remove_bloatware', { packages })
      setResult(res.ok ? res.data : { removed: [], errors: [res.error] })
      setPicked(new Set())
      await load()
    } catch (e) {
      setResult({ removed: [], errors: [String(e)] })
    } finally {
      setBusy(false)
    }
  }

  if (error && !scan) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        {t('view.bloatware.error', { error })}
        <br />
        <button className="btn btn-ghost" onClick={load}>{t('view.bloatware.retry')}</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title={t('view.bloatware.loading.title')} note={t('view.bloatware.loading.note')} />
  }

  return (
    <>
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value mono">{scan.apps.filter((a) => a.preinstalled).length}</div>
          <div className="xc-summary-label">{t('view.bloatware.summary', { n: scan.apps.length })}</div>
        </div>
        <button className="btn btn-primary" onClick={remove} disabled={busy || picked.size === 0}>
          {busy ? t('view.bloatware.removing') : t('view.bloatware.remove-selected', { n: picked.size })}
        </button>
      </div>

      {(scan.error || result) && (
        <div className="glass xc-result">
          {scan.error && <div className="xc-error">{scan.error}</div>}
          {result && result.removed.length > 0 && <div>{t('view.bloatware.removed', { n: result.removed.length })}</div>}
          {result?.errors.map((e, i) => <div key={i} className="xc-error">{e}</div>)}
        </div>
      )}

      <div className="clean-list">
        {scan.apps.map((a) => (
          <label key={a.package} className={`glass clean-row${picked.has(a.package) ? ' checked' : ''}`}>
            <input type="checkbox" checked={picked.has(a.package)} onChange={() => toggle(a.package)} />
            <span className="cr-path mono" title={a.package}>{a.name}</span>
            {a.preinstalled && <span className="chip medium">{t('view.bloatware.preinstalled')}</span>}
          </label>
        ))}
      </div>
    </>
  )
}
