import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from '../../components/Icons'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { formatNumber, t } from '../../i18n'

interface Entry {
  path: string
  size_bytes: number
  files: number
}

interface Category {
  id: string
  name: string
  entries: Entry[]
  total_bytes: number
  /** Outside the user's reach — cleaned through the broker. */
  privileged: boolean
}

interface ScanData {
  categories: Category[]
  total_bytes: number
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

// The language's decimal mark, no thousands grouping, as the rest of the app writes sizes.
const fixed = (n: number, digits: number) =>
  formatNumber(n, { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: false })

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${fixed(bytes / 1024 ** 3, 2)} GB`
  if (bytes >= 1024 ** 2) return `${fixed(bytes / 1024 ** 2, 1)} MB`
  if (bytes >= 1024) return `${fixed(bytes / 1024, 0)} KB`
  return `${bytes} B`
}

/**
 * Kategoria "appcache" wymaga świadomej decyzji (wyloguje z sesji web,
 * spowolni pierwsze uruchomienia); kategorie systemowe idą przez brokera i
 * system zapyta o zgodę administratora — obie domyślnie odznaczone, żeby
 * "zaznacz wszystko" nie robiło tego bez wyraźnej decyzji. Reszta bezpieczna.
 */
const uncheckedByDefault = (c: Category) => c.privileged || c.id === 'appcache'

export function TempCleanView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [checked, setChecked] = useState<Set<string>>(() => new Set())

  async function runScan() {
    setPhase({ kind: 'scanning' })
    try {
      const res = await callModule<ScanData>('temp-clean', { cmd: 'scan' })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      const preChecked = new Set<string>()
      res.data.categories.forEach((c) => {
        if (!uncheckedByDefault(c)) c.entries.forEach((e) => preChecked.add(e.path))
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
    if (!(await confirmAction(t('view.temp-clean.confirm', { n: paths.length, size: formatBytes(total) })))) {
      return
    }
    setPhase({ kind: 'cleaning', scan })

    // Kategorie systemowe leżą poza katalogiem użytkownika — nieuprzywilejowany
    // moduł nie ma do nich prawa zapisu, więc idą osobną drogą przez brokera
    // (fs-system, Access_plan.md §6 krok 3).
    const systemPaths = new Set(scan.categories.filter((c) => c.privileged).flatMap((c) => c.entries.map((e) => e.path)))
    const syslogPaths = paths.filter((p) => systemPaths.has(p))
    const restPaths = paths.filter((p) => !systemPaths.has(p))

    const merged: CleanData = { freed_bytes: 0, removed: 0, errors: [] }

    if (restPaths.length > 0) {
      try {
        const res = await callModule<CleanData>('temp-clean', { cmd: 'clean', paths: restPaths })
        if (res.ok) {
          merged.freed_bytes += res.data.freed_bytes
          merged.removed += res.data.removed
          merged.errors.push(...res.data.errors)
        } else {
          merged.errors.push(res.error)
        }
      } catch (e) {
        merged.errors.push(String(e))
      }
    }

    if (syslogPaths.length > 0) {
      try {
        // Linux pyta przez pkexec przy każdym wywołaniu (tryb Wybiórczy),
        // Windows raz na uruchomienie POSMA.
        await invoke('request_permission', { capability: 'fs-system' })
        const res = await invoke<ApiResponse<CleanData>>('clean_system_paths', { paths: syslogPaths })
        if (res.ok) {
          merged.freed_bytes += res.data.freed_bytes
          merged.removed += res.data.removed
          merged.errors.push(...res.data.errors)
        } else {
          merged.errors.push(res.error)
        }
      } catch (e) {
        merged.errors.push(t('view.temp-clean.system-files-error', { error: String(e) }))
      }
    }

    setPhase({ kind: 'done', result: merged })
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
          {t('view.temp-clean.intro')}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.temp-clean.scan')}</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          {t('view.temp-clean.scanning')}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.temp-clean.error', { message: phase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.temp-clean.retry')}</button>
        </div>
      )}

      {scan && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">{t('view.temp-clean.found')}</div>
              <div className="cs-value mono">{formatBytes(scan.total_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">{t('view.temp-clean.selected')}</div>
              <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>
                {t('view.temp-clean.rescan')}
              </button>
              <button
                className="btn btn-primary"
                disabled={checked.size === 0 || phase.kind === 'cleaning'}
                onClick={() => runClean(scan)}
              >
                {phase.kind === 'cleaning' ? t('view.temp-clean.cleaning') : t('view.temp-clean.clean-selected')}
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
                      {allOn ? t('view.temp-clean.deselect-all') : t('view.temp-clean.select-all')}
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
                      <span className="cr-path mono">{e.path}</span>
                      <span className="cr-files">{t('view.temp-clean.files', { n: e.files })}</span>
                      <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )
          })}
        </>
      )}

      {phase.kind === 'done' && (
        <div className="glass empty-state">
          <div className="done-badge">
            <Icon name="check" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.temp-clean.recovered', { size: formatBytes(phase.result.freed_bytes) })}
          </div>
          {t('view.temp-clean.removed', { n: phase.result.removed })}
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>{t('view.temp-clean.more-errors', { n: phase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.temp-clean.rescan')}</button>
        </div>
      )}
    </div>
  )
}
