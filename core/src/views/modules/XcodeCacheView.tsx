import { useEffect, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { formatBytes } from './TempCleanView'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'

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
  xcode_present: boolean
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

export function XcodeCacheView() {
  const [scan, setScan] = useState<ScanData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<CleanData | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setError(null)
    setResult(null)
    try {
      const res = await callModule<ScanData>('xcode-cache', { cmd: 'scan' })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setScan(res.data)
      // Anything that comes back on its own is preselected; archives are
      // not, because deleting one cannot be undone and a default should
      // never make that choice for someone.
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
        ? `\n\nWśród nich jest ${permanentPicked} archiwów, których nie da się odtworzyć.`
        : ''
    if (!(await confirmAction(`Usunąć ${selected.length} pozycji (${formatBytes(selectedBytes)})?${warning}`))) return

    setBusy(true)
    try {
      const res = await callModule<CleanData>('xcode-cache', {
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
      <Preparing
        title="Sprawdzam, co zostawił Xcode"
        note="Liczę rozmiary katalogów kompilacji i symboli urządzeń. Przy dużych projektach to chwilę trwa."
      />
    )
  }

  if (!scan.xcode_present) {
    return (
      <div className="glass empty-state">
        Nie znaleziono katalogu Xcode — ten moduł nie ma tu czego sprzątać.
      </div>
    )
  }

  return (
    <>
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value mono">{formatBytes(scan.total_bytes)}</div>
          <div className="xc-summary-label">zajmują pozostałości Xcode</div>
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
