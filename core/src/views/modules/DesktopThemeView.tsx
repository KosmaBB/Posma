import { useEffect, useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

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
  get theme() { return t('view.desktop-theme.kind.theme') },
  get icons() { return t('view.desktop-theme.kind.icons') },
  get cursor() { return t('view.desktop-theme.kind.cursor') },
  get font() { return t('view.desktop-theme.kind.font') },
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
    <label className="form-field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {missing && <option value={value}>{t('view.desktop-theme.missing', { value })}</option>}
        {entries.map((e) => (
          <option key={e.name} value={e.name}>
            {e.name}
            {e.user_installed ? t('view.desktop-theme.own') : ''}
          </option>
        ))}
      </select>
    </label>
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
      const res = await callModule<ScanData>('desktop-theme', { cmd: 'scan' })
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
      const res = await callModule<ApplyResult>('desktop-theme', { cmd: 'apply', changes: pending })
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
      title: t('view.desktop-theme.install.pick-title'),
    })
    if (typeof dir !== 'string') return
    setInstalling(true)
    setInstallResult(null)
    setInstallError(null)
    try {
      const res = await callModule<InstallResult>('desktop-theme', {
        cmd: 'install_theme',
        source_dir: dir,
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
      title: t('view.desktop-theme.install.pick-font'),
      filters: [{ name: t('view.desktop-theme.install.fonts-filter'), extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2'] }],
    })
    if (typeof file !== 'string') return
    setInstalling(true)
    setInstallResult(null)
    setInstallError(null)
    try {
      const res = await callModule<InstallResult>('desktop-theme', { cmd: 'install_font', path: file })
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
      const res = await callModule<string[]>('desktop-theme', { cmd: 'save_preset', name })
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
    if (!(await confirmAction(t('view.desktop-theme.presets.apply.confirm', { name })))) return
    setPresetBusy(name)
    setApplyResult(null)
    try {
      const res = await callModule<ApplyResult>('desktop-theme', { cmd: 'load_preset', name })
      setApplyResult(res.ok ? res.data : { success: false, applied: [], failed: [res.error] })
      if (res.ok) loadScan()
    } finally {
      setPresetBusy(null)
    }
  }

  async function deletePreset(name: string) {
    if (!(await confirmAction(t('view.desktop-theme.presets.delete.confirm', { name })))) return
    setPresetBusy(name)
    try {
      await callModule<string[]>('desktop-theme', { cmd: 'delete_preset', name })
      loadScan()
    } finally {
      setPresetBusy(null)
    }
  }

  if (loading) return <div className="scan-spinner">{t('view.desktop-theme.scanning')}</div>

  if (scanError) {
    return (
      <div className="glass empty-state">
        <p>{t('view.desktop-theme.read-failed')}</p>
        <p className="mono" style={{ fontSize: 13 }}>{scanError}</p>
        <button className="btn btn-ghost" onClick={loadScan}>{t('view.desktop-theme.retry')}</button>
      </div>
    )
  }

  if (!scan || !draft) {
    return (
      <div className="glass empty-state">
        <p>{t('view.desktop-theme.no-data')}</p>
        <button className="btn btn-ghost" onClick={loadScan}>{t('view.desktop-theme.refresh')}</button>
      </div>
    )
  }

  const locked = !scan.supported

  return (
    <>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>{t('view.desktop-theme.environment')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 13 }}>
          {t('view.desktop-theme.detected')} <strong>{scan.desktop_name}</strong>
        </div>
        {locked && (
          <div className="form-warning">
            {scan.unsupported_reason ?? t('view.desktop-theme.unsupported')} {t('view.desktop-theme.locked-note')}
          </div>
        )}
        {scan.desktop === 'plasma' && (
          <div className="form-warning">
            {t('view.desktop-theme.plasma-note')}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.desktop-theme.appearance')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <ThemeSelect
          label={t('view.desktop-theme.gtk')}
          value={draft.gtk_theme}
          entries={scan.gtk_themes}
          disabled={locked}
          onChange={(v) => setDraft({ ...draft, gtk_theme: v })}
        />
        <ThemeSelect
          label={t('view.desktop-theme.icons')}
          value={draft.icon_theme}
          entries={scan.icon_themes}
          disabled={locked}
          onChange={(v) => setDraft({ ...draft, icon_theme: v })}
        />
        <ThemeSelect
          label={t('view.desktop-theme.cursor')}
          value={draft.cursor_theme}
          entries={scan.cursor_themes}
          disabled={locked}
          onChange={(v) => setDraft({ ...draft, cursor_theme: v })}
        />

        {/* Hidden rather than disabled when the session has no such key —
            a greyed-out control invites the question "why not?". */}
        {scan.color_scheme_supported && (
          <label className="form-field">
            <span>{t('view.desktop-theme.mode')}</span>
            <select
              value={draft.color_scheme}
              disabled={locked}
              onChange={(e) => setDraft({ ...draft, color_scheme: e.target.value })}
            >
              <option value="default">{t('view.desktop-theme.mode.default')}</option>
              <option value="prefer-light">{t('view.desktop-theme.mode.light')}</option>
              <option value="prefer-dark">{t('view.desktop-theme.mode.dark')}</option>
            </select>
          </label>
        )}

        <label className="form-field">
          <span>{t('view.desktop-theme.font')}</span>
          <input
            type="text"
            value={draft.font}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, font: e.target.value })}
            list="posma-fonts"
          />
        </label>
        <label className="form-field">
          <span>{t('view.desktop-theme.font-mono')}</span>
          <input
            type="text"
            value={draft.monospace_font}
            disabled={locked}
            onChange={(e) => setDraft({ ...draft, monospace_font: e.target.value })}
            list="posma-fonts"
          />
        </label>

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
            {saving ? t('view.desktop-theme.saving') : pendingCount > 0 ? t('view.desktop-theme.apply', { n: pendingCount }) : t('view.desktop-theme.no-changes')}
          </button>
          {pendingCount > 0 && (
            <button className="btn btn-ghost" onClick={() => setDraft(scan.current)} disabled={saving}>
              {t('view.desktop-theme.revert')}
            </button>
          )}
        </div>

        {applyResult && (
          <div className={applyResult.success ? 'cr-path' : 'form-warning'}>
            {applyResult.applied.length > 0 && <div>{t('view.desktop-theme.applied', { list: applyResult.applied.join(', ') })}</div>}
            {applyResult.failed.map((f, i) => (
              <div key={i}>{f}</div>
            ))}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.desktop-theme.install')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('view.desktop-theme.install.note')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" onClick={installTheme} disabled={installing}>
            {t('view.desktop-theme.install.theme')}
          </button>
          <button className="btn btn-ghost" onClick={installFont} disabled={installing}>
            {t('view.desktop-theme.install.font')}
          </button>
        </div>
        {installResult && (
          <div className="cr-path">
            {t('view.desktop-theme.install.done', {
              kind: KIND_LABEL[installResult.kind] ?? installResult.kind,
              name: installResult.name,
              n: installResult.files,
            })}{' '}
            <span className="mono">{installResult.destination}</span>
          </div>
        )}
        {installError && <div className="form-warning">{installError}</div>}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.desktop-theme.presets')}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          {t('view.desktop-theme.presets.note')}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder={t('view.desktop-theme.presets.placeholder')}
            value={presetName}
            disabled={locked}
            onChange={(e) => setPresetName(e.target.value)}
          />
          <button
            className="btn btn-ghost"
            onClick={savePreset}
            disabled={locked || !presetName.trim() || presetBusy !== null}
          >
            {t('view.desktop-theme.presets.save')}
          </button>
        </div>
        {scan.presets.length === 0 ? (
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('view.desktop-theme.presets.empty')}</div>
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
                    {t('view.desktop-theme.presets.apply')}
                  </button>
                  <button
                    className="btn btn-ghost btn-mini"
                    onClick={() => deletePreset(name)}
                    disabled={presetBusy === name}
                  >
                    {t('common.remove')}
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
