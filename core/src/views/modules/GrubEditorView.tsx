import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'

interface GrubFields {
  grub_default: string
  grub_timeout: number | null
  grub_timeout_style: string
  grub_theme: string | null
  grub_disable_os_prober: boolean
}

interface BackupEntry {
  filename: string
  created_unix: number
}

interface ScanData {
  raw_content: string
  fields: GrubFields
  backups: BackupEntry[]
}

interface PresetInfo {
  name: string
}

interface ThemeInspection {
  valid: boolean
  name: string
  files: number
  size_bytes: number
}

interface BootMenuBox {
  left: string | null
  top: string | null
  width: string | null
  height: string | null
}

interface ThemePreview {
  valid: boolean
  background_data_url: string | null
  desktop_color: string | null
  title_text: string | null
  boot_menu: BootMenuBox
}

interface ExecResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

const KEEP_BACKUPS_KEY = 'posma.grub.keepBackups.v1'

function loadKeepBackups(): number {
  const raw = localStorage.getItem(KEEP_BACKUPS_KEY)
  const n = raw ? Number(raw) : 2
  return Number.isFinite(n) && n >= 1 ? n : 2
}

function setGrubLine(raw: string, key: string, value: string): string {
  const lines = raw.split('\n')
  const prefix = `${key}=`
  let found = false
  const next = lines.map((line) => {
    if (line.trim().startsWith(prefix)) {
      found = true
      return `${key}=${value}`
    }
    return line
  })
  if (!found) next.push(`${key}=${value}`)
  return next.join('\n')
}

function quote(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString('pl-PL')
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/**
 * A CSS approximation, not a real render — GRUB renders itself, there's no
 * headless engine to invoke here. Background image + boot_menu box
 * position both come straight from the real theme.txt, so the layout is
 * at least roughly faithful; exact fonts/spacing aren't attempted.
 */
function ThemePreviewBox({ preview, entries }: { preview: ThemePreview; entries: string[] }) {
  if (!preview.valid) {
    return <div className="glass empty-state" style={{ padding: 20 }}>Nie udało się wygenerować podglądu.</div>
  }
  const box = preview.boot_menu
  const shown = entries.length > 0 ? entries.slice(0, 5) : ['Twój system', 'Opcje zaawansowane', 'Zamknij']
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
        borderRadius: 10,
        overflow: 'hidden',
        border: '1px solid var(--border)',
        backgroundColor: preview.desktop_color ?? '#111',
        backgroundImage: preview.background_data_url ? `url(${preview.background_data_url})` : undefined,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: box.left ?? '30%',
          top: box.top ?? '35%',
          width: box.width ?? '40%',
          height: box.height ?? '30%',
          background: 'rgba(10,10,14,0.55)',
          border: '1px solid rgba(255,255,255,0.2)',
          borderRadius: 6,
          padding: '8px 10px',
          display: 'flex',
          flexDirection: 'column',
          gap: 5,
          overflow: 'hidden',
        }}
      >
        {shown.map((entry, i) => (
          <div
            key={entry + i}
            style={{
              fontSize: 11,
              color: '#fff',
              padding: '3px 6px',
              borderRadius: 4,
              background: i === 0 ? 'rgba(255,255,255,0.18)' : 'transparent',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {entry}
          </div>
        ))}
      </div>
    </div>
  )
}

