import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

interface ApiResponse<T> {
  ok: boolean
  data: T
  error: string
}

interface Current {
  gtk_theme: string
  icon_theme: string
  cursor_theme: string
  font: string
  monospace_font: string
  color_scheme: string
}

interface ThemeEntry {
  name: string
  source: string
  user_installed: boolean
}

interface ScanData {
  desktop: string
  desktop_name: string
  supported: boolean
  unsupported_reason: string | null
  color_scheme_supported: boolean
  current: Current
  gtk_themes: ThemeEntry[]
  icon_themes: ThemeEntry[]
  cursor_themes: ThemeEntry[]
  fonts: string[]
  presets: string[]
}

interface ApplyResult {
  success: boolean
  applied: string[]
  failed: string[]
}

interface InstallResult {
  success: boolean
  name: string
  kind: string
  files: number
  destination: string
}

const KIND_LABEL: Record<string, string> = {
  theme: 'motyw GTK',
  icons: 'zestaw ikon',
  cursor: 'motyw kursora',
  font: 'czcionka',
}

/** Themes the user installed themselves are worth pointing out. */
function ThemeSelect({
  label,
  value,
  entries,
  disabled,
  onChange,
}: {
  label: string
  value: string
  entries: ThemeEntry[]
  disabled: boolean
  onChange: (v: string) => void
}) {
  // A value set outside this app may name something no longer installed;
  // showing it keeps the control honest instead of silently reselecting.
  const missing = value && !entries.some((e) => e.name === value)

  return (
    <div className="form-field">
      <label>{label}</label>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {missing && <option value={value}>{value} — nie znaleziono na dysku</option>}
        {entries.map((e) => (
          <option key={e.name} value={e.name}>
            {e.name}
            {e.user_installed ? ' — własny' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}

export function DesktopThemeView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // Edited copy of the current settings. Only the fields that differ from
  // what was read get sent, so an untouched setting is never rewritten.
  const [draft, setDraft] = useState<Current | null>(null)

  const [saving, setSaving] = useState(false)
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null)
  const [installResult, setInstallResult] = useState<InstallResult | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installing, setInstalling] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [presetBusy, setPresetBusy] = useState<string | null>(null)

  async function loadScan() {
    setLoading(true)
    setScanError(null)
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_desktop_theme')
      if (res.ok) {
        setScan(res.data)
        setDraft(res.data.current)
      } else {
        setScanError(res.error)
      }
    } catch (e) {
      setScanError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadScan()
  }, [])

  /** Only what the user actually changed. */
  function pendingChanges(): Partial<Current> {
    if (!scan || !draft) return {}
    const out: Partial<Current> = {}
    for (const key of Object.keys(draft) as (keyof Current)[]) {
      if (draft[key] !== scan.current[key]) out[key] = draft[key]
    }
    return out
  }

  const pending = pendingChanges()
  const pendingCount = Object.keys(pending).length

  async function applyChanges() {
    if (pendingCount === 0) return
    setSaving(true)
    setApplyResult(null)
    try {
      const res = await invoke<ApiResponse<ApplyResult>>('apply_desktop_theme', { changes: pending })
      setApplyResult(res.ok ? res.data : { success: false, applied: [], failed: [res.error] })
      if (res.ok && res.data.success) loadScan()
    } catch (e) {
      setApplyResult({ success: false, applied: [], failed: [String(e)] })
    } finally {
      setSaving(false)
    }
  }

  async function installTheme() {
    const dir = await open({
      directory: true,
      multiple: false,
      title: 'Wybierz folder z motywem, zestawem ikon lub kursorem',
    })
    if (typeof dir !== 'string') return
    setInstalling(true)
    setInstallResult(null)
    setInstallError(null)
    try {
      const res = await invoke<ApiResponse<InstallResult>>('install_desktop_theme', {
        sourceDir: dir,
        name: null,
      })
      if (res.ok) {
        setInstallResult(res.data)
        loadScan()
      } else {
        setInstallError(res.error)
      }
    } catch (e) {
      setInstallError(String(e))
    } finally {
      setInstalling(false)
    }
  }

  async function installFont() {
    const file = await open({
      multiple: false,
      title: 'Wybierz plik czcionki',
      filters: [{ name: 'Czcionki', extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }],
    })
    if (typeof file !== 'string') return
    setInstalling(true)
    setInstallResult(null)
    setInstallError(null)
    try {
      const res = await invoke<ApiResponse<InstallResult>>('install_desktop_font', { path: file })
      if (res.ok) {
        setInstallResult(res.data)
        loadScan()
      } else {
        setInstallError(res.error)
      }
    } catch (e) {
      setInstallError(String(e))
    } finally {
      setInstalling(false)
    }
  }

  async function savePreset() {
    const name = presetName.trim()
    if (!name) return
    setPresetBusy(name)
    try {
      const res = await invoke<ApiResponse<string[]>>('save_desktop_preset', { name })
      if (res.ok) {
        setPresetName('')
        loadScan()
      } else {
        setScanError(res.error)
      }
    } finally {
      setPresetBusy(null)
    }
  }

  async function loadPreset(name: string) {
    if (!window.confirm(`Wgrać zestaw „${name}"? Zmieni obecny wygląd pulpitu.`)) return
    setPresetBusy(name)
    setApplyResult(null)
    try {
      const res = await invoke<ApiResponse<ApplyResult>>('load_desktop_preset', { name })
      setApplyResult(res.ok ? res.data : { success: false, applied: [], failed: [res.error] })
      if (res.ok) loadScan()
    } finally {
      setPresetBusy(null)
    }
  }

  async function deletePreset(name: string) {
    if (!window.confirm(`Usunąć zestaw „${name}"?`)) return
    setPresetBusy(name)
    try {
      await invoke<ApiResponse<string[]>>('delete_desktop_preset', { name })
      loadScan()
    } finally {
      setPresetBusy(null)
    }
  }

  if (loading) return <div className="scan-spinner">Sprawdzam ustawienia pulpitu…</div>

  if (scanError) {
    return (
      <div className="glass empty-state">
        <p>Nie udało się odczytać ustawień pulpitu.</p>
        <p className="mono" style={{ fontSize: 12 }}>{scanError}</p>
        <button className="btn btn-ghost" onClick={loadScan}>Spróbuj ponownie</button>
      </div>
    )
  }

  if (!scan || !draft) {
    return (
      <div className="glass empty-state">
        <p>Brak danych o pulpicie.</p>
        <button className="btn btn-ghost" onClick={loadScan}>Odśwież</button>
      </div>
    )
  }

  const locked = !scan.supported

  return (
    <>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>Środowisko</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13 }}>
          Wykryto: <strong>{scan.desktop_name}</strong>
        </div>
        {locked && (
          <div className="form-warning">
            {scan.unsupported_reason ?? 'To środowisko nie jest obsługiwane.'} Motywy i czcionki
            możesz nadal instalować — zmiana ustawień jest niedostępna.
          </div>
        )}
        {scan.desktop === 'plasma' && (
          <div className="form-warning">
            Obsługa KDE Plasma nie została przetestowana na działającej sesji Plasmy — POSMA jest
            rozwijany na GNOME. Zgłoś, jeśli coś tu nie działa.
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Wygląd</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ThemeSelect
          label="Motyw GTK"
          value={draft.gtk_theme}
          entries={scan.gtk_themes}
          disabled={locked}
          onChange={(v) => setDraft({ ...draft, gtk_theme: v })}
        />
        <ThemeSelect
          label="Ikony"
          value={draft.icon_theme}
          entries={scan.icon_themes}
          disabled={locked}
          onChange={(v) => setDraft({ ...draft, icon_theme: v })}
        />
        <ThemeSelect
          label="Kursor"
          value={draft.cursor_theme}
          entries={scan.cursor_themes}
          disabled={locked}
          onChange={(v) => setDraft({ ...draft, cursor_theme: v })}
        />

        {/* Hidden rather than disabled when the session has no such key —
            a greyed-out control invites the question "why not?". */}
        {scan.color_scheme_supported && (
          <div className="form-field">
            <label>Tryb</label>
            <select
              value={draft.color_scheme}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, color_scheme: e.target.value })}
            >
              <option value="default">Domyślny</option>
              <option value="prefer-light">Jasny</option>
              <option value="prefer-dark">Ciemny</option>
            </select>
          </div>
        )}

        <div className="form-field">
          <label>Czcionka interfejsu</label>
          <input
            type="text"
            value={draft.font}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, font: e.target.value })}
            list="posma-fonts"
          />
        </div>
        <div className="form-field">
          <label>Czcionka o stałej szerokości</label>
          <input
            type="text"
            value={draft.monospace_font}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, monospace_font: e.target.value })}
            list="posma-fonts"
          />
        </div>

        {/* Fontconfig gives family names only; the size and weight suffix
            stays hand-typed, which is why these are text inputs. */}
        <datalist id="posma-fonts">
          {scan.fonts.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-primary"
            onClick={applyChanges}
            disabled={locked || saving || pendingCount === 0}
          >
            {saving ? 'Zapisuję…' : pendingCount > 0 ? `Zastosuj (${pendingCount})` : 'Brak zmian'}
          </button>
          {pendingCount > 0 && (
            <button className="btn btn-ghost" onClick={() => setDraft(scan.current)} disabled={saving}>
              Cofnij zmiany
            </button>
          )}
        </div>

        {applyResult && (
          <div className={applyResult.success ? 'cr-path' : 'form-warning'}>
            {applyResult.applied.length > 0 && <div>Zastosowano: {applyResult.applied.join(', ')}.</div>}
            {applyResult.failed.map((f, i) => (
              <div key={i}>{f}</div>
            ))}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Instalacja z folderu</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Rozpoznaje samo, czy wskazany folder jest motywem GTK, zestawem ikon czy kursorem, i kopiuje
          go do Twojego katalogu domowego.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={installTheme} disabled={installing}>
            Zainstaluj motyw z folderu
          </button>
          <button className="btn btn-ghost" onClick={installFont} disabled={installing}>
            Zainstaluj czcionkę z pliku
          </button>
        </div>
        {installResult && (
          <div className="cr-path">
            Zainstalowano {KIND_LABEL[installResult.kind] ?? installResult.kind}{' '}
            „{installResult.name}" — {installResult.files}{' '}
            {installResult.files === 1 ? 'plik' : 'plików'} w{' '}
            <span className="mono">{installResult.destination}</span>
          </div>
        )}
        {installError && <div className="form-warning">{installError}</div>}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Zestawy</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Zapisuje obecny wygląd pod nazwą, żeby móc do niego wrócić jednym kliknięciem.
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="nazwa zestawu"
            value={presetName}
            disabled={locked}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            onClick={savePreset}
            disabled={locked || !presetName.trim() || presetBusy !== null}
          >
            Zapisz obecny
          </button>
        </div>
        {scan.presets.length === 0 ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>Brak zapisanych zestawów.</div>
        ) : (
          <div className="clean-list">
            {scan.presets.map((name) => (
              <div className="glass clean-row" key={name}>
                <span className="mono">{name}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn btn-ghost btn-mini"
                    onClick={() => loadPreset(name)}
                    disabled={locked || presetBusy === name}
                  >
                    Wgraj
                  </button>
                  <button
                    className="btn btn-ghost btn-mini"
                    onClick={() => deletePreset(name)}
                    disabled={presetBusy === name}
                  >
                    Usuń
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
