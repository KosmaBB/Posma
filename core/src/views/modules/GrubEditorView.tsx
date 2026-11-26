import { useEffect, useMemo, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { confirmAction } from '../../components/confirm'
import { EDITED_LOADERS } from '../../data/linuxProfile'
import { BootLoaderEditor, type BackupEntry } from './BootLoaderEditor'
import { callModule } from '../../data/callModule'
import { t, locale } from '../../i18n'

interface GrubFields {
  grub_default: string
  grub_timeout: number | null
  grub_timeout_style: string
  grub_theme: string | null
  grub_disable_os_prober: boolean
}

interface ScanData {
  raw_content: string
  fields: GrubFields
  backups: BackupEntry[]
  /** /boot/grub/themes albo /boot/grub2/themes — zależnie od dystrybucji */
  themes_dir: string
  /** Powód, dla którego nie ma tu czego edytować (inny program rozruchowy, system niemutowalny). */
  unavailable: string | null
  bootloader: string | null
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

/// Drops every assignment of `key`, leaving comments and unrelated lines
/// untouched. Used to switch a theme off, which GRUB expresses as the
/// absence of GRUB_THEME rather than an empty value.
function removeGrubLine(raw: string, key: string): string {
  const prefix = `${key}=`
  return raw
    .split('\n')
    .filter((line) => !line.trim().startsWith(prefix))
    .join('\n')
}

function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
}

/// Fedora's family ships GRUB_TERMINAL_OUTPUT="console", and a console
/// never draws a theme. Switched to the graphical terminal only where that
/// line is what stands in the way.
function enableGraphicalTerminal(raw: string): string {
  const console = /^\s*GRUB_TERMINAL_OUTPUT=(["']?)console\1\s*$/m
  return console.test(raw) ? setGrubLine(raw, 'GRUB_TERMINAL_OUTPUT', '"gfxterm"') : raw
}

/// Where a theme installed under `name` ends up, in the form GRUB expects
/// in GRUB_THEME. `themesDir` comes from the scan, which asks the same
/// code the broker uses — the two cannot name different directories.
function themeConfigPath(themesDir: string, name: string): string {
  return `${themesDir}/${name}/theme.txt`
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(locale())
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
    return <div className="glass empty-state" style={{ padding: 20 }}>{t('view.grub-editor.preview.failed')}</div>
  }
  const box = preview.boot_menu
  const shown = entries.length > 0 ? entries.slice(0, 5) : [t('view.grub-editor.preview.sample-system'), t('view.grub-editor.preview.sample-advanced'), t('view.grub-editor.preview.sample-close')]
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        aspectRatio: '16 / 9',
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
              fontSize: 13,
              color: '#fff',
              padding: '3px 6px',
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
      const res = await callModule<ScanData>('grub-editor', { cmd: 'scan' })
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
          const preview = await callModule<ThemePreview>('grub-editor', { cmd: 'preview_theme', theme_dir: res.data.fields.grub_theme })
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
      const res = await callModule<PresetInfo[]>('grub-editor', { cmd: 'list_presets' })
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

  /**
   * Renders the settings on screen back into /etc/default/grub, editing the
   * file in place so keys this module doesn't model are preserved.
   *
   * `theme` is deliberately three-valued. Left out, GRUB_THEME is carried
   * over untouched — a plain settings save must not disturb the theme.
   * Given a path, that theme becomes active. Given null, the line is
   * removed, which is how GRUB is told to go back to its default look.
   */
  function buildContent(theme?: string | null): string {
    if (!scan) return ''
    let next = scan.raw_content
    next = setGrubLine(next, 'GRUB_DEFAULT', quote(grubDefault))
    next = setGrubLine(next, 'GRUB_TIMEOUT', String(grubTimeout))
    next = setGrubLine(next, 'GRUB_TIMEOUT_STYLE', grubTimeoutStyle)
    next = setGrubLine(next, 'GRUB_DISABLE_OS_PROBER', disableOsProber ? 'true' : 'false')
    if (theme === null) {
      next = removeGrubLine(next, 'GRUB_THEME')
    } else if (theme !== undefined) {
      // Quoted: a theme folder's name may hold spaces.
      next = enableGraphicalTerminal(setGrubLine(next, 'GRUB_THEME', quote(theme)))
    }
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
    if (!(await confirmAction(t('view.grub-editor.save.confirm')))) return
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
    const dir = await open({ directory: true, multiple: false, title: t('view.grub-editor.theme.pick-title') })
    if (!dir || typeof dir !== 'string') return
    setThemePath(dir)
    setThemeResult(null)
    setPickedPreview(null)
    try {
      const res = await callModule<ThemeInspection>('grub-editor', { cmd: 'inspect_theme', path: dir })
      if (res.ok) {
        setThemeInspection(res.data)
        setThemeName(res.data.valid ? res.data.name : '')
        if (res.data.valid) {
          const preview = await callModule<ThemePreview>('grub-editor', { cmd: 'preview_theme', theme_dir: dir })
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
    if (!(await confirmAction(t('view.grub-editor.theme.install.confirm', { name: themeName, dir: scan.themes_dir })))) return
    setInstallingTheme(true)
    setThemeResult(null)
    try {
      await invoke('request_permission', { capability: 'boot' })
      // The config written alongside the copy has to name the theme being
      // installed, otherwise the files land in the themes directory and GRUB
      // is never told to use them.
      const res = await invoke<ApiResponse<ExecResult>>('install_grub_theme', {
        sourceDir: themePath,
        name: themeName.trim(),
        content: buildContent(themeConfigPath(scan.themes_dir, themeName.trim())),
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

  /**
   * Switches the theme off without touching the installed files, so the
   * same theme can be re-enabled later without copying it again.
   */
  async function disableTheme() {
    if (!scan?.fields.grub_theme) return
    if (!(await confirmAction(t('view.grub-editor.theme.disable.confirm')))) return
    setInstallingTheme(true)
    setThemeResult(null)
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<ExecResult>>('write_grub_config', {
        content: buildContent(null),
        keepBackups,
      })
      const result = res.ok ? res.data : { success: false, output: '', error: res.error }
      setThemeResult(result)
      if (result.success) {
        setActivePreview(null)
        loadScan()
      }
    } catch (e) {
      setThemeResult({ success: false, output: '', error: String(e) })
    } finally {
      setInstallingTheme(false)
    }
  }

  async function savePreset() {
    const name = window.prompt(t('view.grub-editor.presets.prompt'))
    if (!name || !name.trim()) return
    setPresetBusy(name)
    try {
      const res = await callModule<null>('grub-editor', { cmd: 'save_preset', name: name.trim(), content: buildContent() })
      if (res.ok) loadPresets()
      else setScanError(res.error)
    } catch (e) {
      setScanError(String(e))
    } finally {
      setPresetBusy(null)
    }
  }

  async function applyPreset(name: string) {
    if (!(await confirmAction(t('view.grub-editor.presets.apply.confirm', { name })))) return
    setPresetBusy(name)
    try {
      const loaded = await callModule<{ content: string }>('grub-editor', { cmd: 'load_preset', name })
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
    if (!(await confirmAction(t('view.grub-editor.presets.delete.confirm', { name })))) return
    setPresetBusy(name)
    try {
      const res = await callModule<null>('grub-editor', { cmd: 'delete_preset', name })
      if (res.ok) loadPresets()
    } finally {
      setPresetBusy(null)
    }
  }

  async function restoreBackup(filename: string) {
    if (!(await confirmAction(t('view.grub-editor.restore.confirm')))) return
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
        {t('view.grub-editor.error', { error: scanError })}
        <br />
        <button className="btn btn-ghost" onClick={loadScan}>{t('view.grub-editor.retry')}</button>
      </div>
    )
  }
  if (!scan) {
    return <Preparing title={t('view.grub-editor.preparing.title')} note={t('view.grub-editor.preparing.note')} />
  }
  if (scan.bootloader && EDITED_LOADERS.includes(scan.bootloader)) {
    return <BootLoaderEditor loader={scan.bootloader} backups={scan.backups} keepBackups={keepBackups} onChanged={loadScan} />
  }
  if (scan.unavailable) {
    return <div className="glass empty-state">{scan.unavailable}</div>
  }

  return (
    <div>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>{t('view.grub-editor.basic')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label className="form-field">
          <span>{t('view.grub-editor.default-system')}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              list="grub-boot-entries"
              type="text"
              value={grubDefault}
              onChange={(e) => setGrubDefault(e.target.value)}
              style={{ flex: 1, padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--ink)' }}
            />
            <datalist id="grub-boot-entries">
              {defaultOptions.map((o) => <option key={o} value={o} />)}
            </datalist>
            <button className="btn btn-ghost btn-mini" onClick={loadBootEntries} disabled={bootEntriesLoading}>
              {bootEntriesLoading ? t('view.grub-editor.loading') : t('view.grub-editor.show-entries')}
            </button>
          </div>
        </label>

        <label className="form-field">
          <span>{t('view.grub-editor.timeout')}</span>
          <input
            type="number"
            min={0}
            max={120}
            value={grubTimeout}
            onChange={(e) => setGrubTimeout(Number(e.target.value))}
            style={{ padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--ink)', maxWidth: 140 }}
          />
        </label>

        <label className="form-field">
          <span>{t('view.grub-editor.menu-style')}</span>
          <select
            value={grubTimeoutStyle}
            onChange={(e) => setGrubTimeoutStyle(e.target.value)}
            style={{ padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--ink)', maxWidth: 220 }}
          >
            <option value="menu">{t('view.grub-editor.menu-style.menu')}</option>
            <option value="countdown">{t('view.grub-editor.menu-style.countdown')}</option>
            <option value="hidden">{t('view.grub-editor.menu-style.hidden')}</option>
          </select>
        </label>

        <label className="form-check">
          <input type="checkbox" checked={disableOsProber} onChange={(e) => setDisableOsProber(e.target.checked)} />
          <span>{t('view.grub-editor.os-prober')}</span>
        </label>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 4 }}>
          <button className="btn btn-primary" onClick={saveSettings} disabled={saving}>
            {saving ? t('view.grub-editor.saving') : t('view.grub-editor.save')}
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
            {saveResult.success ? t('view.grub-editor.saved') : t('view.grub-editor.failed', { error: saveResult.error ?? '' })}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.grub-editor.theme')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('view.grub-editor.theme.active')} <span className="mono">{scan.fields.grub_theme ?? t('view.grub-editor.theme.none')}</span>
        </div>
        {activePreview && (
          <div style={{ maxWidth: 420 }}>
            <ThemePreviewBox preview={activePreview} entries={bootEntries ?? []} />
          </div>
        )}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={pickThemeFolder}>{t('view.grub-editor.theme.pick')}</button>
          {scan.fields.grub_theme && (
            <button className="btn btn-ghost" onClick={disableTheme} disabled={installingTheme}>
              {t('view.grub-editor.theme.disable')}
            </button>
          )}
          {themePath && (
            <span className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{themePath}</span>
          )}
        </div>
        {themePath && themeInspection && !themeInspection.valid && (
          <div className="form-warning" style={{ color: 'var(--critical)' }}>
            {t('view.grub-editor.theme.invalid')}
          </div>
        )}
        {themeInspection?.valid && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 13, color: 'var(--good)' }}>
              {t('view.grub-editor.theme.recognized', { n: themeInspection.files, size: formatBytes(themeInspection.size_bytes) })}
            </div>
            {pickedPreview && (
              <div style={{ maxWidth: 420 }}>
                <ThemePreviewBox preview={pickedPreview} entries={bootEntries ?? []} />
              </div>
            )}
            <label className="form-field">
              <span>{t('view.grub-editor.theme.name', { dir: scan.themes_dir })}</span>
              <input
                type="text"
                value={themeName}
                onChange={(e) => setThemeName(e.target.value)}
                style={{ padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--ink)', maxWidth: 320 }}
              />
            </label>
            <div>
              <button className="btn btn-primary" onClick={installTheme} disabled={installingTheme || !themeName.trim()}>
                {installingTheme ? t('view.grub-editor.theme.installing') : t('view.grub-editor.theme.install')}
              </button>
            </div>
          </div>
        )}
        {themeResult && (
          <div className="form-warning" style={themeResult.success ? { color: 'var(--good)' } : { color: 'var(--critical)' }}>
            {themeResult.success ? t('view.grub-editor.theme.installed') : t('view.grub-editor.failed', { error: themeResult.error ?? '' })}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.grub-editor.presets')}</h2>
        <button className="btn btn-ghost btn-mini" onClick={savePreset}>{t('view.grub-editor.presets.save')}</button>
      </div>
      {(!presets || presets.length === 0) ? (
        <div className="glass empty-state">{t('view.grub-editor.presets.empty')}</div>
      ) : (
        <div className="clean-list">
          {presets.map((p) => (
            <div key={p.name} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path">{p.name}</span>
              <button className="btn btn-ghost btn-mini" disabled={presetBusy === p.name} onClick={() => applyPreset(p.name)}>
                {presetBusy === p.name ? '...' : t('view.grub-editor.presets.apply')}
              </button>
              <button className="btn btn-ghost btn-mini" style={{ color: 'var(--critical)' }} disabled={presetBusy === p.name} onClick={() => deletePreset(p.name)}>
                {t('common.remove')}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.grub-editor.backups')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('view.grub-editor.backups.keep')}</span>
        <input
          type="number"
          min={1}
          max={20}
          value={keepBackups}
          onChange={(e) => setKeepBackups(Math.max(1, Math.min(20, Number(e.target.value))))}
          style={{ padding: '6px 10px', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--ink)', width: 70 }}
        />
        <span style={{ fontSize: 13, color: 'var(--muted)' }}>{t('view.grub-editor.backups.keep-note')}</span>
      </div>
      {scan.backups.length === 0 ? (
        <div className="glass empty-state">{t('view.grub-editor.backups.empty')}</div>
      ) : (
        <div className="clean-list">
          {scan.backups.map((b) => (
            <div key={b.filename} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path mono">{formatDate(b.created_unix)}</span>
              <button className="btn btn-ghost btn-mini" disabled={restoring === b.filename} onClick={() => restoreBackup(b.filename)}>
                {restoring === b.filename ? t('view.grub-editor.restoring') : t('view.grub-editor.restore')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
