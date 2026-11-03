import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Preparing } from '../../components/Preparing'
import { callModule, type ApiResponse } from '../../data/callModule'

interface Upgrade {
  name: string
  id: string
  version: string
  available: string
  source: string
  /** winget shortened the id to fit its table, so it cannot be named back. */
  truncated: boolean
}

interface ScanData {
  upgrades: Upgrade[]
  error: string | null
}

interface UpgradeData {
  upgraded: string[]
  errors: string[]
}

/**
 * Applications winget can update. Listing is the user's own winget;
 * updating runs elevated, so machine-wide installers do not ask again.
 */
export function WingetView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<UpgradeData | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callModule<ScanData>('winget-ui', { cmd: 'scan' })
      if (!res.ok) return setError(res.error)
      setScan(res.data)
      setPicked(new Set(res.data.upgrades.filter((u) => !u.truncated).map((u) => u.id)))
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function upgrade() {
    setBusy(true)
    setResult(null)
    try {
      await invoke('request_permission', { capability: 'pkg' })
      const res = await invoke<ApiResponse<UpgradeData>>('winget_upgrade', { ids: [...picked] })
      setResult(res.ok ? res.data : { upgraded: [], errors: [res.error] })
      await load()
    } catch (e) {
      setResult({ upgraded: [], errors: [String(e)] })
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
    return <Preparing title="Sprawdzam aktualizacje" note="Pytam winget, które aplikacje mają nowsze wersje." />
  }

  return (
    <>
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value mono">{scan.upgrades.length}</div>
          <div className="xc-summary-label">aplikacji z dostępną aktualizacją</div>
        </div>
        <button className="btn btn-primary" onClick={upgrade} disabled={busy || picked.size === 0}>
          {busy ? 'Aktualizuję…' : `Aktualizuj zaznaczone (${picked.size})`}
        </button>
      </div>

      {(scan.error || result) && (
        <div className="glass xc-result">
          {scan.error && <div className="xc-error">{scan.error}</div>}
          {result && result.upgraded.length > 0 && <div>Zaktualizowano: {result.upgraded.length}.</div>}
          {result?.errors.map((e, i) => <div key={i} className="xc-error">{e}</div>)}
        </div>
      )}

      {scan.upgrades.length === 0 ? (
        <div className="glass empty-state">Wszystko aktualne.</div>
      ) : (
        <div className="clean-list">
          {scan.upgrades.map((u) => (
            <label
              key={u.id}
              className={`glass clean-row${picked.has(u.id) ? ' checked' : ''}`}
              title={u.truncated ? 'winget skrócił identyfikator — zaktualizuj w terminalu: winget upgrade --all' : u.id}
            >
              <input type="checkbox" checked={picked.has(u.id)} disabled={u.truncated} onChange={() => toggle(u.id)} />
              <span className="cr-path">{u.name}</span>
              <span className="mono">
                {u.version} → {u.available}
              </span>
            </label>
          ))}
        </div>
      )}
    </>
  )
}
