import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { confirmAction } from '../../components/confirm'
import { BOOTLOADER_LABEL } from '../../data/linuxProfile'

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
const HINTS: Record<string, { default: string; timeout: string }> = {
  limine: {
    default: 'Ścieżka wpisu z listy (np. CachyOS/linux-cachyos) albo jego numer, licząc od 1. Gdy plik ustawia remember_last_entry: yes, Limine woli ostatnio uruchomiony wpis.',
    timeout: 'Sekundy; „no” — czekaj na wybór, 0 — bez menu.',
  },
  'systemd-boot': {
    default: 'Identyfikator wpisu z listy (np. arch.conf), wzorzec z * albo @saved — ostatnio wybrany. Wpis ustawiony w samym menu klawiszem d ma pierwszeństwo.',
    timeout: 'Sekundy; menu-force — czekaj na wybór, menu-hidden — menu tylko po wciśnięciu klawisza.',
  },
  refind: {
    default: 'Fragment nazwy wpisu albo jego numer od 1. rEFInd większość systemów znajduje sam przy starcie, więc lista ma tylko wpisy zapisane w refind.conf.',
    timeout: 'Sekundy; 0 — czekaj na wybór, -1 — uruchom od razu.',
  },
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
  const hint = HINTS[loader]
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
      if (!res.data.options) return setResult(failed(`Jako administrator ten system nie wygląda na uruchamiany przez ${name} — sprawdź „Program rozruchowy” w ustawieniach.`))
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
    run('save', `Zapisać ustawienia ${name}? Poprzednia konfiguracja zostanie zachowana jako kopia zapasowa.`, () =>
      invoke('set_boot_options', { defaultEntry: defaultEntry.trim() || null, timeout: timeout.trim() || null, keepBackups }),
    )

  async function restore(filename: string) {
    if (!menu?.options) return
    const path = menu.options.path
    const restored = await run('restore:' + filename, 'Przywrócić tę kopię zapasową? Bieżąca konfiguracja też zostanie zapisana jako kopia.', () =>
      invoke('restore_grub_backup', { filename, keepBackups, path }),
    )
    if (restored) load()
  }

  return (
    <div>
      <div className="section-head">
        <h2 style={{ fontSize: 14 }}>Rozruch: {name}</h2>
      </div>
      <div className="glass" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {!menu ? (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              {name} czyta konfigurację z partycji rozruchowej, którą odczytuje tylko administrator — dlatego już podgląd ustawień prosi o zgodę.
            </div>
            <div>
              <button className="btn btn-primary" onClick={() => { setResult(null); load() }} disabled={busy !== null}>
                {busy === 'load' ? 'Wczytywanie...' : 'Wczytaj ustawienia'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mono" style={{ fontSize: 13, color: 'var(--muted)' }}>{menu.options?.path}</div>
            <label className="form-field">
              <span>Domyślny wpis</span>
              <input list="boot-loader-entries" type="text" value={defaultEntry} onChange={(e) => setDefaultEntry(e.target.value)} />
              <datalist id="boot-loader-entries">
                {menu.entries.map((entry) => <option key={entry} value={entry} />)}
              </datalist>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{hint?.default}</div>
            </label>
            <label className="form-field">
              <span>Czas oczekiwania</span>
              <input type="text" value={timeout} onChange={(e) => setTimeoutValue(e.target.value)} style={{ maxWidth: 160 }} />
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{hint?.timeout} Puste pole zostawia ustawienie bez zmian.</div>
            </label>
            <div>
              <button className="btn btn-primary" onClick={save} disabled={busy !== null}>
                {busy === 'save' ? 'Zapisywanie...' : 'Zapisz ustawienia'}
              </button>
            </div>
          </>
        )}
        {result && (
          <div className="form-warning" style={{ color: result.success ? 'var(--good)' : 'var(--critical)' }}>
            {result.success ? 'Zapisano — zmiana zadziała przy następnym uruchomieniu.' : `Nie udało się: ${result.error}`}
          </div>
        )}
      </div>

      <div className="section-head" style={{ marginTop: 20 }}>
        <h2 style={{ fontSize: 14 }}>Kopie zapasowe</h2>
      </div>
      {backups.length === 0 ? (
        <div className="glass empty-state">Brak kopii zapasowych — pojawią się po pierwszym zapisie.</div>
      ) : (
        <div className="clean-list">
          {backups.map((b) => (
            <div key={b.filename} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
              <span className="cr-path mono">{new Date(b.created_unix * 1000).toLocaleString('pl-PL')}</span>
              <button
                className="btn btn-ghost btn-mini"
                disabled={!menu || busy !== null}
                title={menu ? undefined : 'Najpierw wczytaj ustawienia'}
                onClick={() => restore(b.filename)}
              >
                {busy === 'restore:' + b.filename ? 'Przywracanie...' : 'Przywróć'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