export function GrubEditorView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)

  const [grubDefault, setGrubDefault] = useState('')
  const [grubTimeout, setGrubTimeout] = useState(10)
  const [grubTimeoutStyle, setGrubTimeoutStyle] = useState('menu')
  const [disableOsProber, setDisableOsProber] = useState(false)

  const [bootEntries, setBootEntries] = useState<string[] | null>(null)
  const [bootEntriesLoading, setBootEntriesLoading] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saveResult, setSaveResult] = useState<ExecResult | null>(null)

  const [keepBackups, setKeepBackups] = useState(loadKeepBackups)

  const [presets, setPresets] = useState<PresetInfo[] | null>(null)
  const [presetBusy, setPresetBusy] = useState<string | null>(null)

  const [themePath, setThemePath] = useState<string | null>(null)
  const [themeInspection, setThemeInspection] = useState<ThemeInspection | null>(null)
  const [themeName, setThemeName] = useState('')
  const [installingTheme, setInstallingTheme] = useState(false)
  const [themeResult, setThemeResult] = useState<ExecResult | null>(null)
  const [pickedPreview, setPickedPreview] = useState<ThemePreview | null>(null)
  const [activePreview, setActivePreview] = useState<ThemePreview | null>(null)

  const [restoring, setRestoring] = useState<string | null>(null)

  async function loadScan() {
    setScanError(null)
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_grub')
      if (!res.ok) {
        setScanError(res.error)
        return
      }
      setScan(res.data)
      setGrubDefault(res.data.fields.grub_default)
      setGrubTimeout(res.data.fields.grub_timeout ?? 10)
      setGrubTimeoutStyle(res.data.fields.grub_timeout_style || 'menu')
      setDisableOsProber(res.data.fields.grub_disable_os_prober)
      if (res.data.fields.grub_theme) {
        try {
          const preview = await invoke<ApiResponse<ThemePreview>>('preview_grub_theme', { themeDir: res.data.fields.grub_theme })
          setActivePreview(preview.ok ? preview.data : null)
        } catch {
          setActivePreview(null)
        }
      } else {
        setActivePreview(null)
      }
    } catch (e) {
      setScanError(String(e))
    }
  }

  async function loadPresets() {
    try {
      const res = await invoke<ApiResponse<PresetInfo[]>>('list_grub_presets')
      if (res.ok) setPresets(res.data)
    } catch {
      // presets are a convenience layer — a failure here shouldn't block the rest of the page
    }
  }

  useEffect(() => {
    loadScan()
    loadPresets()
  }, [])

  useEffect(() => {
    localStorage.setItem(KEEP_BACKUPS_KEY, String(keepBackups))
  }, [keepBackups])

  function buildContent(): string {
    if (!scan) return ''
    let next = scan.raw_content
    next = setGrubLine(next, 'GRUB_DEFAULT', quote(grubDefault))
    next = setGrubLine(next, 'GRUB_TIMEOUT', String(grubTimeout))
    next = setGrubLine(next, 'GRUB_TIMEOUT_STYLE', grubTimeoutStyle)
    next = setGrubLine(next, 'GRUB_DISABLE_OS_PROBER', disableOsProber ? 'true' : 'false')
    return next
  }

  async function loadBootEntries() {
    setBootEntriesLoading(true)
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<{ entries: string[] }>>('read_boot_entries')
      if (res.ok) setBootEntries(res.data.entries)
    } catch (e) {
      setScanError(String(e))
    } finally {
      setBootEntriesLoading(false)
    }
  }

  async function saveSettings() {
    if (!window.confirm('Zapisać ustawienia GRUB? Zostanie utworzona kopia zapasowa poprzedniej konfiguracji, a grub.cfg zostanie odświeżony.')) return
    setSaving(true)
    setSaveResult(null)
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<ExecResult>>('write_grub_config', { content: buildContent(), keepBackups })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setSaveResult(result)
      if (result.success) loadScan()
    } catch (e) {
      setSaveResult({ success: false, output: '', error: String(e) })
    } finally {
      setSaving(false)
    }
  }

  async function pickThemeFolder() {
    const dir = await open({ directory: true, multiple: false, title: 'Wybierz folder z rozpakowanym motywem GRUB' })
    if (!dir || typeof dir !== 'string') return
    setThemePath(dir)
    setThemeResult(null)
    setPickedPreview(null)
    try {
      const res = await invoke<ApiResponse<ThemeInspection>>('inspect_grub_theme', { path: dir })
      if (res.ok) {
        setThemeInspection(res.data)
        setThemeName(res.data.valid ? res.data.name : '')
        if (res.data.valid) {
          const preview = await invoke<ApiResponse<ThemePreview>>('preview_grub_theme', { themeDir: dir })
          setPickedPreview(preview.ok ? preview.data : null)
        }
      }
    } catch (e) {
      setThemeInspection(null)
      setScanError(String(e))
    }
  }

  async function installTheme() {
    if (!scan || !themePath || !themeInspection?.valid || !themeName.trim()) return
    if (!window.confirm(`Zainstalować i włączyć motyw „${themeName}"? Zostanie skopiowany do /boot/grub/themes i ustawiony jako aktywny.`)) return
    setInstallingTheme(true)
    setThemeResult(null)
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<ExecResult>>('install_grub_theme', {
        sourceDir: themePath,
        name: themeName.trim(),
        content: buildContent(),
        keepBackups,
      })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setThemeResult(result)
      if (result.success) {
        loadScan()
        setThemePath(null)
        setThemeInspection(null)
      }
    } catch (e) {
      setThemeResult({ success: false, output: '', error: String(e) })
    } finally {
      setInstallingTheme(false)
    }
  }

  async function savePreset() {
    const name = window.prompt('Nazwa presetu (zapisze bieżące ustawienia z formularza):')
    if (!name || !name.trim()) return
    setPresetBusy(name)
    try {
      const res = await invoke<ApiResponse<null>>('save_grub_preset', { name: name.trim(), content: buildContent() })
      if (res.ok) loadPresets()
      else setScanError(res.error)
    } catch (e) {
      setScanError(String(e))
    } finally {
      setPresetBusy(null)
    }
  }

  async function applyPreset(name: string) {
    if (!window.confirm(`Wgrać preset „${name}"? Nadpisze bieżące ustawienia GRUB (z kopią zapasową).`)) return
    setPresetBusy(name)
    try {
      const loaded = await invoke<ApiResponse<{ content: string }>>('load_grub_preset', { name })
      if (!loaded.ok) {
        setScanError(loaded.error)
        return
      }
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<ExecResult>>('write_grub_config', { content: loaded.data.content, keepBackups })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setSaveResult(result)
      if (result.success) loadScan()
    } catch (e) {
      setSaveResult({ success: false, output: '', error: String(e) })
    } finally {
      setPresetBusy(null)
    }
  }

  async function deletePreset(name: string) {
    if (!window.confirm(`Usunąć preset „${name}"?`)) return
    setPresetBusy(name)
    try {
      const res = await invoke<ApiResponse<null>>('delete_grub_preset', { name })
      if (res.ok) loadPresets()
    } finally {
      setPresetBusy(null)
    }
  }

  async function restoreBackup(filename: string) {
    if (!window.confirm(`Przywrócić tę kopię zapasową? Bieżąca konfiguracja też zostanie zapisana jako kopia przed przywróceniem.`)) return
    setRestoring(filename)
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<ExecResult>>('restore_grub_backup', { filename, keepBackups })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setSaveResult(result)
      if (result.success) loadScan()
    } catch (e) {
      setSaveResult({ success: false, output: '', error: String(e) })
    } finally {
      setRestoring(null)
    }
  }

  const defaultOptions = useMemo(() => {
    const set = new Set(bootEntries ?? [])
    if (grubDefault) set.add(grubDefault)
    return [...set]
  }, [bootEntries, grubDefault])

  if (scanError && !scan) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        Błąd: {scanError}
        <br />
        <button className="btn btn-ghost" onClick={loadScan}>Spróbuj ponownie</button>
      </div>
    )
  }
  if (!scan) {
    return <div className="glass empty-state"><span className="scan-spinner" aria-hidden />Wczytywanie konfiguracji GRUB...</div>
  }

  return (
    <div>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>Podstawowe ustawienia</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-field">
          <span>Domyślny system</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              list="grub-boot-entries"
              type="text"
              value={grubDefault}
              onChange={(e) => setGrubDefault(e.target.value)}
              style={{ flex: 1, padding: '9px 12px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)' }}
            />
            <datalist id="grub-boot-entries">
              {defaultOptions.map((o) => <option key={o} value={o} />)}
            </datalist>
            <button className="btn btn-ghost btn-mini" onClick={loadBootEntries} disabled={bootEntriesLoading}>
              {bootEntriesLoading ? 'Wczytywanie...' : 'Pokaż listę wpisów'}
            </button>
          </div>
        </label>

        <label className="form-field">
          <span>Czas oczekiwania (sekundy)</span>
          <input
            type="number"
            min={0}
            max={120}
            value={grubTimeout}
            onChange={(e) => setGrubTimeout(Number(e.target.value))}
            style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)', maxWidth: 140 }}
          />
        </label>

        <label className="form-field">
          <span>Styl menu</span>
          <select
            value={grubTimeoutStyle}
            onChange={(e) => setGrubTimeoutStyle(e.target.value)}
            style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)', maxWidth: 220 }}
          >
            <option value="menu">Zawsze pokaż menu</option>
            <option value="countdown">Odliczanie</option>
            <option value="hidden">Ukryte</option>
          </select>
        </label>

        <label className="form-check">
          <input type="checkbox" checked={disableOsProber} onChange={(e) => setDisableOsProber(e.target.checked)} />
          <span>Wyłącz wykrywanie innych systemów (os-prober)</span>
        </label>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
            {saving ? 'Zapisywanie...' : 'Zapisz ustawienia'}
          </button>
        </div>
        {saveResult && (
          <div
            className="form-warning"
            style={
              saveResult.success
                ? { color: 'var(--good)', background: 'color-mix(in srgb, var(--good) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--good) 30%, transparent)' }
                : { color: 'var(--critical)' }
            }
          >
            {saveResult.success ? 'Zapisano i odświeżono grub.cfg.' : `Nie udało się: ${saveResult.error}`}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Motyw</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          Aktywny motyw: <span className="mono">{scan.fields.grub_theme ?? 'brak (domyślny wygląd GRUB)'}</span>
        </div>
        {activePreview && (
          <div style={{ maxWidth: 420 }}>
            <ThemePreviewBox preview={activePreview} entries={bootEntries ?? []} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={pickThemeFolder}>Wybierz folder z motywem</button>
          {themePath && (
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{themePath}</span>
          )}
        </div>
        {themePath && themeInspection && !themeInspection.valid && (
          <div className="form-warning" style={{ color: 'var(--critical)' }}>
            To nie wygląda na motyw GRUB — brak pliku theme.txt w wybranym folderze.
          </div>
        )}
        {themeInspection?.valid && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--good)' }}>
              Rozpoznano motyw — {themeInspection.files} plików, {formatBytes(themeInspection.size_bytes)}.
            </div>
            {pickedPreview && (
              <div style={{ maxWidth: 420 }}>
                <ThemePreviewBox preview={pickedPreview} entries={bootEntries ?? []} />
              </div>
            )}
            <label className="form-field">
              <span>Nazwa (folder docelowy w /boot/grub/themes)</span>
              <input
                type="text"
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
                style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)', maxWidth: 320 }}
              />
            </label>
            <div>
              <button className="btn btn-primary" onClick={installTheme} disabled={installingTheme || !themeName.trim()}>
                {installingTheme ? 'Instalowanie...' : 'Zainstaluj i użyj'}
              </button>
            </div>
          </div>
        )}
        {themeResult && (
          <div className="form-warning" style={themeResult.success ? { color: 'var(--good)' } : { color: 'var(--critical)' }}>
            {themeResult.success ? 'Motyw zainstalowany i aktywny.' : `Nie udało się: ${themeResult.error}`}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Presety</h2>
        <button className="btn btn-ghost btn-mini" onClick={savePreset}>Zapisz obecne jako preset</button>
      </div>
      {(!presets || presets.length === 0) ? (
        <div className="glass empty-state">Brak zapisanych presetów.</div>
      ) : (
        <div className="clean-list">
          {presets.map((p) => (
            <div key={p.name} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path">{p.name}</span>
              <button className="btn btn-ghost btn-mini" disabled={presetBusy === p.name} onClick={() => applyPreset(p.name)}>
                {presetBusy === p.name ? '...' : 'Wgraj'}
              </button>
              <button className="btn btn-ghost btn-mini" style={{ color: 'var(--critical)' }} disabled={presetBusy === p.name} onClick={() => deletePreset(p.name)}>
                Usuń
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Kopie zapasowe</h2>
      </div>
      <div className="glass" style={{ padding: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>Liczba przechowywanych kopii</span>
        <input
          type="number"
          min={1}
          max={20}
          value={keepBackups}
          onChange={(e) => setKeepBackups(Math.max(1, Math.min(20, Number(e.target.value))))}
          style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)', width: 70 }}
        />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>domyślnie 2 — starsze kopie usuwane automatycznie przy kolejnym zapisie</span>
      </div>
      {scan.backups.length === 0 ? (
        <div className="glass empty-state">Brak kopii zapasowych — pojawią się po pierwszym zapisie.</div>
      ) : (
        <div className="clean-list">
          {scan.backups.map((b) => (
            <div key={b.filename} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path mono">{formatDate(b.created_unix)}</span>
              <button className="btn btn-ghost btn-mini" disabled={restoring === b.filename} onClick={() => restoreBackup(b.filename)}>
                {restoring === b.filename ? 'Przywracanie...' : 'Przywróć'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
