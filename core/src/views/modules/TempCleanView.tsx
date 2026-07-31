import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from '../../components/Icons'

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

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${bytes} B`
}

/**
 * Kategoria "appcache" wymaga świadomej decyzji (wyloguje z sesji web,
 * spowolni pierwsze uruchomienia); "syslog" idzie przez brokera i wywoła
 * prompt hasła administratora (pkexec) — obie domyślnie odznaczone, żeby
 * "zaznacz wszystko" nie robiło tego bez wyraźnej decyzji. Reszta bezpieczna.
 */
const DEFAULT_UNCHECKED = new Set(['appcache', 'syslog'])

export function TempCleanView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [checked, setChecked] = useState<Set<string>>(() => new Set())

  async function runScan() {
    setPhase({ kind: 'scanning' })
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_temp')
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

    // Logi systemowe leżą poza katalogiem użytkownika — nieuprzywilejowany
    // sidecar temp-clean nie ma do nich prawa zapisu, więc idą osobną drogą
    // przez brokera (fs-system, Access_plan.md §6 krok 3), zamiast razem z
    // resztą przez zwykłe clean_temp.
    const categoryOf = new Map<string, string>()
    scan.categories.forEach((c) => c.entries.forEach((e) => categoryOf.set(e.path, c.id)))
    const syslogPaths = paths.filter((p) => categoryOf.get(p) === 'syslog')
    const restPaths = paths.filter((p) => categoryOf.get(p) !== 'syslog')

    const merged: CleanData = { freed_bytes: 0, removed: 0, errors: [] }

    if (restPaths.length > 0) {
      try {
        const res = await invoke<ApiResponse<CleanData>>('clean_temp', { paths: restPaths })
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
        // Poprosi o hasło administratora przez pkexec przy każdym wywołaniu
        // (tryb Wybiórczy) — tak jak zaplanowano, dopóki nie zainstalujemy
        // polityki polkit dla trybu Pełnego.
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
        merged.errors.push(`Logi systemowe: ${String(e)}`)
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
          Przeskanuj znane lokalizacje plików tymczasowych — nic nie zostanie usunięte bez Twojego potwierdzenia.
          <br />
          <button className="btn btn-primary" onClick={runScan}>Skanuj</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          Skanowanie lokalizacji tymczasowych...
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
                {phase.kind === 'cleaning' ? 'Czyszczenie...' : `Wyczyść zaznaczone`}
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
                      <span className="cr-path mono">{e.path}</span>
                      <span className="cr-files">{e.files} plików</span>
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
