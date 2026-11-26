import { useEffect, useMemo, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { Icon } from '../../components/Icons'
import { MissingDependency } from '../../components/MissingDependency'
import { Modal } from '../../components/Modal'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

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
  if (days === null) return t('view.uninstaller.age.unknown')
  if (days === 0) return t('view.uninstaller.age.today')
  if (days === 1) return t('view.uninstaller.age.yesterday')
  return t('view.uninstaller.age.days', { n: days })
}

// ---------------------------------------------------------------- app list

interface InstalledApp {
  id: string
  name: string
  version: string
  /** apt | pacman | dnf | zypper (menedżer systemu), flatpak albo snap */
  source: string
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
      const res = await callModule<OrphanEntry[]>('uninstaller', { cmd: 'app_leftovers', app: appRef, name: app.name })
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
    if (!(await confirmAction(t('view.uninstaller.uninstall.confirm', { name: app.name })))) return
    setUninstallState('running')
    try {
      let res: ApiResponse<UninstallResult>
      if (app.source !== 'flatpak') {
        // menedżer systemu i snap zawsze wymagają roota — idzie od razu przez brokera
        // (Access_plan.md §6 krok 3) zamiast czekać na nieuprzywilejowaną
        // próbę i pokazywać podpowiedź "uruchom ręcznie sudo ...".
        await invoke('request_permission', { capability: 'pkg' })
        const raw = await invoke<ApiResponse<{ success: boolean; output: string; error: string | null }>>(
          'uninstall_pkg_privileged',
          { source: app.source, id: app.id },
        )
        res = raw.ok ? { ok: true, data: { ...raw.data, install_hint: null } } : raw
      } else {
        res = await callModule<UninstallResult>('uninstaller', { cmd: 'uninstall', app: appRef })
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
      const res = await callModule<CleanData>('uninstaller', { cmd: 'clean', paths })
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
            <div className="mono" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>
              {app.source} · {app.id} · {app.version}
              {app.size_bytes ? ` · ${formatBytes(app.size_bytes)}` : ''}
            </div>
          </div>
          <button className="btn btn-ghost btn-mini" onClick={onClose}>{t('view.uninstaller.close')}</button>
        </div>
        {app.description && <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>{app.description}</div>}

        <div className="form-field" style={{ marginTop: 10 }}>
          <span>{t('view.uninstaller.uninstall.label')}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button
              className="btn btn-primary btn-danger"
              onClick={runUninstall}
              disabled={uninstallState === 'running'}
            >
              {uninstallState === 'running' ? t('view.uninstaller.uninstall.running') : t('view.uninstaller.uninstall.button', { source: app.source })}
            </button>
            {typeof uninstallState === 'object' && uninstallState.success && (
              <span className="chip low">{t('view.uninstaller.uninstall.done')}</span>
            )}
          </div>
          {failedUninstall && typeof uninstallState === 'object' && (
            <div className="form-warning" style={{ marginTop: 4 }}>
              {t('view.uninstaller.uninstall.failed', { error: uninstallState.error ?? '' })}
              {uninstallState.install_hint && (
                <div style={{ marginTop: 6 }}>
                  <MissingDependency tool={t('view.uninstaller.uninstall.permission', { name: app.name })} installHint={uninstallState.install_hint} />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="section-head" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 14 }}>{t('view.uninstaller.leftovers.title')}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {leftovers && leftovers.length > 1 && (
              <div className="diskmap-viewtabs">
                <button className={`diskmap-viewtab ${sortMode === 'size' ? 'active' : ''}`} onClick={() => setSortMode('size')}>{t('view.uninstaller.leftovers.sort.size')}</button>
                <button className={`diskmap-viewtab ${sortMode === 'age' ? 'active' : ''}`} onClick={() => setSortMode('age')}>{t('view.uninstaller.leftovers.sort.age')}</button>
              </div>
            )}
            <button className="btn btn-ghost btn-mini" onClick={loadLeftovers} disabled={leftoversLoading}>
              {leftoversLoading ? t('view.uninstaller.leftovers.searching') : t('view.uninstaller.leftovers.refresh')}
            </button>
          </div>
        </div>

        {leftoversLoading && leftovers === null && <div className="glass empty-state">{t('view.uninstaller.leftovers.searching-all')}</div>}
        {leftovers && leftovers.length === 0 && <div className="glass empty-state">{t('view.uninstaller.leftovers.none')}</div>}
        {sortedLeftovers && sortedLeftovers.length > 0 && (
          <>
            {sortedLeftovers.length > 1 && (
              <button className="btn btn-ghost btn-mini" style={{ marginBottom: 8 }} onClick={toggleAll}>
                {sortedLeftovers.every((e) => checked.has(e.path)) ? t('view.uninstaller.leftovers.deselect-all') : t('view.uninstaller.leftovers.select-all')}
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
                      <span className="mono" style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 13 }}>{e.path}</span>
                    </span>
                    <span className="chip os">{e.source}</span>
                    {recent && <span className="chip medium">{ageLabel(e.age_days)}</span>}
                    <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
                    <button
                      className="btn btn-ghost btn-mini cr-open-btn"
                      title={t('view.uninstaller.leftovers.open-folder')}
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
                {cleaning ? t('view.uninstaller.clean.running') : t('view.uninstaller.clean.selected-count', { n: checked.size })}
              </button>
            </div>
          </>
        )}
        {cleanResult && (
          <div className="form-warning" style={{ marginTop: 10, color: 'var(--good)', background: 'color-mix(in srgb, var(--good) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--good) 30%, transparent)' }}>
            {t('view.uninstaller.leftovers.freed', { size: formatBytes(cleanResult.freed_bytes), n: cleanResult.removed })}
          </div>
        )}
    </Modal>
  )
}

function AppsPanel() {
  const [apps, setApps] = useState<InstalledApp[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  // Ukryte, nie pokazane: źródło, którego nikt nie wyłączył, jest widoczne — także takie, o którym ten widok nie wiedział.
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<InstalledApp | null>(null)

  async function load() {
    setError(null)
    try {
      const res = await callModule<InstalledApp[]>('uninstaller', { cmd: 'list_apps' })
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
    setHiddenSources((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const filtered = useMemo(() => {
    if (!apps) return []
    const q = query.trim().toLowerCase()
    return apps.filter((a) => !hiddenSources.has(a.source) && (q === '' || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q)))
  }, [apps, query, hiddenSources])

  if (error) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        {t('view.uninstaller.error', { error })}
        <br />
        <button className="btn btn-ghost" onClick={load}>{t('view.uninstaller.retry')}</button>
      </div>
    )
  }
  if (!apps) {
    return <Preparing title={t('view.uninstaller.apps.loading.title')} note={t('view.uninstaller.apps.loading.note')} />
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder={t('view.uninstaller.apps.search')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1, minWidth: 200, padding: '9px 14px', background: 'var(--bg)', border: '1px solid var(--border-strong)', color: 'var(--ink)', fontSize: 13 }}
        />
        <div className="diskmap-viewtabs">
          {[...new Set(apps.map((a) => a.source))].sort().map((s) => (
            <button key={s} className={`diskmap-viewtab ${hiddenSources.has(s) ? '' : 'active'}`} onClick={() => toggleSource(s)}>{s}</button>
          ))}
        </div>
        <span className="count mono">{filtered.length} / {apps.length}</span>
      </div>

      <div className="clean-list">
        {filtered.map((a) => (
          <div key={`${a.source}:${a.id}`} className="glass clean-row" style={{ cursor: 'pointer', opacity: 1 }} onClick={() => setSelected(a)}>
            <span className="cr-path">
              {a.name}
              {a.description && <span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 13 }}>{a.description}</span>}
            </span>
            <span className="chip os">{a.source}</span>
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
      const res = await callModule<ScanData>('uninstaller', { cmd: 'scan' })
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
    if (!(await confirmAction(t('view.uninstaller.scan.confirm', { n: paths.length, size: formatBytes(total) })))) return
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await callModule<CleanData>('uninstaller', { cmd: 'clean', paths })
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
        <div className="glass empty-state intro">
          <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>{t('view.uninstaller.scan.title')}</div>
          {t('view.uninstaller.scan.intro.before')} <span className="mono">~/.config</span> {t('view.uninstaller.scan.intro.and')}{' '}
          <span className="mono">~/.cache</span> {t('view.uninstaller.scan.intro.after')}
          <br />
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.uninstaller.scan.start')}</button>
        </div>
      )}
      {phase.kind === 'scanning' && (
        <Preparing title={t('view.uninstaller.scan.loading.title')} note={t('view.uninstaller.scan.loading.note')} />
      )}
      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.uninstaller.error', { error: phase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.uninstaller.retry')}</button>
        </div>
      )}
      {scan && (
        <>
          {scan.entries.length === 0 ? (
            <div className="glass empty-state">{t('view.uninstaller.scan.none')}</div>
          ) : (
            <>
              <div className="clean-summary glass">
                <div>
                  <div className="cs-label">{t('view.uninstaller.scan.potential')}</div>
                  <div className="cs-value mono">{formatBytes(scan.total_bytes)}</div>
                </div>
                <div>
                  <div className="cs-label">{t('view.uninstaller.scan.selected')}</div>
                  <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>{t('view.uninstaller.scan.again')}</button>
                  <button className="btn btn-primary" disabled={checked.size === 0 || phase.kind === 'cleaning'} onClick={() => runClean(scan)}>
                    {phase.kind === 'cleaning' ? t('view.uninstaller.clean.running') : t('view.uninstaller.clean.selected')}
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
                        <span className="mono" style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 13 }}>{e.path}</span>
                      </span>
                      <span className="chip os">{e.source}</span>
                      {recent && <span className="chip medium">{t('view.uninstaller.scan.check-carefully', { age: ageLabel(e.age_days) })}</span>}
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.uninstaller.scan.freed', { size: formatBytes(phase.result.freed_bytes) })}
          </div>
          {t('view.uninstaller.scan.removed', { n: phase.result.removed })}
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => <div key={err}>{err}</div>)}
              {phase.result.errors.length > 8 && <div>{t('view.uninstaller.scan.more-errors', { n: phase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.uninstaller.scan.again')}</button>
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
        <button className={`diskmap-viewtab ${tab === 'apps' ? 'active' : ''}`} onClick={() => setTab('apps')}>{t('view.uninstaller.tab.apps')}</button>
        <button className={`diskmap-viewtab ${tab === 'scan' ? 'active' : ''}`} onClick={() => setTab('scan')}>{t('view.uninstaller.scan.title')}</button>
      </div>
      {tab === 'apps' ? <AppsPanel /> : <BlindScanPanel />}
    </div>
  )
}
