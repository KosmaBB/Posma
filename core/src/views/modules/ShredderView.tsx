import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'

interface ShredResult {
  freed_bytes: number
  removed: number
  errors: string[]
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

type Phase =
  | { kind: 'idle' }
  | { kind: 'shredding' }
  | { kind: 'done'; result: ShredResult }
  | { kind: 'error'; message: string }

const PASSES = 3
const CONFIRM_WORD = 'USUŃ'

export function ShredderView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [selected, setSelected] = useState<string[]>([])
  const [confirmText, setConfirmText] = useState('')

  function addPaths(paths: string[]) {
    setSelected((prev) => Array.from(new Set([...prev, ...paths])))
  }

  async function pickFiles() {
    const result = await open({ multiple: true, directory: false, title: 'Wybierz pliki do zniszczenia' })
    if (Array.isArray(result)) addPaths(result)
    else if (typeof result === 'string') addPaths([result])
  }

  async function pickFolder() {
    const result = await open({ multiple: false, directory: true, title: 'Wybierz folder do zniszczenia' })
    if (typeof result === 'string') addPaths([result])
  }

  function removeSelected(path: string) {
    setSelected((prev) => prev.filter((p) => p !== path))
  }

  async function runShred() {
    if (selected.length === 0) return
    setPhase({ kind: 'shredding' })
    try {
      const res = await invoke<ApiResponse<ShredResult>>('shred_files', { paths: selected })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setSelected([])
      setConfirmText('')
      setPhase({ kind: 'done', result: res.data })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  const canConfirm = selected.length > 0 && confirmText.trim().toUpperCase() === CONFIRM_WORD
  const busy = phase.kind === 'shredding'

  return (
    <div>
      <div className="glass empty-state" style={{ textAlign: 'left' }}>
        <div style={{ fontWeight: 700, color: 'var(--critical)', marginBottom: 8 }}>To działanie jest nieodwracalne.</div>
        Wybrane pliki i foldery zostaną nadpisane losowymi danymi ({PASSES}&times;), zmienią nazwę i zostaną usunięte —
        nie da się ich odzyskać z Kosza ani cofnąć.
      </div>

      <div className="section-head">
        <h2>Do zniszczenia</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-mini" onClick={pickFiles} disabled={busy}>Wybierz pliki...</button>
          <button className="btn btn-ghost btn-mini" onClick={pickFolder} disabled={busy}>Wybierz folder...</button>
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="glass empty-state">Nic nie wybrano.</div>
      ) : (
        <div className="clean-list">
          {selected.map((path) => (
            <div key={path} className="glass clean-row checked">
              <span className="cr-path mono">{path}</span>
              <button className="btn btn-ghost btn-mini" onClick={() => removeSelected(path)} disabled={busy}>
                Usuń z listy
              </button>
            </div>
          ))}
        </div>
      )}

      {selected.length > 0 && phase.kind !== 'done' && (
        <div className="glass" style={{ padding: 18, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="form-field">
            <span>Wpisz „{CONFIRM_WORD}" aby potwierdzić</span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            className="btn btn-primary"
            style={{ background: 'linear-gradient(135deg, var(--g-red-1), var(--g-red-2))', alignSelf: 'flex-start' }}
            disabled={!canConfirm || busy}
            onClick={runShred}
          >
            {busy ? 'Niszczenie...' : `Zniszcz ${selected.length} pozycji`}
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
            Zniszczono {phase.result.removed} pozycji ({formatBytes(phase.result.freed_bytes)})
          </div>
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>... i {phase.result.errors.length - 8} więcej</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={() => setPhase({ kind: 'idle' })}>Zamknij</button>
        </div>
      )}
    </div>
  )
}
