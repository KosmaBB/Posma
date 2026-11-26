import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

interface UsageData {
  total_bytes: number
  files: number
  readable: boolean
  /** Powód, dla którego nie ma tu dziennika do przycięcia (brak systemd albo dziennik tylko w pamięci). */
  unavailable: string | null
}

interface VacuumResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

type Preset = { mode: 'size' | 'time'; value: number }

const PRESETS: Preset[] = [
  { mode: 'size', value: 100 },
  { mode: 'size', value: 500 },
  { mode: 'size', value: 1024 },
  { mode: 'time', value: 7 },
  { mode: 'time', value: 30 },
  { mode: 'time', value: 90 },
]

function presetLabel(p: Preset): string {
  if (p.mode === 'time') return t('view.journald-trim.preset.days', { n: p.value })
  return p.value >= 1024
    ? t('view.journald-trim.preset.gb', { n: p.value / 1024 })
    : t('view.journald-trim.preset.mb', { n: p.value })
}

export function JournaldTrimView() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [running, setRunning] = useState<Preset | null>(null)
  const [result, setResult] = useState<VacuumResult | null>(null)

  async function loadUsage() {
    setUsageError(null)
    try {
      const res = await callModule<UsageData>('journald-trim', { cmd: 'usage' })
      if (res.ok) setUsage(res.data)
      else setUsageError(res.error)
    } catch (e) {
      setUsageError(String(e))
    }
  }

  useEffect(() => {
    loadUsage()
  }, [])

  async function runVacuum(preset: Preset) {
    const confirmKey = preset.mode === 'size' ? 'view.journald-trim.confirm.size' : 'view.journald-trim.confirm.time'
    const amount = preset.mode === 'size' ? formatBytes(preset.value * 1024 * 1024) : t('view.journald-trim.days', { n: preset.value })
    if (!(await confirmAction(t(confirmKey, { amount })))) {
      return
    }
    setRunning(preset)
    setResult(null)
    try {
      // Poprosi o hasło administratora przez pkexec przy każdym wywołaniu
      // (tryb Wybiórczy), chyba że zainstalowany jest demon brokera.
      await invoke('request_permission', { capability: 'fs-system' })
      const res = await invoke<ApiResponse<VacuumResult>>('vacuum_journal', { mode: preset.mode, value: preset.value })
      if (res.ok) {
        setResult(res.data)
        if (res.data.success) await loadUsage()
      } else {
        setResult({ success: false, output: '', error: res.error })
      }
    } catch (e) {
      setResult({ success: false, output: '', error: String(e) })
    } finally {
      setRunning(null)
    }
  }

  if (usage?.unavailable) {
    return <div className="glass empty-state">{usage.unavailable}</div>
  }

  return (
    <div>
      <div className="clean-summary glass">
        <div>
          <div className="cs-label">{t('view.journald-trim.usage')}</div>
          <div className="cs-value mono">
            {usage ? (usage.readable ? formatBytes(usage.total_bytes) : t('view.journald-trim.no-access')) : usageError ? t('view.journald-trim.error-short') : '...'}
          </div>
        </div>
        {usage && usage.readable && (
          <div>
            <div className="cs-label">{t('view.journald-trim.files')}</div>
            <div className="cs-value mono">{usage.files}</div>
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost" onClick={loadUsage}>{t('view.journald-trim.refresh')}</button>
        </div>
      </div>

      {usageError && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>{t('view.journald-trim.error', { error: usageError })}</div>
      )}

      <div className="section-head" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.journald-trim.trim')}</h2>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {PRESETS.map((preset) => (
          <button
            key={`${preset.mode}-${preset.value}`}
            className="btn btn-ghost"
            disabled={running !== null}
            onClick={() => runVacuum(preset)}
          >
            {running === preset ? t('view.journald-trim.trimming') : presetLabel(preset)}
          </button>
        ))}
      </div>

      {result && (
        <div
          className="form-warning"
          style={
            result.success
              ? { marginTop: 14, color: 'var(--good)', background: 'color-mix(in srgb, var(--good) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--good) 30%, transparent)' }
              : { marginTop: 14, color: 'var(--critical)' }
          }
        >
          {result.success ? t('view.journald-trim.done') : t('view.journald-trim.failed', { error: result.error ?? '' })}
        </div>
      )}
    </div>
  )
}
