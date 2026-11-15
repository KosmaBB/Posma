import { useEffect, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { FullDiskAccessRow } from '../Settings'

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
  rebuilt: { label: 'Odbuduje się', chip: 'low' },
  refetched: { label: 'Pobierze się ponownie', chip: 'medium' },
  permanent: { label: 'Bezpowrotne', chip: 'critical' },
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
      scanning="Sprawdzam, co zostawił Xcode"
      scanningNote="Liczę rozmiary katalogów kompilacji i symboli urządzeń. Przy dużych projektach to chwilę trwa."
      absent="Nie znaleziono katalogu Xcode — ten moduł nie ma tu czego sprzątać."
      summary="zajmują pozostałości Xcode"
    />
  )
}

export function MacosSlimView() {
  return (
    <LibraryCleanView
      module="macos-slim"
      scanning="Sprawdzam Pocztę i Wiadomości"
      scanningNote="Liczę kopie otwartych załączników, podglądy i cache. Wiadomości i rozmowy nie są tu nawet czytane."
      absent="Poczta i Wiadomości nie były na tym Macu używane — nie ma tu czego odchudzać."
      summary="zajmują kopie i cache Poczty i Wiadomości"
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
        ? `\n\nWśród nich jest ${permanentPicked} pozycji, których nie da się odtworzyć.`
        : ''
    if (!(await confirmAction(`Usunąć ${selected.length} pozycji (${formatBytes(selectedBytes)})?${warning}`))) return

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
        <button className="btn btn-ghost" onClick={load}>Spróbuj ponownie</button>
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
            macOS nie pokazał: {scan.blocked.join(', ')}. Bez pełnego dostępu do dysku te miejsca są dla POSMA zamknięte.
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
          {busy ? 'Usuwam…' : `Usuń zaznaczone (${formatBytes(selectedBytes)})`}
        </button>
      </div>

      {result && (
        <div className="glass xc-result">
          Zwolniono {formatBytes(result.freed_bytes)} z {result.removed} pozycji.
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
              {c.entries.every((e) => picked.has(e.path)) ? 'Odznacz' : 'Zaznacz'} wszystko
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
