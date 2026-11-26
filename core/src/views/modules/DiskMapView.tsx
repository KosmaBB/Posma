import { useEffect, useMemo, useRef, useState } from 'react'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import type { AppState } from '../../state/appState'
import { currentBlacklist } from '../../state/settings'
import { Preparing } from '../../components/Preparing'
import { open } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'
import { squarify, type TreemapRect } from './diskmapTreemap'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { t, locale } from '../../i18n'

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

type ViewMode = 'bars' | 'treemap' | 'rings'

const VIEW_MODE_KEY = 'posma.diskmap.viewMode'
const TREEMAP_HEIGHT = 360

function splitPath(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

/**
 * Past this many tiles, or below this share of the whole, a tile is a
 * sliver too small to label; those join one "Pozostałe" tile, and the bar
 * view still lists every entry.
 */
const MAX_TILES = 16
const MIN_TILE_SHARE = 0.01

/** The menu's min-width in global.css, to keep it inside the view. */
const MENU_WIDTH = 220

type Tile = Entry & { key: string; size: number }

function treemapTiles(entries: Entry[]): Tile[] {
  const sized = entries.filter((e) => e.size_bytes > 0)
  const floor = sized.reduce((sum, e) => sum + e.size_bytes, 0) * MIN_TILE_SHARE
  const shown = sized.filter((e, i) => e.path !== null && i < MAX_TILES - 1 && e.size_bytes >= floor)
  const rest = sized.filter((e) => !shown.includes(e))
  const restBytes = rest.reduce((sum, e) => sum + e.size_bytes, 0)
  const merged: Entry[] = rest.length > 1 ? [{ name: t('view.disk-map.rest-tile'), path: null, is_dir: false, size_bytes: restBytes }] : rest
  return [...shown, ...merged].map((e) => ({ ...e, key: e.path ?? e.name, size: e.size_bytes })).sort((a, b) => b.size - a.size)
}

function loadViewMode(): ViewMode {
  const stored = localStorage.getItem(VIEW_MODE_KEY)
  return stored === 'treemap' || stored === 'rings' || stored === 'bars' ? stored : 'bars'
}

export function DiskMapView({ app }: { app: AppState }) {
  const [data, setData] = useState<ScanData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<ViewMode>(loadViewMode)
  const [treemapWidth, setTreemapWidth] = useState(0)
  // State, not a ref: the field appears only once the first scan is in,
  // and measuring has to start then, not when the view mounts.
  const [treemapEl, setTreemapEl] = useState<HTMLDivElement | null>(null)

  async function goTo(path?: string) {
    setLoading(true)
    setError(null)
    try {
      const res = await callModule<ScanData>('disk-map', { cmd: 'scan', path: path ?? null, blacklist: currentBlacklist() })
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

  // A module can hand us a starting volume — the health monitor does, when
  // a disk in its list is clicked.
  const requested = app.view.kind === 'module' ? app.view.param : undefined

  /** Position and target of the right-click menu; null when closed. */
  const [menu, setMenu] = useState<{ x: number; y: number; path: string; name: string } | null>(null)
  const [actionResult, setActionResult] = useState<string | null>(null)

  const rootRef = useRef<HTMLDivElement | null>(null)

  // Any click elsewhere, a scroll or Escape dismisses it — a menu pinned to
  // a position is wrong the moment the list moves under it.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  /**
   * Opens the menu just under the item's first line, in this view's own
   * pixels. Anchored to the item, not the pointer: under the interface's CSS
   * zoom, engines disagree about pointer coordinates (see CpuProfile).
   */
  function openMenu(e: React.MouseEvent<HTMLElement>, entry: Entry) {
    const root = rootRef.current
    if (!entry.path || !root) return
    e.preventDefault()
    // The window's own click listener closes the menu; this click must not reach it.
    e.stopPropagation()
    const box = root.getBoundingClientRect()
    const k = box.width / root.offsetWidth || 1
    const item = e.currentTarget.getBoundingClientRect()
    const x = Math.max(0, Math.min((item.left - box.left) / k + 12, root.offsetWidth - MENU_WIDTH))
    const y = (item.top - box.top) / k + Math.min(item.height / k, 36)
    setMenu({ x, y, path: entry.path, name: entry.name })
  }

  async function revealInFileManager(path: string) {
    setActionResult(null)
    try {
      await revealItemInDir(path)
    } catch (e) {
      setActionResult(String(e))
    }
  }

  async function deleteEntry(path: string, name: string) {
    if (
      !(await confirmAction(
        t('view.disk-map.delete.confirm', { name, path }),
      ))
    ) {
      return
    }
    setActionResult(null)
    try {
      const res = await callModule<{ success: boolean; message: string; freed_bytes: number }>('disk-map', {
        cmd: 'delete',
        path,
        blacklist: currentBlacklist(),
      })
      if (res.ok) {
        setActionResult(
          res.data.success
            ? t('view.disk-map.delete.freed', { message: res.data.message, size: formatBytes(res.data.freed_bytes) })
            : res.data.message,
        )
        if (res.data.success && data) goTo(data.path)
      } else {
        setActionResult(res.error)
      }
    } catch (e) {
      setActionResult(String(e))
    }
  }

  useEffect(() => {
    goTo(requested)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requested])

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    if (!treemapEl) return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setTreemapWidth(width)
    })
    observer.observe(treemapEl)
    return () => observer.disconnect()
  }, [treemapEl])

  async function pickFolder() {
    const result = await open({ multiple: false, directory: true, title: t('view.disk-map.pick-title') })
    if (typeof result === 'string') await goTo(result)
  }

  const segments = data ? splitPath(data.path) : []
  const maxSize = data && data.entries.length > 0 ? data.entries[0].size_bytes : 1
  const total = data?.total_bytes ?? 1

  const treemapRects = useMemo(() => {
    const out: TreemapRect<Tile>[] = []
    if (data && treemapWidth > 0) squarify(treemapTiles(data.entries), 0, 0, treemapWidth, TREEMAP_HEIGHT, out)
    return out
  }, [data, treemapWidth])

  function entryTitle(entry: Entry): string | undefined {
    return entry.path ? `${entry.path} — ${entry.size_bytes.toLocaleString(locale())} B` : undefined
  }

  /** A folder is gone into; a file has nowhere to go, so it gets its menu. */
  function activate(e: React.MouseEvent<HTMLElement>, entry: Entry) {
    if (isDrillable(entry)) goTo(entry.path!)
    else openMenu(e, entry)
  }

  function moreButton(entry: Entry) {
    if (!entry.path) return null
    return (
      <button type="button" className="diskmap-more" aria-label={t('view.disk-map.actions-label', { name: entry.name })} title={t('view.disk-map.actions')} onClick={(e) => openMenu(e, entry)}>
        <Icon name="more" />
      </button>
    )
  }

  function isDrillable(entry: Entry): boolean {
    return entry.is_dir && entry.path !== null
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div className="glass empty-state intro">
        <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>{t('view.disk-map.intro.title')}</div>
        {t('view.disk-map.intro.body')}
      </div>

      <div className="section-head">
        <h2>{t('view.disk-map.explorer')}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-mini" onClick={() => goTo()} disabled={loading}>{t('view.disk-map.home')}</button>
          <button className="btn btn-ghost btn-mini" onClick={pickFolder} disabled={loading}>{t('view.disk-map.pick')}</button>
          <button className="btn btn-ghost btn-mini" onClick={() => data && goTo(data.path)} disabled={loading || !data}>{t('view.disk-map.refresh')}</button>
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
          <button className={`diskmap-viewtab ${viewMode === 'bars' ? 'active' : ''}`} onClick={() => setViewMode('bars')}>{t('view.disk-map.mode.bars')}</button>
          <button className={`diskmap-viewtab ${viewMode === 'treemap' ? 'active' : ''}`} onClick={() => setViewMode('treemap')}>{t('view.disk-map.mode.treemap')}</button>
          <button className={`diskmap-viewtab ${viewMode === 'rings' ? 'active' : ''}`} onClick={() => setViewMode('rings')}>{t('view.disk-map.mode.rings')}</button>
        </div>
      </div>

      {error && (
        <div className="glass empty-state" style={{ color: 'var(--critical)', marginTop: 12 }}>{t('view.disk-map.error', { error })}</div>
      )}

      {loading && !data && <Preparing title={t('view.disk-map.loading.title')} note={t('view.disk-map.loading.note')} />}

      {data && (
        <>
          {data.entries.length === 0 ? (
            <div className="glass empty-state">{t('view.disk-map.empty')}</div>
          ) : viewMode === 'bars' ? (
            <div className="diskmap-list" style={{ opacity: loading ? 0.6 : 1 }}>
              {data.entries.map((entry) => {
                const pct = maxSize > 0 ? Math.max((entry.size_bytes / maxSize) * 100, entry.size_bytes > 0 ? 1.5 : 0) : 0
                const drillable = isDrillable(entry)
                return (
                  <div
                    key={entry.path ?? entry.name}
                    className="diskmap-row"
                    onClick={(e) => activate(e, entry)}
                    onContextMenu={(e) => openMenu(e, entry)}
                    style={{ cursor: entry.path ? 'pointer' : 'default' }}
                    title={entryTitle(entry)}
                  >
                    <span className="diskmap-icon"><Icon name={entry.is_dir ? 'folder' : 'file'} /></span>
                    <span className="diskmap-name">{entry.name}</span>
                    <span className="diskmap-bar-track">
                      <span className="diskmap-bar-fill" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="diskmap-size">{formatBytes(entry.size_bytes)}</span>
                    {drillable && <span className="diskmap-chevron"><Icon name="chevron" /></span>}
                    {moreButton(entry)}
                  </div>
                )
              })}
            </div>
          ) : viewMode === 'treemap' ? (
            <div className="diskmap-treemap" ref={setTreemapEl} style={{ height: TREEMAP_HEIGHT, opacity: loading ? 0.6 : 1 }}>
              {treemapRects.map((r) => {
                const area = r.w * r.h
                const sizeClass = area < 1800 ? 'tiny' : area < 5500 ? 'small' : ''
                const tone = r.item.size_bytes / maxSize
                const pct = ((r.item.size_bytes / total) * 100).toFixed(1)
                return (
                  <div
                    key={r.item.path ?? r.item.name}
                    className={`diskmap-tile ${sizeClass}`}
                    style={{
                      left: r.x, top: r.y, width: r.w, height: r.h,
                      // One grey scale, lighter as it grows: colour would suggest a category there is none of.
                      background: `color-mix(in srgb, var(--ink) ${Math.round(6 + tone * 22)}%, var(--bg))`,
                      cursor: r.item.path ? 'pointer' : 'default',
                    }}
                    onClick={(e) => activate(e, r.item)}
                    onContextMenu={(e) => openMenu(e, r.item)}
                    title={entryTitle(r.item)}
                  >
                    {moreButton(r.item)}
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
                const R = 34
                const C = 2 * Math.PI * R
                const frac = maxSize > 0 ? entry.size_bytes / maxSize : 0
                const offset = C * (1 - frac)
                const pct = ((entry.size_bytes / total) * 100).toFixed(1)
                return (
                  <div
                    key={entry.path ?? entry.name}
                    className="diskmap-ring-card"
                    onClick={(e) => activate(e, entry)}
                    onContextMenu={(e) => openMenu(e, entry)}
                    style={{ cursor: entry.path ? 'pointer' : 'default' }}
                    title={entryTitle(entry)}
                  >
                    <span className="dr-rank mono">#{i + 1}</span>
                    {moreButton(entry)}
                    <div className="dr-ring">
                      <svg viewBox="0 0 84 84">
                        <circle className="dr-track" cx="42" cy="42" r={R} />
                        <circle
                          className="dr-fill"
                          cx="42" cy="42" r={R}
                          strokeDasharray={C}
                          strokeDashoffset={offset}
                        />
                      </svg>
                      <span className="dr-icon"><Icon name={entry.is_dir ? 'folder' : 'file'} /></span>
                    </div>
                    <div className="dr-name">{entry.name}</div>
                    <div className="dr-size mono">{formatBytes(entry.size_bytes)}</div>
                    <div className="dr-pct mono">{t('view.disk-map.pct-of-total', { pct })}</div>
                  </div>
                )
              })}
            </div>
          )}
          <div className="diskmap-total">{t('view.disk-map.total', { size: formatBytes(data.total_bytes) })}</div>
          {data.errors.length > 0 && (
            <div className="clean-errors mono">
              {data.errors.slice(0, 6).map((e) => <div key={e}>{e}</div>)}
              {data.errors.length > 6 && <div>{t('view.disk-map.more-errors', { n: data.errors.length - 6 })}</div>}
            </div>
          )}
        </>
      )}
    {actionResult && <div className="glass diskmap-result">{actionResult}</div>}

      {menu && (
        <div
          className="ctx-menu"
          style={{ position: 'absolute', left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="ctx-menu__path mono">{menu.name}</div>
          <button
            className="ctx-menu__item"
            onClick={() => {
              revealInFileManager(menu.path)
              setMenu(null)
            }}
          >
            {t('view.disk-map.menu.reveal')}
          </button>
          <button
            className="ctx-menu__item ctx-menu__item--danger"
            onClick={() => {
              const { path, name } = menu
              setMenu(null)
              deleteEntry(path, name)
            }}
          >
            {t('view.disk-map.menu.delete')}
          </button>
        </div>
      )}
    </div>
  )
}
