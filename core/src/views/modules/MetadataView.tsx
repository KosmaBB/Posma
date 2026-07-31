import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'

interface MetaField {
  id: string
  label: string
  value: string
}

interface FileInfo {
  path: string
  format: string
  supported: boolean
  fields: MetaField[]
  metadata_bytes: number
  size: number
  error: string | null
}

interface CleanEntry {
  path: string
  cleaned: boolean
  freed_bytes: number
  removed_fields: string[]
  error: string | null
}

interface CleanResult {
  entries: CleanEntry[]
  total_freed: number
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'inspecting' }
  | { kind: 'cleaning' }
  | { kind: 'done'; result: CleanResult }
  | { kind: 'error'; message: string }

function fileName(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1] || path
}

export function MetadataView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [items, setItems] = useState<FileInfo[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [keepFields, setKeepFields] = useState<Map<string, Set<string>>>(new Map())

  async function inspectPaths(paths: string[]) {
    setPhase({ kind: 'inspecting' })
    try {
      const res = await invoke<ApiResponse<FileInfo[]>>('inspect_metadata', { paths })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setItems(res.data)
      setSelected(new Set(res.data.filter((f) => f.supported && f.metadata_bytes > 0).map((f) => f.path)))
      setPhase({ kind: 'idle' })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  async function pickFiles() {
    const result = await open({
      multiple: true,
      directory: false,
      title: 'Wybierz zdjęcia do sprawdzenia',
      filters: [{ name: 'Obrazy', extensions: ['jpg', 'jpeg', 'png'] }],
    })
    const picked = Array.isArray(result) ? result : typeof result === 'string' ? [result] : []
    if (picked.length === 0) return
    const merged = Array.from(new Set([...items.map((f) => f.path), ...picked]))
    await inspectPaths(merged)
  }

  function removeItem(path: string) {
    setItems((prev) => prev.filter((f) => f.path !== path))
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
    setExpanded((prev) => {
      const next = new Set(prev)
      next.delete(path)
      return next
    })
    setKeepFields((prev) => {
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }

  function toggleSelected(path: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleExpanded(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function toggleKeepField(path: string, fieldId: string) {
    setKeepFields((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(path) ?? [])
      if (set.has(fieldId)) set.delete(fieldId)
      else set.add(fieldId)
      next.set(path, set)
      return next
    })
  }

  async function runClean() {
    const targets = items.filter((f) => selected.has(f.path))
    if (targets.length === 0) return
    setPhase({ kind: 'cleaning' })
    try {
      const cleanItems = targets.map((f) => ({ path: f.path, keep_fields: Array.from(keepFields.get(f.path) ?? []) }))
      const res = await invoke<ApiResponse<CleanResult>>('clean_metadata', { items: cleanItems })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setItems([])
      setSelected(new Set())
      setKeepFields(new Map())
      setExpanded(new Set())
      setPhase({ kind: 'done', result: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  const busy = phase.kind === 'inspecting' || phase.kind === 'cleaning'
  const selectableCount = items.filter((f) => f.supported && f.metadata_bytes > 0).length

  return (
    <div>
      <div className="glass empty-state" style={{ textAlign: 'left' }}>
        <div style={{ fontWeight: 700, color: 'var(--ink)', marginBottom: 8 }}>Ukryte dane w zdjęciach</div>
        Zdjęcia z telefonów i aparatów często zawierają w sobie EXIF (model urządzenia, data, czasem dokładna
        lokalizacja GPS) oraz komentarze czy tagi tekstowe. Wybierz pliki JPEG lub PNG, rozwiń pozycję żeby zobaczyć
        dokładnie co w nich siedzi, i wybierz co ma zostać usunięte — resztę (np. samą datę zrobienia) możesz
        zachować.
      </div>

      <div className="section-head">
        <h2>Do sprawdzenia</h2>
        <button className="btn btn-ghost btn-mini" onClick={pickFiles} disabled={busy}>Wybierz pliki...</button>
      </div>

      {items.length === 0 && phase.kind !== 'inspecting' ? (
        <div className="glass empty-state">Nic nie wybrano.</div>
      ) : (
        <div className="clean-list">
          {phase.kind === 'inspecting' && items.length === 0 && (
            <div className="glass empty-state">Sprawdzanie...</div>
          )}
          {items.map((f) => {
            const canSelect = f.supported && f.metadata_bytes > 0
            const isSelected = selected.has(f.path)
            const isExpanded = expanded.has(f.path)
            const keptForFile = keepFields.get(f.path) ?? new Set<string>()
            return (
              <div key={f.path} className="glass" style={{ padding: 0, overflow: 'hidden' }}>
                <div
                  className={`clean-row ${isSelected ? 'checked' : ''}`}
                  onClick={() => canSelect && !busy && toggleSelected(f.path)}
                  style={{ cursor: canSelect ? 'pointer' : 'default', opacity: canSelect ? undefined : 0.55, border: 'none' }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={!canSelect || busy}
                    onChange={() => toggleSelected(f.path)}
                    onClick={(e) => e.stopPropagation()}
                  />
                  <span className="cr-path mono" title={f.path}>{fileName(f.path)}</span>
                  {f.error ? (
                    <span className="chip critical">{f.error}</span>
                  ) : !f.supported ? (
                    <span className="chip os">nieobsługiwany format</span>
                  ) : f.fields.length === 0 ? (
                    <span className="chip low">czysty</span>
                  ) : (
                    f.fields.map((field) => (
                      <span key={field.id} className={`chip ${field.id === 'gps' ? 'critical' : 'medium'}`}>{field.label}</span>
                    ))
                  )}
                  <span className="cr-size">{f.metadata_bytes > 0 ? formatBytes(f.metadata_bytes) : ''}</span>
                  {f.fields.length > 0 && (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpanded(f.path)
                      }}
                      disabled={busy}
                    >
                      {isExpanded ? 'Zwiń' : 'Szczegóły'}
                    </button>
                  )}
                  <button
                    className="btn btn-ghost btn-mini"
                    onClick={(e) => {
                      e.stopPropagation()
                      removeItem(f.path)
                    }}
                    disabled={busy}
                  >
                    Usuń z listy
                  </button>
                </div>
                {isExpanded && f.fields.length > 0 && (
                  <div style={{ padding: '10px 16px 14px 44px', borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                      Zaznacz co zachować — reszta zostanie usunięta przy czyszczeniu.
                    </div>
                    {f.fields.map((field) => (
                      <label key={field.id} className="form-check" style={{ alignItems: 'flex-start' }}>
                        <input
                          type="checkbox"
                          checked={keptForFile.has(field.id)}
                          disabled={busy}
                          onChange={() => toggleKeepField(f.path, field.id)}
                        />
                        <span>
                          <strong>{field.label}</strong>
                          <span className="mono" style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 11.5 }}>{field.value}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {items.length > 0 && phase.kind !== 'done' && (
        <div style={{ marginTop: 12 }}>
          <button className="btn btn-primary" disabled={selected.size === 0 || busy} onClick={runClean}>
            {phase.kind === 'cleaning' ? 'Czyszczenie...' : `Wyczyść metadane (${selected.size}/${selectableCount})`}
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)', marginTop: 12 }}>
          Błąd: {phase.message}
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="glass empty-state">
          <div className="done-badge">
            <Icon name="check" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'Bricolage Grotesque, sans-serif' }}>
            Wyczyszczono {phase.result.entries.filter((e) => e.cleaned).length} plików ({formatBytes(phase.result.total_freed)})
          </div>
          <div className="clean-errors mono" style={{ color: 'var(--muted)', background: 'none', border: 'none', textAlign: 'left' }}>
            {phase.result.entries
              .filter((e) => e.cleaned && e.removed_fields.length > 0)
              .map((e) => (
                <div key={e.path} style={{ marginBottom: 4 }}>
                  {fileName(e.path)} — plik zawierał: {e.removed_fields.join(', ')}
                </div>
              ))}
          </div>
          {phase.result.entries.some((e) => e.error) && (
            <div className="clean-errors mono">
              {phase.result.entries
                .filter((e) => e.error)
                .slice(0, 8)
                .map((e) => (
                  <div key={e.path}>{fileName(e.path)}: {e.error}</div>
                ))}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={() => setPhase({ kind: 'idle' })}>Zamknij</button>
        </div>
      )}
    </div>
  )
}
