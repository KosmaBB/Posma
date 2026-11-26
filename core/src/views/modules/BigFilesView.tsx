import { useMemo, useState } from 'react'
import { currentBlacklist } from '../../state/settings'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

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
      const res = await callModule<ScanData>('big-files', { cmd: 'scan', min_size_mb: minSizeMb, max_results: maxResults, blacklist: currentBlacklist() })
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
    if (!(await confirmAction(t('view.big-files.confirm', { n: paths.length, size: formatBytes(bytes) })))) {
      return
    }
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await callModule<CleanData>('big-files', { cmd: 'clean', paths })
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
          <span>{t('view.big-files.min-size')}</span>
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
          <span>{t('view.big-files.max-results')}</span>
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
          {t('view.big-files.intro', { mb: minSizeMb })}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.big-files.scan')}</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          {t('view.big-files.scanning')}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.big-files.error', { message: phase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.big-files.retry')}</button>
        </div>
      )}

      {scan && scan.files.length === 0 && (
        <div className="glass empty-state">
          {t('view.big-files.none', { mb: minSizeMb })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.big-files.rescan')}</button>
        </div>
      )}

      {scan && scan.files.length > 0 && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">{t('view.big-files.total')}</div>
              <div className="cs-value mono">{formatBytes(scan.total_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">{t('view.big-files.selected')}</div>
              <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>
                {t('view.big-files.rescan')}
              </button>
              <button
                className="btn btn-primary"
                disabled={checked.size === 0 || phase.kind === 'cleaning'}
                onClick={() => runClean(scan)}
              >
                {phase.kind === 'cleaning' ? t('view.big-files.cleaning') : t('view.big-files.remove-selected')}
              </button>
            </div>
          </div>

          <div className="section-head">
            <h2>{t('view.big-files.heading')}</h2>
            <span className="count">
              {scan.truncated
                ? t('view.big-files.count-truncated', { n: scan.files.length, max: maxResults })
                : t('view.big-files.count', { n: scan.files.length })}
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.big-files.recovered', { size: formatBytes(phase.result.freed_bytes) })}
          </div>
          {t('view.big-files.removed', { n: phase.result.removed })}
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>{t('view.big-files.more-errors', { n: phase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.big-files.rescan')}</button>
        </div>
      )}
    </div>
  )
}
