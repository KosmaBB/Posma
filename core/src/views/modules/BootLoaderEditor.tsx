import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { confirmAction } from '../../components/confirm'
import { BOOTLOADER_LABEL } from '../../data/linuxProfile'
import { t, locale } from '../../i18n'

export interface BackupEntry {
  filename: string
  created_unix: number
}

interface BootOptions {
  loader: string
  path: string
  default_entry: string | null
  timeout: string | null
}

interface BootMenu {
  entries: string[]
  options: BootOptions | null
}

interface ExecResult {
  success: boolean
  output: string
  error: string | null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

/** What each loader accepts in its two settings, as its own documentation puts it. */
const HINTS: Record<string, () => { default: string; timeout: string }> = {
  limine: () => ({
    default: t('view.boot-loader.hint.limine.default'),
    timeout: t('view.boot-loader.hint.limine.timeout'),
  }),
  'systemd-boot': () => ({
    default: t('view.boot-loader.hint.systemd-boot.default'),
    timeout: t('view.boot-loader.hint.systemd-boot.timeout'),
  }),
  refind: () => ({
    default: t('view.boot-loader.hint.refind.default'),
    timeout: t('view.boot-loader.hint.refind.timeout'),
  }),
}

const failed = (error: string): ExecResult => ({ success: false, output: '', error })

interface Props {
  loader: string
  backups: BackupEntry[]
  keepBackups: number
  onChanged: () => void
}

/**
 * Limine, systemd-boot and rEFInd read their config themselves at boot,
 * from the ESP, which only root can read — so even showing the settings
 * goes through the broker, and only once asked. The broker changes the two
 * lines itself; nothing here sends file content.
 */
export function BootLoaderEditor({ loader, backups, keepBackups, onChanged }: Props) {
  const name = BOOTLOADER_LABEL[loader] ?? loader
  const hint = HINTS[loader]?.()
  const [menu, setMenu] = useState<BootMenu | null>(null)
  const [defaultEntry, setDefaultEntry] = useState('')
  const [timeout, setTimeoutValue] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<ExecResult | null>(null)

  async function load() {
    setBusy('load')
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await invoke<ApiResponse<BootMenu>>('read_boot_entries')
      if (!res.ok) return setResult(failed(res.error))
      // The broker looks as root; where it sees GRUB, the profile was set by hand.
      if (!res.data.options) return setResult(failed(t('view.boot-loader.error.not-this-loader', { name })))
      setMenu(res.data)
      setDefaultEntry(res.data.options.default_entry ?? '')
      setTimeoutValue(res.data.options.timeout ?? '')
    } catch (e) {
      setResult(failed(String(e)))
    } finally {
      setBusy(null)
    }
  }

  async function run(action: string, question: string, call: () => Promise<ApiResponse<ExecResult>>) {
    if (!(await confirmAction(question))) return false
    setBusy(action)
    setResult(null)
    try {
      await invoke('request_permission', { capability: 'boot' })
      const res = await call()
      const outcome = res.ok ? res.data : failed(res.error)
      setResult(outcome)
      if (outcome.success) onChanged()
      return outcome.success
    } catch (e) {
      setResult(failed(String(e)))
      return false
    } finally {
      setBusy(null)
    }
  }

  const save = () =>
    run('save', t('view.boot-loader.save.confirm', { name }), () =>
      invoke('set_boot_options', { defaultEntry: defaultEntry.trim() || null, timeout: timeout.trim() || null, keepBackups }),
    )

  async function restore(filename: string) {
    if (!menu?.options) return
    const path = menu.options.path
    const restored = await run('restore:' + filename, t('view.boot-loader.restore.confirm'), () =>
      invoke('restore_grub_backup', { filename, keepBackups, path }),
    )
    if (restored) load()
  }

  return (
    <div>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>{t('view.boot-loader.title', { name })}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!menu ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {t('view.boot-loader.intro', { name })}
            </div>
            <div>
              <button className="btn btn-primary" onClick={() => { setResult(null); load() }} disabled={busy !== null}>
                {busy === 'load' ? t('view.boot-loader.loading') : t('view.boot-loader.load')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{menu.options?.path}</div>
            <label className="form-field">
              <span>{t('view.boot-loader.default-entry')}</span>
              <input list="boot-loader-entries" type="text" value={defaultEntry} onChange={(e) => setDefaultEntry(e.target.value)} />
              <datalist id="boot-loader-entries">
                {menu.entries.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{hint?.default}</div>
            </label>
            <label className="form-field">
              <span>{t('view.boot-loader.timeout')}</span>
              <input type="text" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} style={{ maxWidth: 160 }} />
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{hint?.timeout} {t('view.boot-loader.empty-keeps')}</div>
            </label>
            <div>
              <button className="btn btn-primary" onClick={save} disabled={busy !== null}>
                {busy === 'save' ? t('view.boot-loader.saving') : t('view.boot-loader.save')}
              </button>
            </div>
          </>
        )}
        {result && (
          <div className="form-warning" style={{ color: result.success ? 'var(--good)' : 'var(--critical)' }}>
            {result.success ? t('view.boot-loader.saved') : t('view.boot-loader.failed', { error: result.error ?? '' })}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>{t('view.boot-loader.backups')}</h2>
      </div>
      {backups.length === 0 ? (
        <div className="glass empty-state">{t('view.boot-loader.backups.empty')}</div>
      ) : (
        <div className="clean-list">
          {backups.map((b) => (
            <div key={b.filename} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path mono">{new Date(b.created_unix * 1000).toLocaleString(locale())}</span>
              <button
                className="btn btn-ghost btn-mini"
                disabled={!menu || busy !== null}
                title={menu ? undefined : t('view.boot-loader.load-first')}
                onClick={() => restore(b.filename)}
              >
                {busy === 'restore:' + b.filename ? t('view.boot-loader.restoring') : t('view.boot-loader.restore')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
