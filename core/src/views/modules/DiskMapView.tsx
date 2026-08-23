import { useEffect, useMemo, useRef, useState } from 'react'
import { currentBlacklist } from '../../state/settings'
import { Preparing } from '../../components/Preparing'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'
import { squarify, type TreemapRect } from './diskmapTreemap'

interface Entry {
  name: string
  path: string | null
  is_dir: boolean
  size_bytes: number
}

interface ScanData {
  path: string
  parent: string | null
  entries: Entry[]
  total_bytes: number
  errors: string[]
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }
type ViewMode = 'bars' | 'treemap' | 'rings'

const VIEW_MODE_KEY = 'posma.diskmap.viewMode'
const TREEMAP_HEIGHT = 360

function splitPath(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

function loadViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY)
  return stored === 'treemap' || stored === 'rings' || stored === 'bars' ? stored : 'bars'
}

export function DiskMapView() {
  const [data, setData] = useState<ScanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  const [treemapWidth, setTreemapWidth] = useState(0)
  const treemapRef = useRef<HTMLDivElement | null>(null)

  async function goTo(path?: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await invoke<ApiResponse<ScanData>>('scan_disk_map', { path: path ?? null, blacklist: currentBlacklist() })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setData(res.data)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    goTo()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    const el = treemapRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setTreemapWidth(width)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [viewMode])

  async function pickFolder() {
    const result = await open({ multiple: false, directory: true, title: 'Wybierz folder do przejrzenia' })
    if (typeof result === 'string') await goTo(result)
  }

  const segments = data ? splitPath(data.path) : []
  const maxSize = data && data.entries.length > 0 ? data.entries[0].size_bytes : 1
  const total = data?.total_bytes ?? 1

  const treemapRects = useMemo(() => {
    if (!data || treemapWidth === 0) return [] as TreemapRect<Entry & { key: string; size: number }>[]
    const items = data.entries.filter((e) => e.size_bytes > 0).map((e) => ({ ...e, key: e.path ?? e.name, size: e.size_bytes }))
    const out: TreemapRect<typeof items[number]>[] = []
    squarify(items, 0, 0, treemapWidth, TREEMAP_HEIGHT, out)
    return out
  }, [data, treemapWidth])

  function entryTitle(entry: Entry): string | undefined {
    return entry.path ? `${entry.path} — ${entry.size_bytes.toLocaleString('pl-PL')} B` : undefined
  }

  function isDrillable(entry: Entry): boolean {
    return entry.is_dir && entry.path !== null
  }

  return (
    <div>
      <div className="glass empty-state" style={{ textAlign: 'left' }}>
        <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Co zajmuje miejsce</div>
        Przegląd folderu warstwa po warstwie — największe pozycje na górze. Kliknij folder żeby zejść głębiej,
        albo wybierz inny punkt startowy poniżej. Widok jest wyłącznie do podglądu — nic tu nie usuwa plików.
      </div>

      <div className="section-head">
        <h2>Eksplorator</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-mini" onClick={() => goTo()} disabled={loading}>Dom</button>
          <button className="btn btn-ghost btn-mini" onClick={pickFolder} disabled={loading}>Wybierz folder...</button>
          <button className="btn btn-ghost btn-mini" onClick={() => data && goTo(data.path)} disabled={loading || !data}>Odśwież</button>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {data ? (
          <div className="diskmap-crumbs mono">
            <button className="diskmap-crumb" onClick={() => goTo('/')}>/</button>
            {segments.map((seg, i) => {
              const full = '/' + segments.slice(0, i + 1).join('/')
              const isLast = i === segments.length - 1
              return (
                <span key={full} style={{ display: 'contents' }}>
                  <span className="diskmap-crumb-sep">/</span>
                  <button className="diskmap-crumb" disabled={isLast} onClick={() => goTo(full)}>{seg}</button>
                </span>
              )
            })}
          </div>
        ) : <span />}

        <div className="diskmap-viewtabs">
          <button className={`diskmap-viewtab ${viewMode === 'bars' ? 'active' : ''}`} onClick={() => setViewMode('bars')}>Paski</button>
          <button className={`diskmap-viewtab ${viewMode === 'treemap' ? 'active' : ''}`} onClick={() => setViewMode('treemap')}>Kafelki</button>
          <button className={`diskmap-viewtab ${viewMode === 'rings' ? 'active' : ''}`} onClick={() => setViewMode('rings')}>Pierścienie</button>
        </div>
      </div>

      {error && (
        <div className="glass empty-state" style={{ color: 'var(--critical)', marginTop: 12 }}>Błąd: {error}</div>
      )}

      {loading && !data && <Preparing title="Przygotowuję mapę dysku" note="Przechodzę przez każdy folder i sumuję rozmiary — inaczej nie da się pokazać, co naprawdę zajmuje miejsce." />}

      {data && (
        <>
          {data.entries.length === 0 ? (
            <div className="glass empty-state">Folder jest pusty.</div>
          ) : viewMode === 'bars' ? (
            <div className="diskmap-list" style={{ opacity: loading ? 0.6 : 1 }}>
              {data.entries.map((entry) => {
                const pct = maxSize > 0 ? Math.max((entry.size_bytes / maxSize) * 100, entry.size_bytes > 0 ? 1.5 : 0) : 0
                const drillable = isDrillable(entry)
                return (
                  <div
                    key={entry.path ?? entry.name}
                    className="diskmap-row"
                    onClick={() => drillable && goTo(entry.path!)}
                    style={{ cursor: drillable ? 'pointer' : 'default' }}
                    title={entryTitle(entry)}
                  >
                    <span className="diskmap-icon"><Icon name={entry.is_dir ? 'folder' : 'file'} /></span>
                    <span className="diskmap-name">{entry.name}</span>
                    <span className="diskmap-bar-track">
                      <span className="diskmap-bar-fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="diskmap-size">{formatBytes(entry.size_bytes)}</span>
                    {drillable && <span className="diskmap-chevron"><Icon name="chevron" /></span>}
                  </div>
                )
              })}
            </div>
          ) : viewMode === 'treemap' ? (
            <div className="diskmap-treemap" ref={treemapRef} style={{ height: TREEMAP_HEIGHT, opacity: loading ? 0.6 : 1 }}>
              {treemapRects.map((r) => {
                const area = r.w * r.h
                const sizeClass = area < 1800 ? 'tiny' : area < 5500 ? 'small' : ''
                const drillable = isDrillable(r.item)
                const t = r.item.size_bytes / maxSize
                const lightness = 45 + t * 18
                const pct = ((r.item.size_bytes / total) * 100).toFixed(1)
                return (
                  <div
                    key={r.item.path ?? r.item.name}
                    className={`diskmap-tile ${sizeClass}`}
                    style={{
                      left: r.x, top: r.y, width: r.w, height: r.h,
                      background: `linear-gradient(135deg, hsl(228 92% ${lightness}%), hsl(190 90% ${lightness + 8}%))`,
                      cursor: drillable ? 'pointer' : 'default',
                    }}
                    onClick={() => drillable && goTo(r.item.path!)}
                    title={entryTitle(r.item)}
                  >
                    <div className="dt-name">{r.item.name}</div>
                    <div>
                      <div className="dt-size">{formatBytes(r.item.size_bytes)}</div>
                      <div className="dt-pct">{pct}%</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="diskmap-rings" style={{ opacity: loading ? 0.6 : 1 }}>
              {data.entries.map((entry, i) => {
                const drillable = isDrillable(entry)
                const R = 34
                const C = 2 * Math.PI * R
                const frac = maxSize > 0 ? entry.size_bytes / maxSize : 0
                const offset = C * (1 - frac)
                const hue = 228 - i * 3
                const pct = ((entry.size_bytes / total) * 100).toFixed(1)
                return (
                  <div
                    key={entry.path ?? entry.name}
                    className="diskmap-ring-card"
                    onClick={() => drillable && goTo(entry.path!)}
                    style={{ cursor: drillable ? 'pointer' : 'default' }}
                    title={entryTitle(entry)}
                  >
                    <span className="dr-rank mono">#{i + 1}</span>
                    <div className="dr-ring">
                      <svg viewBox="0 0 84 84">
                        <circle className="dr-track" cx="42" cy="42" r={R} />
                        <circle
                          className="dr-fill"
                          cx="42" cy="42" r={R}
                          stroke={`hsl(${hue} 90% 60%)`}
                          strokeDasharray={C}
                          strokeDashoffset={offset}
                        />
                      </svg>
                      <span className="dr-icon"><Icon name={entry.is_dir ? 'folder' : 'file'} /></span>
                    </div>
                    <div className="dr-name">{entry.name}</div>
                    <div className="dr-size mono">{formatBytes(entry.size_bytes)}</div>
                    <div className="dr-pct mono">{pct}% całości</div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="diskmap-total">Razem: {formatBytes(data.total_bytes)}</div>
          {data.errors.length > 0 && (
            <div className="clean-errors mono">
              {data.errors.slice(0, 6).map((e) => <div key={e}>{e}</div>)}
              {data.errors.length > 6 && <div>... i {data.errors.length - 6} więcej</div>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
