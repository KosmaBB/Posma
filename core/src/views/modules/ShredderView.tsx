import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { Icon } from '../../components/Icons'
import { formatBytes } from './TempCleanView'
import { callModule } from '../../data/callModule'
import { t } from '../../i18n'

interface ShredResult {
  freed_bytes: number
  removed: number
  errors: string[]
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'shredding' }
  | { kind: 'done'; result: ShredResult }
  | { kind: 'error'; message: string }

const PASSES = 3

export function ShredderView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [selected, setSelected] = useState<string[]>([])
  const [confirmText, setConfirmText] = useState('')

  function addPaths(paths: string[]) {
    setSelected((prev) => Array.from(new Set([...prev, ...paths])))
  }

  async function pickFiles() {
    const result = await open({ multiple: true, directory: false, title: t('view.shredder.pick-files') })
    if (Array.isArray(result)) addPaths(result)
    else if (typeof result === 'string') addPaths([result])
  }

  async function pickFolder() {
    const result = await open({ multiple: false, directory: true, title: t('view.shredder.pick-folder') })
    if (typeof result === 'string') addPaths([result])
  }

  function removeSelected(path: string) {
    setSelected((prev) => prev.filter((p) => p !== path))
  }

  async function runShred() {
    if (selected.length === 0) return
    setPhase({ kind: 'shredding' })
    try {
      const res = await callModule<ShredResult>('shredder', { cmd: 'shred', paths: selected })
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

  const confirmWord = t('view.shredder.confirm-word')
  const canConfirm = selected.length > 0 && confirmText.trim().toUpperCase() === confirmWord
  const busy = phase.kind === 'shredding'

  return (
    <div>
      <div className="glass empty-state intro">
        <div style={{ fontWeight: 700, color: 'var(--critical)', marginBottom: 8 }}>{t('view.shredder.warning.title')}</div>
        {t('view.shredder.warning.body', { passes: PASSES })}
      </div>

      <div className="section-head">
        <h2>{t('view.shredder.heading')}</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-mini" onClick={pickFiles} disabled={busy}>{t('view.shredder.choose-files')}</button>
          <button className="btn btn-ghost btn-mini" onClick={pickFolder} disabled={busy}>{t('view.shredder.choose-folder')}</button>
        </div>
      </div>

      {selected.length === 0 ? (
        <div className="glass empty-state">{t('view.shredder.empty')}</div>
      ) : (
        <div className="clean-list">
          {selected.map((path) => (
            <div key={path} className="glass clean-row checked">
              <span className="cr-path mono">{path}</span>
              <button className="btn btn-ghost btn-mini" onClick={() => removeSelected(path)} disabled={busy}>
                {t('view.shredder.remove')}
              </button>
            </div>
          ))}
        </div>
      )}

      {selected.length > 0 && phase.kind !== 'done' && (
        <div className="glass" style={{ padding: 18, marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label className="form-field">
            <span>{t('view.shredder.confirm-label', { word: confirmWord })}</span>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              disabled={busy}
            />
          </label>
          <button
            className="btn btn-primary btn-danger"
            style={{ alignSelf: 'flex-start' }}
            disabled={!canConfirm || busy}
            onClick={runShred}
          >
            {busy ? t('view.shredder.shredding') : t('view.shredder.shred', { n: selected.length })}
          </button>
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)', marginTop: 12 }}>
          {t('view.shredder.error', { message: phase.message })}
        </div>
      )}

      {phase.kind === 'done' && (
        <div className="glass empty-state">
          <div className="done-badge">
            <Icon name="check" />
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--ink)', fontFamily: 'var(--sans)' }}>
            {t('view.shredder.done', { n: phase.result.removed, size: formatBytes(phase.result.freed_bytes) })}
          </div>
          {phase.result.errors.length > 0 && (
            <div className="clean-errors mono">
              {phase.result.errors.slice(0, 8).map((err) => (
                <div key={err}>{err}</div>
              ))}
              {phase.result.errors.length > 8 && <div>{t('view.shredder.more-errors', { n: phase.result.errors.length - 8 })}</div>}
            </div>
          )}
          <br />
          <button className="btn btn-primary" onClick={() => setPhase({ kind: 'idle' })}>{t('view.shredder.close')}</button>
        </div>
      )}
    </div>
  )
}
