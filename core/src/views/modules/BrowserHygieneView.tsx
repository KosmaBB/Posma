import { useMemo, useState } from 'react'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

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
      const res = await callModule<ScanData>('browser-hygiene', { cmd: 'scan' })
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
    if (!(await confirmAction(t('view.browser-hygiene.clean.confirm', { n: paths.length, size: formatBytes(total) })))) {
      return
    }
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await callModule<CleanData>('browser-hygiene', { cmd: 'clean', paths })
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
          {t('view.browser-hygiene.intro')}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.browser-hygiene.scan')}</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          {t('view.browser-hygiene.scanning')}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.browser-hygiene.error', { error: phase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.browser-hygiene.retry')}</button>
        </div>
      )}

      {scan && (
        <>
          {scan.categories.length === 0 ? (
            <div className="glass empty-state">{t('view.browser-hygiene.none')}</div>
          ) : (
            <>
              {scan.running_browsers.length > 0 && (
                <div className="form-warning" style={{ marginBottom: 14 }}>
                  {t('view.browser-hygiene.running', { names: scan.running_browsers.join(', ') })}
                </div>
              )}

              <div className="clean-summary glass">
                <div>
                  <div className="cs-label">{t('view.browser-hygiene.found')}</div>
                  <div className="cs-value mono">{formatBytes(scan.total_bytes)}</div>
                </div>
                <div>
                  <div className="cs-label">{t('view.browser-hygiene.selected')}</div>
                  <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>
                    {t('view.browser-hygiene.scan-again')}
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={checked.size === 0 || phase.kind === 'cleaning'}
                    onClick={() => runClean(scan)}
                  >
                    {phase.kind === 'cleaning' ? t('view.browser-hygiene.cleaning') : t('view.browser-hygiene.clean-selected')}
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
                          {allOn ? t('view.browser-hygiene.deselect-all') : t('view.browser-hygiene.select-all')}
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.browser-hygiene.freed', { size: formatBytes(phase.result.freed_bytes) })}
          </div>
          {t('view.browser-hygiene.removed', { n: phase.result.removed })}
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>{t('view.browser-hygiene.more-errors', { n: phase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.browser-hygiene.scan-again')}</button>
        </div>
      )}
    </div>
  )
}
