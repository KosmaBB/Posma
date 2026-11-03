import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Preparing } from '../../components/Preparing'
import { confirmAction } from '../../components/confirm'
import { callModule, type ApiResponse } from '../../data/callModule'

interface Service {
  name: string
  display: string
  running: boolean
  disabled: boolean
}

interface Profile {
  id: string
  name: string
  /** What stops working while the profile is off. */
  effect: string
  off: boolean
  services: Service[]
}

interface ScanData {
  profiles: Profile[]
  error: string | null
}

interface SetData {
  changed: string[]
  errors: string[]
}

/**
 * Windows services in ready-made profiles instead of a list of hundreds.
 * Switching one off disables and stops its services after a restore point;
 * switching it on gives each the start type Windows sets.
 */
export function ServicesView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<SetData | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callModule<ScanData>('services', { cmd: 'scan' })
      if (res.ok) setScan(res.data)
      else setError(res.error)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function toggle(profile: Profile) {
    const enable = profile.off
    const question = enable
      ? `Przywrócić domyślne ustawienia usług „${profile.name}”? Najpierw powstanie punkt przywracania systemu.`
      : `Wyłączyć usługi „${profile.name}”? ${profile.effect} Najpierw powstanie punkt przywracania systemu — Windows raz zapyta o zgodę administratora.`
    if (!(await confirmAction(question))) return
    setBusy(profile.id)
    setResult(null)
    try {
      await invoke('request_permission', { capability: 'restore-point' })
      await invoke('request_permission', { capability: 'svc' })
      const res = await invoke<ApiResponse<SetData>>('set_services', { names: profile.services.map((s) => s.name), enabled: enable })
      setResult(res.ok ? res.data : { changed: [], errors: [res.error] })
      await load()
    } catch (e) {
      setResult({ changed: [], errors: [String(e)] })
    } finally {
      setBusy(null)
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
    return <Preparing title="Sprawdzam usługi" note="Pytam Windows o stan usług z gotowych profili." />
  }

  return (
    <>
      {(scan.error || result) && (
        <div className="glass xc-result">
          {scan.error && <div className="xc-error">{scan.error}</div>}
          {result && result.changed.length > 0 && <div>Zmieniono usług: {result.changed.length}.</div>}
          {result?.errors.map((e, i) => <div key={i} className="xc-error">{e}</div>)}
        </div>
      )}

      {scan.profiles.length === 0 ? (
        <div className="glass empty-state">Ta edycja Windows nie ma żadnej z usług, które obejmują profile.</div>
      ) : (
        scan.profiles.map((p) => (
          <div key={p.id} className="glass xc-summary">
            <div>
              <div className="xc-summary-value">
                {p.name} {p.off && <span className="chip medium">wyłączony</span>}
              </div>
              <div className="xc-summary-label">{p.effect}</div>
              <div className="xc-note mono">
                {p.services.map((s) => `${s.display} — ${s.disabled ? 'wyłączona' : s.running ? 'działa' : 'zatrzymana'}`).join(' · ')}
              </div>
            </div>
            <button className={p.off ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => toggle(p)} disabled={busy !== null}>
              {busy === p.id ? 'Zmieniam…' : p.off ? 'Przywróć domyślne' : 'Wyłącz'}
            </button>
          </div>
        ))
      )}
    </>
  )
}
