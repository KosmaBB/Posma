import { useMemo, useState } from 'react'
import { currentBlacklist } from '../../state/settings'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

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
      const res = await callModule<ScanData>('duplicates', { cmd: 'scan', blacklist: currentBlacklist() })
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
    if (!(await confirmAction(t('view.duplicates.confirm', { n: paths.length, size: formatBytes(bytes) })))) {
      return
    }
    setPhase({ kind: 'cleaning', scan })
    try {
      const res = await callModule<CleanData>('duplicates', { cmd: 'clean', paths })
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
      const res = await callModule<VersionScanData>('duplicates', { cmd: 'scan_versions', blacklist: currentBlacklist() })
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
    if (!(await confirmAction(t('view.duplicates.confirm-versions', { n: paths.length, size: formatBytes(bytes) })))) {
      return
    }
    setVerPhase({ kind: 'cleaning', scan })
    try {
      const res = await callModule<CleanData>('duplicates', { cmd: 'clean_versions', paths })
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
          {t('view.duplicates.intro')}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.duplicates.scan')}</button>
        </div>
      )}

      {phase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          {t('view.duplicates.hashing')}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.duplicates.error', { message: phase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.duplicates.retry')}</button>
        </div>
      )}

      {scan && scan.groups.length === 0 && (
        <div className="glass empty-state">
          {t('view.duplicates.none')}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.duplicates.rescan')}</button>
        </div>
      )}

      {scan && scan.groups.length > 0 && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">{t('view.duplicates.wasted')}</div>
              <div className="cs-value mono">{formatBytes(scan.wasted_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">{t('view.duplicates.to-delete')}</div>
              <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(selectedBytes(scan))}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={runScan} disabled={phase.kind === 'cleaning'}>
                {t('view.duplicates.rescan')}
              </button>
              <button
                className="btn btn-primary"
                disabled={pathsToDelete(scan).length === 0 || phase.kind === 'cleaning'}
                onClick={() => runClean(scan)}
              >
                {phase.kind === 'cleaning' ? t('view.duplicates.cleaning') : t('view.duplicates.delete-selected')}
              </button>
            </div>
          </div>

          <div className="section-head">
            <h2>{t('view.duplicates.groups')}</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="count">{t('view.duplicates.group-count', { n: scan.groups.length })}</span>
              <button className="btn btn-ghost btn-mini" onClick={() => toggleCollapseAll(scan)}>
                {scan.groups.every((g) => collapsed.has(g.hash)) ? t('view.duplicates.expand-all') : t('view.duplicates.collapse-all')}
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
                      <span>{t('view.duplicates.copies', { size: formatBytes(g.size_bytes), n: g.paths.length })}</span>
                    </label>
                    <span className="dup-group-waste mono">
                      {t('view.duplicates.reclaim', { size: formatBytes(g.size_bytes * (g.paths.length - 1)) })}
                    </span>
                    <button
                      className="dup-group-collapse"
                      aria-label={isCollapsed ? t('view.duplicates.expand-group') : t('view.duplicates.collapse-group')}
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
                            {isKept && <span className="chip low">{t('view.duplicates.keep')}</span>}
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.duplicates.recovered', { size: formatBytes(phase.result.freed_bytes) })}
          </div>
          {t('view.duplicates.removed-files', { n: phase.result.removed })}
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>{t('view.duplicates.more-errors', { n: phase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.duplicates.rescan')}</button>
        </div>
      )}

      <div className="section-head" style={{ marginTop: 32 }}>
        <h2>{t('view.duplicates.versions.heading')}</h2>
        {verScan && verScan.groups.length > 0 && (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span className="count">{t('view.duplicates.group-count', { n: verScan.groups.length })}</span>
            <button className="btn btn-ghost btn-mini" onClick={() => toggleVerCollapseAll(verScan)}>
              {verScan.groups.map(groupKey).every((k) => verCollapsed.has(k)) ? t('view.duplicates.expand-all') : t('view.duplicates.collapse-all')}
            </button>
          </div>
        )}
      </div>

      {verPhase.kind === 'idle' && (
        <div className="glass empty-state">
          {t('view.duplicates.versions.intro')}
          <br />
          <button className="btn btn-primary" onClick={runVerScan}>{t('view.duplicates.scan')}</button>
        </div>
      )}

      {verPhase.kind === 'scanning' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          {t('view.duplicates.versions.scanning')}
        </div>
      )}

      {verPhase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.duplicates.error', { message: verPhase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runVerScan}>{t('view.duplicates.retry')}</button>
        </div>
      )}

      {verScan && verScan.groups.length === 0 && (
        <div className="glass empty-state">
          {t('view.duplicates.versions.none')}
          <br />
          <button className="btn btn-ghost" onClick={runVerScan}>{t('view.duplicates.rescan')}</button>
        </div>
      )}

      {verScan && verScan.groups.length > 0 && (
        <>
          <div className="clean-summary glass">
            <div>
              <div className="cs-label">{t('view.duplicates.versions.space')}</div>
              <div className="cs-value mono">{formatBytes(verScan.total_bytes)}</div>
            </div>
            <div>
              <div className="cs-label">{t('view.duplicates.to-delete')}</div>
              <div className="cs-value mono" style={{ color: 'var(--accent)' }}>{formatBytes(verSelectedBytes(verScan))}</div>
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
              <button className="btn btn-ghost" onClick={runVerScan} disabled={verPhase.kind === 'cleaning'}>
                {t('view.duplicates.rescan')}
              </button>
              <button
                className="btn btn-primary"
                disabled={verPathsToDelete(verScan).length === 0 || verPhase.kind === 'cleaning'}
                onClick={() => runVerClean(verScan)}
              >
                {verPhase.kind === 'cleaning' ? t('view.duplicates.cleaning') : t('view.duplicates.versions.delete-older')}
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
                      <span>{t('view.duplicates.versions.count', { name: g.base_name, n: g.items.length })}</span>
                    </label>
                    <span className="dup-group-waste mono">
                      {t('view.duplicates.reclaim', { size: formatBytes(g.items.slice(1).reduce((acc, i) => acc + i.size_bytes, 0)) })}
                    </span>
                    <button
                      className="dup-group-collapse"
                      aria-label={isCollapsed ? t('view.duplicates.expand-group') : t('view.duplicates.collapse-group')}
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
                            <span className="chip os">{item.version}{i === 0 ? t('view.duplicates.versions.newest') : ''}</span>
                            <span className="mono dp-path">
                              {item.path}{item.is_dir ? ' /' : ''}
                            </span>
                            <span className="cr-size mono">{formatBytes(item.size_bytes)}</span>
                            {isKept && <span className="chip low">{t('view.duplicates.keep')}</span>}
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
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.duplicates.recovered', { size: formatBytes(verPhase.result.freed_bytes) })}
          </div>
          {t('view.duplicates.removed-items', { n: verPhase.result.removed })}
          {verPhase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {verPhase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {verPhase.result.errors.length > 8 && <div>{t('view.duplicates.more-errors', { n: verPhase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={runVerScan}>{t('view.duplicates.rescan')}</button>
        </div>
      )}
    </div>
  )
}
