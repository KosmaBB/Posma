import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Icon } from '../../components/Icons'
import { MissingDependency } from '../../components/MissingDependency'
import { Modal } from '../../components/Modal'
import { formatBytes } from './TempCleanView'

// ------------------------------------------------------------- shared types

interface OrphanEntry {
  name: string
  path: string
  source: 'config' | 'cache' | 'data'
  size_bytes: number
  files: number
  age_days: number | null
}

interface CleanData {
  freed_bytes: number
  removed: number
  errors: string[]
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

const RECENT_DAYS = 14

function ageLabel(days: number | null): string {
  if (days === null) return 'nieznany wiek'
  if (days === 0) return 'dziś'
  if (days === 1) return 'wczoraj'
  return `${days} dni temu`
}

// ---------------------------------------------------------------- app list

interface InstalledApp {
  id: string
  name: string
  version: string
  source: 'apt' | 'flatpak' | 'snap'
  size_bytes: number | null
  user_scope: boolean
  description: string
}

interface AppRef {
  source: string
  id: string
  user_scope: boolean
}

interface UninstallResult {
  success: boolean
  output: string
  error: string | null
  install_hint: string | null
}

const SOURCE_LABEL: Record<string, string> = { apt: 'apt', flatpak: 'flatpak', snap: 'snap' }

function AppDetail({ app, onClose, onUninstalled }: { app: InstalledApp; onClose: () => void; onUninstalled: () => void }) {
  const [leftovers, setLeftovers] = useState<OrphanEntry[] | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [leftoversLoading, setLeftoversLoading] = useState(false)
  const [uninstallState, setUninstallState] = useState<'idle' | 'running' | UninstallResult>('idle')
  const [cleanResult, setCleanResult] = useState<CleanData | null>(null)
  const [cleaning, setCleaning] = useState(false)
  const [sortMode, setSortMode] = useState<'size' | 'age'>('size')

  const appRef: AppRef = { source: app.source, id: app.id, user_scope: app.user_scope }

  async function loadLeftovers() {
    setLeftoversLoading(true)
    try {
      const res = await invoke<ApiResponse<OrphanEntry[]>>('app_leftovers', { appRef, name: app.name })
      if (res.ok) setLeftovers(res.data)
    } finally {
      setLeftoversLoading(false)
    }
  }

  useEffect(() => {
    loadLeftovers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function runUninstall() {
    if (!window.confirm(`Odinstalować "${app.name}"? Ta operacja zmienia system i może wymagać uprawnień administratora.`)) return
    setUninstallState('running')
    try {
      let res: ApiResponse<UninstallResult>
      if (app.source === 'apt' || app.source === 'snap') {
        // apt/snap zawsze wymagają roota — idzie od razu przez brokera
        // (Access_plan.md §6 krok 3) zamiast czekać na nieuprzywilejowaną
        // próbę i pokazywać podpowiedź "uruchom ręcznie sudo ...".
        await invoke('request_permission', { capability: 'pkg' })
        const raw = await invoke<ApiResponse<{ success: boolean; output: string; error: string | null }>>(
          'uninstall_pkg_privileged',
          { source: app.source, id: app.id },
        )
        res = raw.ok ? { ok: true, data: { ...raw.data, install_hint: null } } : raw
      } else {
        res = await invoke<ApiResponse<UninstallResult>>('uninstall_app', { appRef })
      }
      const result = res.ok ? res.data : { success: false, output: '', error: res.error, install_hint: null }
      setUninstallState(result)
      if (result.success) onUninstalled()
    } catch (e) {
      setUninstallState({ success: false, output: '', error: String(e), install_hint: null })
    }
  }

  async function runClean() {
    const paths = [...checked]
    if (paths.length === 0) return
    setCleaning(true)
    try {
      const res = await invoke<ApiResponse<CleanData>>('clean_uninstaller', { paths })
      if (res.ok) {
        setCleanResult(res.data)
        setLeftovers((prev) => prev?.filter((e) => !checked.has(e.path)) ?? null)
        setChecked(new Set())
      }
    } finally {
      setCleaning(false)
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

  function toggleAll() {
    if (!leftovers) return
    const allOn = leftovers.every((e) => checked.has(e.path))
    setChecked(allOn ? new Set() : new Set(leftovers.map((e) => e.path)))
  }

  async function openFolder(path: string) {
    try {
      await revealItemInDir(path)
    } catch {
      // best-effort — no file manager available or the path is gone; not
      // worth a whole error state over a convenience action
    }
  }

  const sortedLeftovers = useMemo(() => {
    if (!leftovers) return null
    const arr = [...leftovers]
    if (sortMode === 'size') arr.sort((a, b) => b.size_bytes - a.size_bytes)
    else arr.sort((a, b) => (b.age_days ?? -1) - (a.age_days ?? -1))
    return arr
  }, [leftovers, sortMode])

  const failedUninstall = typeof uninstallState === 'object' && !uninstallState.success

  return (
    <Modal onClose={onClose} style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
          <div>
            <h3 style={{ fontSize: 17 }}>{app.name}</h3>
            <div className="mono" style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
              {SOURCE_LABEL[app.source]} · {app.id} · {app.version}
              {app.size_bytes ? ` · ${formatBytes(app.size_bytes)}` : ''}
            </div>
          </div>
          <button className="btn btn-ghost btn-mini" onClick={onClose}>Zamknij</button>
        </div>
        {app.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{app.description}</div>}

        <div className="form-field" style={{ marginTop: 10 }}>
          <span>Odinstalowanie programu</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary"
              style={{ background: 'linear-gradient(135deg, var(--g-red-1), var(--g-red-2))' }}
              onClick={runUninstall}
              disabled={uninstallState === 'running'}
            >
              {uninstallState === 'running' ? 'Odinstalowywanie...' : `Odinstaluj (${SOURCE_LABEL[app.source]})`}
            </button>
            {typeof uninstallState === 'object' && uninstallState.success && (
              <span className="chip low">Odinstalowano</span>
            )}
          </div>
          {failedUninstall && typeof uninstallState === 'object' && (
            <div className="form-warning" style={{ marginTop: 4 }}>
              Nie udało się: {uninstallState.error}
              {uninstallState.install_hint && (
                <div style={{ marginTop: 6 }}>
                  <MissingDependency tool={`Uprawnienia do odinstalowania „${app.name}”`} installHint={uninstallState.install_hint} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="section-head" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 14 }}>Powiązane pliki</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {leftovers && leftovers.length > 1 && (
              <div className="diskmap-viewtabs">
                <button className={`diskmap-viewtab ${sortMode === 'size' ? 'active' : ''}`} onClick={() => setSortMode('size')}>Rozmiar</button>
                <button className={`diskmap-viewtab ${sortMode === 'age' ? 'active' : ''}`} onClick={() => setSortMode('age')}>Wiek</button>
              </div>
            )}
            <button className="btn btn-ghost btn-mini" onClick={loadLeftovers} disabled={leftoversLoading}>
              {leftoversLoading ? 'Szukanie...' : 'Odśwież'}
            </button>
          </div>
        </div>

        {leftoversLoading && leftovers === null && <div className="glass empty-state">Szukanie powiązanych plików...</div>}
        {leftovers && leftovers.length === 0 && <div className="glass empty-state">Nie znaleziono powiązanych plików.</div>}
        {sortedLeftovers && sortedLeftovers.length > 0 && (
          <>
            {sortedLeftovers.length > 1 && (
              <button className="btn btn-ghost btn-mini" style={{ marginBottom: 8 }} onClick={toggleAll}>
                {sortedLeftovers.every((e) => checked.has(e.path)) ? 'Odznacz wszystko' : 'Zaznacz wszystko'}
              </button>
            )}
            <div className="clean-list" style={{ maxHeight: 240, overflowY: 'auto' }}>
              {sortedLeftovers.map((e) => {
                const recent = e.age_days !== null && e.age_days < RECENT_DAYS
                return (
                  <label key={e.path} className={`glass clean-row${checked.has(e.path) ? ' checked' : ''}`}>
                    <input type="checkbox" checked={checked.has(e.path)} onChange={() => toggle(e.path)} disabled={cleaning} />
                    <span className="cr-path">
                      {e.name}
                      <span className="mono" style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 10 }}>{e.path}</span>
                    </span>
                    <span className="chip os">{e.source}</span>
                    {recent && <span className="chip medium">{ageLabel(e.age_days)}</span>}
                    <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
                    <button
                      className="btn btn-ghost btn-mini cr-open-btn"
                      title="Otwórz folder"
                      onClick={(ev) => {
                        ev.preventDefault()
                        ev.stopPropagation()
                        openFolder(e.path)
                      }}
                    >
                      <Icon name="folder" />
                    </button>
                  </label>
                )
              })}
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary" disabled={checked.size === 0 || cleaning} onClick={runClean}>
                {cleaning ? 'Czyszczenie...' : `Wyczyść zaznaczone (${checked.size})`}
              </button>
            </div>
          </>
        )}
        {cleanResult && (
          <div className="form-warning" style={{ marginTop: 10, color: 'var(--good)', background: 'color-mix(in srgb, var(--good) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--good) 30%, transparent)' }}>
            Odzyskano {formatBytes(cleanResult.freed_bytes)} ({cleanResult.removed} pozycji).
          </div>
        )}
    </Modal>
  )
}

function AppsPanel() {
  const [apps, setApps] = useState<InstalledApp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [sourceFilter, setSourceFilter] = useState<Set<string>>(new Set(['apt', 'flatpak', 'snap']))
  const [selected, setSelected] = useState<InstalledApp | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await invoke<ApiResponse<InstalledApp[]>>('list_installed_apps')
      if (!res.ok) {
        setError(res.error)
        return
      }
      setApps(res.data)
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  function toggleSource(s: string) {
    setSourceFilter((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!apps) return []
    const q = query.trim().toLowerCase()
    return apps.filter((a) => sourceFilter.has(a.source) && (q === '' || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)))
  }, [apps, query, sourceFilter])

  if (error) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        Błąd: {error}
        <br />
        <button className="btn btn-ghost" onClick={load}>Spróbuj ponownie</button>
      </div>
    )
  }
  if (!apps) {
    return <div className="glass empty-state"><span className="scan-spinner" aria-hidden />Wczytywanie listy aplikacji...</div>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Szukaj aplikacji..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '9px 14px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)', fontSize: 13 }}
        />
        <div className="diskmap-viewtabs">
          {(['apt', 'flatpak', 'snap'] as const).map((s) => (
            <button key={s} className={`diskmap-viewtab ${sourceFilter.has(s) ? 'active' : ''}`} onClick={() => toggleSource(s)}>{s}</button>
          ))}
        </div>
        <span className="count mono">{filtered.length} / {apps.length}</span>
      </div>

      <div className="clean-list">
        {filtered.map((a) => (
          <div key={`${a.source}:${a.id}`} className="glass clean-row" style={{ cursor: 'pointer', opacity: 1 }} onClick={() => setSelected(a)}>
            <span className="cr-path">
              {a.name}
              {a.description && <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 11 }}>{a.description}</span>}
            </span>
            <span className="chip os">{SOURCE_LABEL[a.source]}</span>
            <span className="cr-files mono">{a.version}</span>
            <span className="cr-size mono">{a.size_bytes ? formatBytes(a.size_bytes) : ''}</span>
          </div>
        ))}
      </div>

      {selected && (
        <AppDetail
          app={selected}
          onClose={() => setSelected(null)}
          onUninstalled={() => {
            load()
          }}
        />
      )}
    </div>
  )
}

