import { useMemo, useState } from 'react'
import { currentBlacklist } from '../../state/settings'
import { invoke } from '@tauri-apps/api/core'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'

interface Group {
  hash: string
  size_bytes: number
  paths: string[]
}

interface ScanData {
  groups: Group[]
  wasted_bytes: number
}

interface CleanData {
  freed_bytes: number
  removed: number
  errors: string[]
}

interface VersionItem {
  path: string
  version: string
  size_bytes: number
  is_dir: boolean
}

interface VersionGroup {
  base_name: string
  dir: string
  items: VersionItem[]
}

interface VersionScanData {
  groups: VersionGroup[]
  total_bytes: number
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'scanned'; scan: ScanData }
  | { kind: 'cleaning'; scan: ScanData }
  | { kind: 'done'; result: CleanData }
  | { kind: 'error'; message: string }

type VerPhase =
  | { kind: 'idle' }
  | { kind: 'scanning' }
  | { kind: 'scanned'; scan: VersionScanData }
  | { kind: 'cleaning'; scan: VersionScanData }
  | { kind: 'done'; result: CleanData }
  | { kind: 'error'; message: string }

function groupKey(g: VersionGroup): string {
  return `${g.dir}::${g.base_name.toLowerCase()}`
}

/** Toggles membership of `path` in the group's keep-set, refusing to drop the last remaining one. */
function toggleKeep(prev: Map<string, Set<string>>, key: string, path: string, fallbackDefault: string): Map<string, Set<string>> {
  const next = new Map(prev)
  const current = new Set(next.get(key) ?? [fallbackDefault])
  if (current.has(path)) {
    if (current.size > 1) current.delete(path)
  } else {
    current.add(path)
  }
  next.set(key, current)
  return next
}

