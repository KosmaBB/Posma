import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'

interface Entry {
  label: string
  path: string
  size_bytes: number
  files: number
}

interface Category {
  id: string
  name: string
  entries: Entry[]
  total_bytes: number
}

interface ScanData {
  categories: Category[]
  total_bytes: number
  running_browsers: string[]
}

interface CleanData {
  freed_bytes: number
  removed: number
  errors: string[]
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'scanned'; scan: ScanData }
  | { kind: 'cleaning'; scan: ScanData }
  | { kind: 'done'; result: CleanData }
  | { kind: 'error'; message: string }

/**
 * Cookies wylogowują ze wszystkich stron, historia jest nieodwracalna raz
 * skasowana — obie wymagają świadomego zaznaczenia. Cache jest bezpieczny
 * (przeglądarka odbuduje go sama) więc jest domyślnie zaznaczony.
 */
const DEFAULT_UNCHECKED = new Set(['cookies', 'history'])

export function BrowserHygieneView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [checked, setChecked] = useState<Set<string>>(() => new Set())

  async function runScan() {
    setPhase({ kind: 'scanning' })
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_browser_hygiene')
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      const preChecked = new Set<string>()
      res.data.categories.forEach((c) => {
        if (!DEFAULT_UNCHECKED.has(c.id)) c.entries.forEach((e) => preChecked.add(e.path))
      })
      setChecked(preChecked)
      setPhase({ kind: 'scanned', scan: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  async function runClean(scan: ScanData) {
    const paths = [...checked]
    if (paths.length === 0) return
    const total = selectedBytes(scan)
    if (!window.confirm(`Usunąć ${paths.length} pozycji (${formatBytes(total)})? Tej operacji nie można cofnąć.`)) {
      return
    }
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await invoke<ApiResponse<CleanData>>('clean_browser_hygiene', { paths })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setPhase({ kind: 'done', result: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  function toggle(path: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleCategory(cat: Category) {
    const allOn = cat.entries.every((e) => checked.has(e.path))
    setChecked((prev) => {
      const next = new Set(prev)
      cat.entries.forEach((e) => {
        if (allOn) next.delete(e.path)
        else next.add(e.path)
      })
      return next
    })
  }

  const scan = phase.kind === 'scanned' || phase.kind === 'cleaning' ? phase.scan : null

  const selectedBytes = useMemo(
    () => (s: ScanData) =>
      s.categories.flatMap((c) => c.entries).filter((e) => checked.has(e.path)).reduce((acc, e) => acc + e.size_bytes, 0),
    [checked],
  )

  return (
    <div>
      {phase.kind === 'idle' && (
        <div className="glass empty-state">
          Wykryje zainstalowane przeglądarki (Firefox, Chrome i pochodne) i pokaże ile miejsca zajmuje cache,
          ciasteczka i historia w każdym profilu. Nic nie zostanie usunięte bez Twojego potwierdzenia.
          <br />
          <button className="btn btn-primary" onClick={runScan}>Skanuj</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          Wykrywanie przeglądarek...
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          Błąd: {phase.message}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>Spróbuj ponownie</button>
        </div>
      )}

      {scan && (
        <>
          {scan.categories.length === 0 ? (
            <div className="glass empty-state">Nie wykryto obsługiwanych przeglądarek (Firefox, Chrome, Chromium, Brave, Edge, Opera, Vivaldi).</div>
          ) : (
            <>
              {scan.running_browsers.length > 0 && (
                <div className="form-warning" style={{ marginBottom: 14 }}>
                  Uruchomione: {scan.running_browsers.join(', ')}. Czyszczenie danych działającej przeglądarki
                  zwykle działa, ale dla pewności warto ją najpierw zamknąć.
                </div>
              )}

              <div className="clean-summary glass">
                <div>
                  <div className="cs-label">Znaleziono do wyczyszczenia</div>
                  <div className="cs-value mono">{formatBytes(scan.total_bytes)}</div>
                </div>
                <div>
                  <div className="cs-label">Zaznaczone</div>
                  <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>
                    Skanuj ponownie
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={checked.size === 0 || phase.kind === 'cleaning'}
                    onClick={() => runClean(scan)}
                  >
                    {phase.kind === 'cleaning' ? 'Czyszczenie...' : 'Wyczyść zaznaczone'}
                  </button>
                </div>
              </div>

              {scan.categories.map((cat) => {
                const allOn = cat.entries.every((e) => checked.has(e.path))
                return (
                  <div key={cat.id}>
                    <div className="section-head">
                      <h2>{cat.name}</h2>
                      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                        <span className="count">{formatBytes(cat.total_bytes)}</span>
                        <button className="btn btn-ghost btn-mini" onClick={() => toggleCategory(cat)}>
                          {allOn ? 'Odznacz wszystko' : 'Zaznacz wszystko'}
                        </button>
                      </div>
                    </div>
                    <div className="clean-list">
                      {cat.entries.map((e) => (
                        <label key={e.path} className={`glass clean-row${checked.has(e.path) ? ' checked' : ''}`}>
                          <input
                            type="checkbox"
                            checked={checked.has(e.path)}
                            onChange={() => toggle(e.path)}
                            disabled={phase.kind === 'cleaning'}
                          />
                          <span className="cr-path">{e.label}</span>
                          <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </>
      )}

      {phase.kind === 'done' && (
        <div className="glass empty-state">
          <div className="done-badge">
            <Icon name="check" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Odzyskano {formatBytes(phase.result.freed_bytes)}
          </div>
          Usunięto {phase.result.removed} pozycji.
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>... i {phase.result.errors.length - 8} więcej</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runScan}>Skanuj ponownie</button>
        </div>
      )}
    </div>
  )
}
