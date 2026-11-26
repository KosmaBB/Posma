import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Preparing } from '../../components/Preparing'
import { confirmAction } from '../../components/confirm'
import { callModule, type ApiResponse } from '../../data/callModule'
import { t } from '../../i18n'

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
      ? t('view.services.restore.confirm', { name: profile.name })
      : t('view.services.disable.confirm', { name: profile.name, effect: profile.effect })
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
        {t('view.services.error', { error })}
        <br />
        <button className="btn btn-ghost" onClick={load}>{t('view.services.retry')}</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title={t('view.services.loading.title')} note={t('view.services.loading.note')} />
  }

  return (
    <>
      {(scan.error || result) && (
        <div className="glass xc-result">
          {scan.error && <div className="xc-error">{scan.error}</div>}
          {result && result.changed.length > 0 && <div>{t('view.services.changed', { n: result.changed.length })}</div>}
          {result?.errors.map((e, i) => <div key={i} className="xc-error">{e}</div>)}
        </div>
      )}

      {scan.profiles.length === 0 ? (
        <div className="glass empty-state">{t('view.services.empty')}</div>
      ) : (
        scan.profiles.map((p) => (
          <div key={p.id} className="glass xc-summary">
            <div>
              <div className="xc-summary-value">
                {p.name} {p.off && <span className="chip medium">{t('view.services.profile-off')}</span>}
              </div>
              <div className="xc-summary-label">{p.effect}</div>
              <div className="xc-note mono">
                {p.services.map((s) => t('view.services.service-state', { name: s.display, state: t(s.disabled ? 'view.services.state.disabled' : s.running ? 'view.services.state.running' : 'view.services.state.stopped') })).join(' · ')}
              </div>
            </div>
            <button className={p.off ? 'btn btn-ghost' : 'btn btn-primary'} onClick={() => toggle(p)} disabled={busy !== null}>
              {busy === p.id ? t('view.services.changing') : p.off ? t('view.services.restore') : t('view.services.disable')}
            </button>
          </div>
        ))
      )}
    </>
  )
}