export function DuplicatesView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [included, setIncluded] = useState<Set<string>>(() => new Set())
  const [keepSets, setKeepSets] = useState<Map<string, Set<string>>>(() => new Map())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const [verPhase, setVerPhase] = useState<VerPhase>({ kind: 'idle' })
  const [verIncluded, setVerIncluded] = useState<Set<string>>(() => new Set())
  const [verKeepSets, setVerKeepSets] = useState<Map<string, Set<string>>>(() => new Map())
  const [verCollapsed, setVerCollapsed] = useState<Set<string>>(() => new Set())

  async function runScan() {
    setPhase({ kind: 'scanning' })
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_duplicates', { blacklist: currentBlacklist() })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setIncluded(new Set(res.data.groups.map((g) => g.hash)))
      setKeepSets(new Map(res.data.groups.map((g) => [g.hash, new Set([g.paths[0]])])))
      setCollapsed(new Set())
      setPhase({ kind: 'scanned', scan: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  function pathsToDelete(scan: ScanData): string[] {
    const out: string[] = []
    for (const g of scan.groups) {
      if (!included.has(g.hash)) continue
      const keep = keepSets.get(g.hash) ?? new Set([g.paths[0]])
      for (const p of g.paths) if (!keep.has(p)) out.push(p)
    }
    return out
  }

  async function runClean(scan: ScanData) {
    const paths = pathsToDelete(scan)
    if (paths.length === 0) return
    const bytes = paths.reduce((acc, p) => {
      const g = scan.groups.find((gr) => gr.paths.includes(p))
      return acc + (g?.size_bytes ?? 0)
    }, 0)
    if (!window.confirm(`Usunąć ${paths.length} plików (${formatBytes(bytes)}), zachowując zaznaczone kopie z każdej grupy? Tej operacji nie można cofnąć.`)) {
      return
    }
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await invoke<ApiResponse<CleanData>>('clean_duplicates', { paths })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setPhase({ kind: 'done', result: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  function toggleGroup(hash: string) {
    setIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  function toggleCollapse(hash: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(hash)) next.delete(hash)
      else next.add(hash)
      return next
    })
  }

  function toggleCollapseAll(scan: ScanData) {
    const allCollapsed = scan.groups.every((g) => collapsed.has(g.hash))
    setCollapsed(allCollapsed ? new Set() : new Set(scan.groups.map((g) => g.hash)))
  }

  async function runVerScan() {
    setVerPhase({ kind: 'scanning' })
    try {
      const res = await invoke<ApiResponse<VersionScanData>>('scan_duplicate_versions', { blacklist: currentBlacklist() })
      if (!res.ok) {
        setVerPhase({ kind: 'error', message: res.error })
        return
      }
      setVerIncluded(new Set(res.data.groups.map(groupKey)))
      setVerKeepSets(new Map(res.data.groups.map((g) => [groupKey(g), new Set([g.items[0].path])])))
      setVerCollapsed(new Set())
      setVerPhase({ kind: 'scanned', scan: res.data })
    } catch (e) {
      setVerPhase({ kind: 'error', message: String(e) })
    }
  }

  function verPathsToDelete(scan: VersionScanData): string[] {
    const out: string[] = []
    for (const g of scan.groups) {
      const key = groupKey(g)
      if (!verIncluded.has(key)) continue
      const keep = verKeepSets.get(key) ?? new Set([g.items[0].path])
      for (const item of g.items) if (!keep.has(item.path)) out.push(item.path)
    }
    return out
  }

  async function runVerClean(scan: VersionScanData) {
    const paths = verPathsToDelete(scan)
    if (paths.length === 0) return
    const bytes = paths.reduce((acc, p) => {
      const g = scan.groups.find((gr) => gr.items.some((i) => i.path === p))
      const item = g?.items.find((i) => i.path === p)
      return acc + (item?.size_bytes ?? 0)
    }, 0)
    if (!window.confirm(`Usunąć ${paths.length} starszych wersji (${formatBytes(bytes)}), zachowując zaznaczone wersje z każdej grupy? Tej operacji nie można cofnąć.`)) {
      return
    }
    setVerPhase({ kind: 'cleaning', scan })
    try {
      const res = await invoke<ApiResponse<CleanData>>('clean_duplicate_versions', { paths })
      if (!res.ok) {
        setVerPhase({ kind: 'error', message: res.error })
        return
      }
      setVerPhase({ kind: 'done', result: res.data })
    } catch (e) {
      setVerPhase({ kind: 'error', message: String(e) })
    }
  }

  function toggleVerGroup(key: string) {
    setVerIncluded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleVerCollapse(key: string) {
    setVerCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleVerCollapseAll(scan: VersionScanData) {
    const keys = scan.groups.map(groupKey)
    const allCollapsed = keys.every((k) => verCollapsed.has(k))
    setVerCollapsed(allCollapsed ? new Set() : new Set(keys))
  }

  const scan = phase.kind === 'scanned' || phase.kind === 'cleaning' ? phase.scan : null
  const selectedBytes = useMemo(
    () => (s: ScanData) =>
      pathsToDelete(s).reduce((acc, p) => {
        const g = s.groups.find((gr) => gr.paths.includes(p))
        return acc + (g?.size_bytes ?? 0)
      }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [included, keepSets],
  )

  const verScan = verPhase.kind === 'scanned' || verPhase.kind === 'cleaning' ? verPhase.scan : null
  const verSelectedBytes = useMemo(
    () => (s: VersionScanData) =>
      verPathsToDelete(s).reduce((acc, p) => {
        const g = s.groups.find((gr) => gr.items.some((i) => i.path === p))
        const item = g?.items.find((i) => i.path === p)
        return acc + (item?.size_bytes ?? 0)
      }, 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [verIncluded, verKeepSets],
  )

  return (
    <div>
      {phase.kind === 'idle' && (
        <div className="glass empty-state">
          Przeszukaj Pobrane, Dokumenty, Obrazy, Pulpit, Wideo i Muzykę w poszukiwaniu identycznych plików
          (SHA-256). Katalogi narzędzi deweloperskich (node_modules, build, .git...) są pomijane.
          <br />
          <button className="btn btn-primary" onClick={runScan}>Skanuj</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          Liczenie sum SHA-256...
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          Błąd: {phase.message}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>Spróbuj ponownie</button>
        </div>
      )}

      {scan && scan.groups.length === 0 && (
        <div className="glass empty-state">
          Brak duplikatów w przeszukanych folderach.
          <br />
          <button className="btn btn-ghost" onClick={runScan}>Skanuj ponownie</button>
        </div>
      )}

      {scan && scan.groups.length > 0 && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">Zmarnowane miejsce</div>
              <div className="cs-value mono">{formatBytes(scan.wasted_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">Do usunięcia</div>
              <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>
                Skanuj ponownie
              </button>
              <button
                className="btn btn-primary"
                disabled={pathsToDelete(scan).length === 0 || phase.kind === 'cleaning'}
                onClick={() => runClean(scan)}
              >
                {phase.kind === 'cleaning' ? 'Czyszczenie...' : 'Usuń zaznaczone duplikaty'}
              </button>
            </div>
          </div>

          <div className="section-head">
            <h2>Grupy duplikatów</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="count">{scan.groups.length} grup</span>
              <button className="btn btn-ghost btn-mini" onClick={() => toggleCollapseAll(scan)}>
                {scan.groups.every((g) => collapsed.has(g.hash)) ? 'Rozwiń wszystkie' : 'Zwiń wszystkie'}
              </button>
            </div>
          </div>

          <div className="dup-groups">
            {scan.groups.map((g) => {
              const isIncluded = included.has(g.hash)
              const keep = keepSets.get(g.hash) ?? new Set([g.paths[0]])
              const isCollapsed = collapsed.has(g.hash)
              return (
                <div key={g.hash} className={`glass dup-group${isIncluded ? '' : ' excluded'}`}>
                  <div className="dup-group-head">
                    <label className="dup-group-toggle">
                      <input type="checkbox" checked={isIncluded} onChange={() => toggleGroup(g.hash)} />
                      <span>{formatBytes(g.size_bytes)} &times; {g.paths.length} kopii</span>
                    </label>
                    <span className="dup-group-waste mono">
                      odzyskasz {formatBytes(g.size_bytes * (g.paths.length - 1))}
                    </span>
                    <button
                      className="dup-group-collapse"
                      aria-label={isCollapsed ? 'Rozwiń grupę' : 'Zwiń grupę'}
                      onClick={() => toggleCollapse(g.hash)}
                    >
                      <span className={isCollapsed ? '' : 'rot'}><Icon name="chevron" /></span>
                    </button>
                  </div>
                  {!isCollapsed && (
                    <div className="dup-paths">
                      {g.paths.map((p) => {
                        const isKept = keep.has(p)
                        return (
                          <label key={p} className={`dup-path${isKept ? ' keep' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isKept}
                              disabled={!isIncluded || (isKept && keep.size === 1)}
                              onChange={() => setKeepSets((prev) => toggleKeep(prev, g.hash, p, g.paths[0]))}
                            />
                            <span className="mono dp-path">{p}</span>
                            {isKept && <span className="chip low">zachowaj</span>}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
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

      <div className="section-head" style={{ marginTop: 32 }}>
        <h2>Stare wersje tego samego pliku/folderu</h2>
        {verScan && verScan.groups.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="count">{verScan.groups.length} grup</span>
            <button className="btn btn-ghost btn-mini" onClick={() => toggleVerCollapseAll(verScan)}>
              {verScan.groups.map(groupKey).every((k) => verCollapsed.has(k)) ? 'Rozwiń wszystkie' : 'Zwiń wszystkie'}
            </button>
          </div>
        )}
      </div>

      {verPhase.kind === 'idle' && (
        <div className="glass empty-state">
          Wykryj pliki i foldery o nazwach różniących się tylko numerem wersji (np. AppName_2.2.zip
          obok AppName_2.5.zip) — zwykle oznacza to zaległą, starą kopię.
          <br />
          <button className="btn btn-primary" onClick={runVerScan}>Skanuj</button>
        </div>
      )}

      {verPhase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          Szukanie wersjonowanych nazw...
        </div>
      )}

      {verPhase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          Błąd: {verPhase.message}
          <br />
          <button className="btn btn-ghost" onClick={runVerScan}>Spróbuj ponownie</button>
        </div>
      )}

      {verScan && verScan.groups.length === 0 && (
        <div className="glass empty-state">
          Nie znaleziono nazw różniących się tylko wersją.
          <br />
          <button className="btn btn-ghost" onClick={runVerScan}>Skanuj ponownie</button>
        </div>
      )}

      {verScan && verScan.groups.length > 0 && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">Miejsce po starych wersjach</div>
              <div className="cs-value mono">{formatBytes(verScan.total_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">Do usunięcia</div>
              <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(verSelectedBytes(verScan))}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={runVerScan} disabled={verPhase.kind === 'cleaning'}>
                Skanuj ponownie
              </button>
              <button
                className="btn btn-primary"
                disabled={verPathsToDelete(verScan).length === 0 || verPhase.kind === 'cleaning'}
                onClick={() => runVerClean(verScan)}
              >
                {verPhase.kind === 'cleaning' ? 'Czyszczenie...' : 'Usuń starsze wersje'}
              </button>
            </div>
          </div>

          <div className="dup-groups">
            {verScan.groups.map((g) => {
              const key = groupKey(g)
              const isIncluded = verIncluded.has(key)
              const keep = verKeepSets.get(key) ?? new Set([g.items[0].path])
              const isCollapsed = verCollapsed.has(key)
              return (
                <div key={key} className={`glass dup-group${isIncluded ? '' : ' excluded'}`}>
                  <div className="dup-group-head">
                    <label className="dup-group-toggle">
                      <input type="checkbox" checked={isIncluded} onChange={() => toggleVerGroup(key)} />
                      <span>{g.base_name} &times; {g.items.length} wersje</span>
                    </label>
                    <span className="dup-group-waste mono">
                      odzyskasz {formatBytes(g.items.slice(1).reduce((acc, i) => acc + i.size_bytes, 0))}
                    </span>
                    <button
                      className="dup-group-collapse"
                      aria-label={isCollapsed ? 'Rozwiń grupę' : 'Zwiń grupę'}
                      onClick={() => toggleVerCollapse(key)}
                    >
                      <span className={isCollapsed ? '' : 'rot'}><Icon name="chevron" /></span>
                    </button>
                  </div>
                  {!isCollapsed && (
                    <div className="dup-paths">
                      {g.items.map((item, i) => {
                        const isKept = keep.has(item.path)
                        return (
                          <label key={item.path} className={`dup-path${isKept ? ' keep' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isKept}
                              disabled={!isIncluded || (isKept && keep.size === 1)}
                              onChange={() => setVerKeepSets((prev) => toggleKeep(prev, key, item.path, g.items[0].path))}
                            />
                            <span className="chip os">{item.version}{i === 0 ? ' (najnowsza)' : ''}</span>
                            <span className="mono dp-path">
                              {item.path}{item.is_dir ? ' /' : ''}
                            </span>
                            <span className="cr-size mono">{formatBytes(item.size_bytes)}</span>
                            {isKept && <span className="chip low">zachowaj</span>}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {verPhase.kind === 'done' && (
        <div className="glass empty-state">
          <div className="done-badge">
            <Icon name="check" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Odzyskano {formatBytes(verPhase.result.freed_bytes)}
          </div>
          Usunięto {verPhase.result.removed} pozycji.
          {verPhase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {verPhase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {verPhase.result.errors.length > 8 && <div>... i {verPhase.result.errors.length - 8} więcej</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runVerScan}>Skanuj ponownie</button>
        </div>
      )}
    </div>
  )
}
