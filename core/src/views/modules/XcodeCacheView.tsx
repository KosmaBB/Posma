import { useEffect, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { FullDiskAccessRow } from '../Settings'
import { t } from '../../i18n'

type Recovery = 'rebuilt' | 'refetched' | 'permanent'

interface Entry {
  path: string
  name: string
  size_bytes: number
}

interface Category {
  id: string
  name: string
  note: string
  recovery: Recovery
  entries: Entry[]
  total_bytes: number
}

interface ScanData {
  categories: Category[]
  total_bytes: number
  /** False when the application has never run on this machine. */
  present: boolean
  /** Places that exist but macOS would not open without Full Disk Access. */
  blocked: string[]
}

interface CleanData {
  freed_bytes: number
  removed: number
  errors: string[]
}

const RECOVERY: Record<Recovery, { label: string; chip: string }> = {
  rebuilt: { get label() { return t('view.xcode-cache.recovery.rebuilt') }, chip: 'low' },
  refetched: { get label() { return t('view.xcode-cache.recovery.refetched') }, chip: 'medium' },
  permanent: { get label() { return t('view.xcode-cache.recovery.permanent') }, chip: 'critical' },
}

/** What differs between the modules that clean a fixed list of Library places. */
interface LibraryCleanProps {
  module: string
  scanning: string
  scanningNote: string
  absent: string
  summary: string
}

export function XcodeCacheView() {
  return (
    <LibraryCleanView
      module="xcode-cache"
      scanning={t('view.xcode-cache.xcode.scanning')}
      scanningNote={t('view.xcode-cache.xcode.scanning-note')}
      absent={t('view.xcode-cache.xcode.absent')}
      summary={t('view.xcode-cache.xcode.summary')}
    />
  )
}

export function MacosSlimView() {
  return (
    <LibraryCleanView
      module="macos-slim"
      scanning={t('view.xcode-cache.macos-slim.scanning')}
      scanningNote={t('view.xcode-cache.macos-slim.scanning-note')}
      absent={t('view.xcode-cache.macos-slim.absent')}
      summary={t('view.xcode-cache.macos-slim.summary')}
    />
  )
}

function LibraryCleanView({ module, scanning, scanningNote, absent, summary }: LibraryCleanProps) {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<CleanData | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setError(null)
    setResult(null)
    try {
      const res = await callModule<ScanData>(module, { cmd: 'scan' })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setScan(res.data)
      // Anything that comes back on its own is preselected; what cannot
      // come back is not, because a default should never make that choice
      // for someone.
      setPicked(
        new Set(
          res.data.categories
            .filter((c) => c.recovery !== 'permanent')
            .flatMap((c) => c.entries.map((e) => e.path)),
        ),
      )
    } catch (e) {
      setError(String(e))
    }
  }

  useEffect(() => {
    load()
  }, [])

  function toggle(path: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleCategory(c: Category) {
    const all = c.entries.every((e) => picked.has(e.path))
    setPicked((prev) => {
      const next = new Set(prev)
      for (const e of c.entries) {
        if (all) next.delete(e.path)
        else next.add(e.path)
      }
      return next
    })
  }

  const selected = scan
    ? scan.categories.flatMap((c) => c.entries).filter((e) => picked.has(e.path))
    : []
  const selectedBytes = selected.reduce((sum, e) => sum + e.size_bytes, 0)
  const permanentPicked = scan
    ? scan.categories
        .filter((c) => c.recovery === 'permanent')
        .flatMap((c) => c.entries)
        .filter((e) => picked.has(e.path)).length
    : 0

  async function clean() {
    const warning =
      permanentPicked > 0
        ? `\n\n${t('view.xcode-cache.clean.permanent-warning', { n: permanentPicked })}`
        : ''
    if (!(await confirmAction(t('view.xcode-cache.clean.confirm', { n: selected.length, size: formatBytes(selectedBytes) }) + warning))) return

    setBusy(true)
    try {
      const res = await callModule<CleanData>(module, {
        cmd: 'clean',
        paths: selected.map((e) => e.path),
      })
      if (res.ok) {
        setResult(res.data)
        load()
      } else {
        setError(res.error)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
        {error}
        <br />
        <button className="btn btn-ghost" onClick={load}>{t('view.xcode-cache.retry')}</button>
      </div>
    )
  }

  if (!scan) {
    return (
      <Preparing title={scanning} note={scanningNote} />
    )
  }

  if (!scan.present) {
    return <div className="glass empty-state">{absent}</div>
  }

  return (
    <>
      {scan.blocked.length > 0 && (
        <>
          <div className="xc-note">
            {t('view.xcode-cache.blocked', { list: scan.blocked.join(', ') })}
          </div>
          <FullDiskAccessRow />
        </>
      )}
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value mono">{formatBytes(scan.total_bytes)}</div>
          <div className="xc-summary-label">{summary}</div>
        </div>
        <button
          className="btn btn-primary"
          onClick={clean}
          disabled={busy || selected.length === 0}
        >
          {busy ? t('view.xcode-cache.removing') : t('view.xcode-cache.remove-selected', { size: formatBytes(selectedBytes) })}
        </button>
      </div>

      {result && (
        <div className="glass xc-result">
          {t('view.xcode-cache.result', { size: formatBytes(result.freed_bytes), n: result.removed })}
          {result.errors.map((e, i) => (
            <div key={i} className="xc-error">{e}</div>
          ))}
        </div>
      )}

      {scan.categories.map((c) => (
        <div key={c.id}>
          <div className="section-head">
            <h2>{c.name}</h2>
            <span className={`chip ${RECOVERY[c.recovery].chip}`}>{RECOVERY[c.recovery].label}</span>
            <span className="count">{formatBytes(c.total_bytes)}</span>
            <button className="btn btn-ghost btn-mini" onClick={() => toggleCategory(c)}>
              {c.entries.every((e) => picked.has(e.path)) ? t('view.xcode-cache.deselect-all') : t('view.xcode-cache.select-all')}
            </button>
          </div>
          <div className="xc-note">{c.note}</div>
          <div className="clean-list">
            {c.entries.map((e) => (
              <label
                key={e.path}
                className={`glass clean-row${picked.has(e.path) ? ' checked' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={picked.has(e.path)}
                  onChange={() => toggle(e.path)}
                />
                <span className="cr-path mono" title={e.path}>{e.name}</span>
                <span className="cr-size mono">{formatBytes(e.size_bytes)}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
