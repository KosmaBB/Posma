import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { formatBytes } from './TempCleanView'

interface UsageData {
  total_bytes: number
  files: number
  readable: boolean
}

interface VacuumResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

type Preset = { label: string; mode: 'size' | 'time'; value: number }

const PRESETS: Preset[] = [
  { label: 'Zachowaj 100 MB', mode: 'size', value: 100 },
  { label: 'Zachowaj 500 MB', mode: 'size', value: 500 },
  { label: 'Zachowaj 1 GB', mode: 'size', value: 1024 },
  { label: 'Zachowaj 7 dni', mode: 'time', value: 7 },
  { label: 'Zachowaj 30 dni', mode: 'time', value: 30 },
  { label: 'Zachowaj 90 dni', mode: 'time', value: 90 },
]

export function JournaldTrimView() {
  const [usage, setUsage] = useState<UsageData | null>(null)
  const [usageError, setUsageError] = useState<string | null>(null)
  const [running, setRunning] = useState<Preset | null>(null)
  const [result, setResult] = useState<VacuumResult | null>(null)

  async function loadUsage() {
    setUsageError(null)
    try {
      const res = await invoke<ApiResponse<UsageData>>('journal_usage')
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
    const unit = preset.mode === 'size' ? 'do rozmiaru' : 'starsze niż'
    const amount = preset.mode === 'size' ? formatBytes(preset.value * 1024 * 1024) : `${preset.value} dni`
    if (
      !window.confirm(
        `Przyciąć logi systemowe (${unit} ${amount})? Usunięte wpisy dziennika nie wrócą — to nie dotyczy aplikacji ani ich danych, tylko historii logów systemd.`,
      )
    ) {
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

  return (
    <div>
      <div className="clean-summary glass">
        <div>
          <div className="cs-label">Zajętość dziennika systemd</div>
          <div className="cs-value mono">
            {usage ? (usage.readable ? formatBytes(usage.total_bytes) : 'brak dostępu do odczytu') : usageError ? 'błąd' : '...'}
          </div>
        </div>
        {usage && usage.readable && (
          <div>
            <div className="cs-label">Pliki dziennika</div>
            <div className="cs-value mono">{usage.files}</div>
          </div>
        )}
        <div style={{ marginLeft: 'auto' }}>
          <button className="btn btn-ghost" onClick={loadUsage}>Odśwież</button>
        </div>
      </div>

      {usageError && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>Błąd: {usageError}</div>
      )}

      <div className="section-head" style={{ marginTop: 18 }}>
        <h2 style={{ fontSize: 14 }}>Przytnij dziennik</h2>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="btn btn-ghost"
            disabled={running !== null}
            onClick={() => runVacuum(preset)}
          >
            {running === preset ? 'Przycinanie...' : preset.label}
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
          {result.success ? 'Dziennik przycięty.' : `Nie udało się: ${result.error}`}
        </div>
      )}
    </div>
  )
}
