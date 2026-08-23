import { useMemo, useState } from 'react'
import { currentBlacklist } from '../../state/settings'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'

interface FileEntry {
  path: string
  size_bytes: number
}

interface ScanData {
  files: FileEntry[]
  total_bytes: number
  truncated: boolean
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

const MIN_SIZE_BOUNDS = { min: 1, max: 100_000 }
const MAX_RESULTS_BOUNDS = { min: 1, max: 2000 }

export function BigFilesView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [minSizeMb, setMinSizeMb] = useState(20)
  const [maxResults, setMaxResults] = useState(200)

  async function runScan() {
    setPhase({ kind: 'scanning' })
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_big_files', { minSizeMb, maxResults, blacklist: currentBlacklist() })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setChecked(new Set())
      setPhase({ kind: 'scanned', scan: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  async function runClean(scan: ScanData) {
    const paths = [...checked]
    if (paths.length === 0) return
    const bytes = selectedBytes(scan)
    if (!window.confirm(`Usunąć ${paths.length} plików (${formatBytes(bytes)})? Tej operacji nie można cofnąć.`)) {
      return
    }
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await invoke<ApiResponse<CleanData>>('clean_big_files', { paths })
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

  const scan = phase.kind === 'scanned' || phase.kind === 'cleaning' ? phase.scan : null
  const selectedBytes = useMemo(
    () => (s: ScanData) => s.files.filter((f) => checked.has(f.path)).reduce((acc, f) => acc + f.size_bytes, 0),
    [checked],
  )

  const scanning = phase.kind === 'scanning' || phase.kind === 'cleaning'

  return (
    <div>
      <div className="glass scan-options">
        <label className="scan-option">
          <span>Minimalny rozmiar</span>
          <div className="scan-option-input">
            <input
              type="number"
              min={MIN_SIZE_BOUNDS.min}
              max={MIN_SIZE_BOUNDS.max}
              value={minSizeMb}
              disabled={scanning}
              onChange={(e) => setMinSizeMb(Math.min(MIN_SIZE_BOUNDS.max, Math.max(MIN_SIZE_BOUNDS.min, Number(e.target.value) || MIN_SIZE_BOUNDS.min)))}
            />
            <span className="mono">MB</span>
          </div>
        </label>
        <label className="scan-option">
          <span>Maks. liczba wyników</span>
          <div className="scan-option-input">
            <input
              type="number"
              min={MAX_RESULTS_BOUNDS.min}
              max={MAX_RESULTS_BOUNDS.max}
              value={maxResults}
              disabled={scanning}
              onChange={(e) => setMaxResults(Math.min(MAX_RESULTS_BOUNDS.max, Math.max(MAX_RESULTS_BOUNDS.min, Number(e.target.value) || MAX_RESULTS_BOUNDS.min)))}
            />
          </div>
        </label>
      </div>

      {phase.kind === 'idle' && (
        <div className="glass empty-state">
          Przeszukaj katalog domowy w poszukiwaniu plików większych niż {minSizeMb} MB — od instalatorów po
          zapomniane obrazy maszyn wirtualnych. Katalog .git jest pomijany.
          <br />
          <button className="btn btn-primary" onClick={runScan}>Skanuj</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          Szukanie dużych plików...
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          Błąd: {phase.message}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>Spróbuj ponownie</button>
        </div>
      )}

      {scan && scan.files.length === 0 && (
        <div className="glass empty-state">
          Nie znaleziono plików większych niż {minSizeMb} MB.
          <br />
          <button className="btn btn-ghost" onClick={runScan}>Skanuj ponownie</button>
        </div>
      )}

      {scan && scan.files.length > 0 && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">Łącznie</div>
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
                {phase.kind === 'cleaning' ? 'Czyszczenie...' : 'Usuń zaznaczone'}
              </button>
            </div>
          </div>

          <div className="section-head">
            <h2>Największe pliki</h2>
            <span className="count">
              {scan.files.length} {scan.truncated ? `(pokazano ${maxResults} największych)` : 'plików'}
            </span>
          </div>

          <div className="clean-list">
            {scan.files.map((f) => (
              <label key={f.path} className={`glass clean-row${checked.has(f.path) ? ' checked' : ''}`}>
                <input
                  type="checkbox"
                  checked={checked.has(f.path)}
                  onChange={() => toggle(f.path)}
                  disabled={phase.kind === 'cleaning'}
                />
                <span className="cr-path mono">{f.path}</span>
                <span className="cr-size mono">{formatBytes(f.size_bytes)}</span>
              </label>
            ))}
          </div>
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
          Usunięto {phase.result.removed} plików.
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