// ------------------------------------------------------- blind heuristic scan (secondary)

interface ScanData {
  entries: OrphanEntry[]
  total_bytes: number
}

type ScanPhase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'scanned'; scan: ScanData }
  | { kind: 'cleaning'; scan: ScanData }
  | { kind: 'done'; result: CleanData }
  | { kind: 'error'; message: string }

function BlindScanPanel() {
  const [phase, setPhase] = useState<ScanPhase>({ kind: 'idle' })
  const [checked, setChecked] = useState<Set<string>>(() => new Set())

  async function runScan() {
    setPhase({ kind: 'scanning' })
    setChecked(new Set())
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_uninstaller')
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setPhase({ kind: 'scanned', scan: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  async function runClean(scan: ScanData) {
    const paths = [...checked]
    if (paths.length === 0) return
    const total = selectedBytes(scan)
    if (!window.confirm(`Usunąć ${paths.length} pozycji (${formatBytes(total)})? Tej operacji nie można cofnąć.`)) return
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await invoke<ApiResponse<CleanData>>('clean_uninstaller', { paths })
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
    () => (s: ScanData) => s.entries.filter((e) => checked.has(e.path)).reduce((acc, e) => acc + e.size_bytes, 0),
    [checked],
  )

  return (
    <div>
      {phase.kind === 'idle' && (
        <div className="glass empty-state" style={{ textAlign: 'left' }}>
          <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Ogólne skanowanie</div>
          Zamiast wybierać konkretną aplikację, przeszukaj <span className="mono">~/.config</span> i{' '}
          <span className="mono">~/.cache</span> pod kątem folderów, które nie pasują do żadnego zainstalowanego
          programu. Heurystyczne — wtyczki i AppImage mogą trafić na listę mimo że są używane, sprawdź zanim usuniesz.
          <br />
          <br />
          <button className="btn btn-primary" onClick={runScan}>Skanuj</button>
        </div>
      )}
      {phase.kind === 'scanning' && (
        <div className="glass empty-state"><span className="scan-spinner" aria-hidden />Szukanie porzuconych folderów...</div>
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
          {scan.entries.length === 0 ? (
            <div className="glass empty-state">Nie znaleziono kandydatów.</div>
          ) : (
            <>
              <div className="clean-summary glass">
                <div>
                  <div className="cs-label">Potencjalnie do wyczyszczenia</div>
                  <div className="cs-value mono">{formatBytes(scan.total_bytes)}</div>
                </div>
                <div>
                  <div className="cs-label">Zaznaczone</div>
                  <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>Skanuj ponownie</button>
                  <button className="btn btn-primary" disabled={checked.size === 0 || phase.kind === 'cleaning'} onClick={() => runClean(scan)}>
                    {phase.kind === 'cleaning' ? 'Czyszczenie...' : 'Wyczyść zaznaczone'}
                  </button>
                </div>
              </div>
              <div className="clean-list">
                {scan.entries.map((e) => {
                  const recent = e.age_days !== null && e.age_days < RECENT_DAYS
                  return (
                    <label key={e.path} className={`glass clean-row${checked.has(e.path) ? ' checked' : ''}`}>
                      <input type="checkbox" checked={checked.has(e.path)} onChange={() => toggle(e.path)} disabled={phase.kind === 'cleaning'} />
                      <span className="cr-path">
                        {e.name}
                        <span className="mono" style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 10.5 }}>{e.path}</span>
                      </span>
                      <span className="chip os">{e.source}</span>
                      {recent && <span className="chip medium">{ageLabel(e.age_days)} — sprawdź uważnie</span>}
                      {!recent && <span className="cr-files">{ageLabel(e.age_days)}</span>}
                      <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
                    </label>
                  )
                })}
              </div>
            </>
          )}
        </>
      )}
      {phase.kind === 'done' && (
        <div className="glass empty-state">
          <div className="done-badge"><Icon name="check" /></div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Odzyskano {formatBytes(phase.result.freed_bytes)}
          </div>
          Usunięto {phase.result.removed} pozycji.
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => <div key={err}>{err}</div>)}
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

// -------------------------------------------------------------------- root

export function UninstallerView() {
  const [tab, setTab] = useState<'apps' | 'scan'>('apps')

  return (
    <div>
      <div className="diskmap-viewtabs" style={{ marginBottom: 16 }}>
        <button className={`diskmap-viewtab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>Zainstalowane aplikacje</button>
        <button className={`diskmap-viewtab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>Ogólne skanowanie</button>
      </div>
      {tab === 'apps' ? <AppsPanel /> : <BlindScanPanel />}
    </div>
  )
}
