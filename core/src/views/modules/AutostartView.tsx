import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { Modal } from '../../components/Modal'
import { confirmAction } from '../../components/confirm'
import { callModule } from '../../data/callModule'
import { detectOs } from '../../state/appState'
import { t } from '../../i18n'

interface Entry {
  id: string
  name: string
  exec: string
  icon: string | null
  comment: string | null
  enabled: boolean
  custom: boolean
}

interface ScanData {
  entries: Entry[]
}

interface CheckPathData {
  exists: boolean
  is_file: boolean
  executable: boolean
  has_shebang: boolean
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; entries: Entry[] }
  | { kind: 'error'; message: string }

interface FormState {
  id: string | null
  name: string
  path: string
  args: string
  icon: string
  wrapInShell: boolean
  makeExecutable: boolean
  pathCheck: CheckPathData | null
  checking: boolean
}

const EMPTY_FORM: FormState = {
  id: null,
  name: '',
  path: '',
  args: '',
  icon: '',
  wrapInShell: false,
  makeExecutable: false,
  pathCheck: null,
  checking: false,
}

/** Reconstructs path/args/wrapInShell from a custom entry's Exec= line, for editing. */
function parseExecForEdit(exec: string): { path: string; args: string; wrapInShell: boolean } {
  let rest = exec.trim()
  let wrapInShell = false
  if (rest.startsWith('bash ')) {
    wrapInShell = true
    rest = rest.slice(5).trim()
  }
  const match = rest.match(/^"((?:[^"\\]|\\.)*)"\s*(.*)$/)
  if (match) {
    return { path: match[1].replace(/\\(.)/g, '$1'), args: match[2], wrapInShell }
  }
  const [path, ...argParts] = rest.split(' ')
  return { path: path ?? '', args: argParts.join(' '), wrapInShell }
}

export function AutostartView() {
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [form, setForm] = useState<FormState | null>(null)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  async function runScan() {
    setPhase({ kind: 'loading' })
    try {
      const res = await callModule<ScanData>('autostart', { cmd: 'scan' })
      if (!res.ok) {
        setPhase({ kind: 'error', message: res.error })
        return
      }
      setPhase({ kind: 'loaded', entries: res.data.entries })
    } catch (e) {
      setPhase({ kind: 'error', message: String(e) })
    }
  }

  async function handleToggle(entry: Entry) {
    const nextEnabled = !entry.enabled
    setPending((prev) => new Set(prev).add(entry.id))
    setPhase((p) =>
      p.kind === 'loaded'
        ? { kind: 'loaded', entries: p.entries.map((e) => (e.id === entry.id ? { ...e, enabled: nextEnabled } : e)) }
        : p,
    )
    try {
      const res = await callModule<{ enabled: boolean }>('autostart', { cmd: 'toggle', id: entry.id, enabled: nextEnabled })
      if (!res.ok) {
        setPhase((p) =>
          p.kind === 'loaded'
            ? { kind: 'loaded', entries: p.entries.map((e) => (e.id === entry.id ? { ...e, enabled: entry.enabled } : e)) }
            : p,
        )
        window.alert(t('view.autostart.toggle-failed', { error: res.error }))
      }
    } catch (e) {
      setPhase((p) =>
        p.kind === 'loaded'
          ? { kind: 'loaded', entries: p.entries.map((ent) => (ent.id === entry.id ? { ...ent, enabled: entry.enabled } : ent)) }
          : p,
      )
      window.alert(t('view.autostart.toggle-failed', { error: String(e) }))
    } finally {
      setPending((prev) => {
        const next = new Set(prev)
        next.delete(entry.id)
        return next
      })
    }
  }

  function openAddForm() {
    setFormError(null)
    setForm({ ...EMPTY_FORM })
  }

  function openEditForm(entry: Entry) {
    const { path, args, wrapInShell } = parseExecForEdit(entry.exec)
    setFormError(null)
    setForm({
      id: entry.id,
      name: entry.name,
      path,
      args,
      icon: entry.icon ?? '',
      wrapInShell,
      makeExecutable: false,
      pathCheck: null,
      checking: false,
    })
  }

  async function setPathAndCheck(path: string) {
    setForm((f) => (f ? { ...f, path, checking: true, pathCheck: null } : f))
    try {
      const res = await callModule<CheckPathData>('autostart', { cmd: 'check_path', path })
      setForm((f) => (f ? { ...f, checking: false, pathCheck: res.ok ? res.data : null } : f))
    } catch {
      setForm((f) => (f ? { ...f, checking: false, pathCheck: null } : f))
    }
  }

  async function pickPath() {
    const selected = await open({ multiple: false, directory: false, title: t('view.autostart.pick-title') })
    if (typeof selected === 'string') {
      await setPathAndCheck(selected)
    }
  }

  async function submitForm() {
    if (!form) return
    if (!form.name.trim() || !form.path.trim()) {
      setFormError(t('view.autostart.form.required'))
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const res = await callModule<{ id: string }>('autostart', {
        cmd: 'add',
        id: form.id,
        name: form.name.trim(),
        path: form.path.trim(),
        args: form.args.trim() || null,
        icon: form.icon.trim() || null,
        wrap_in_shell: form.wrapInShell,
        make_executable: form.makeExecutable,
      })
      if (!res.ok) {
        setFormError(res.error)
        return
      }
      setForm(null)
      await runScan()
    } catch (e) {
      setFormError(String(e))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(entry: Entry) {
    if (!(await confirmAction(t('view.autostart.delete.confirm', { name: entry.name })))) return
    try {
      const res = await callModule<{ removed: boolean }>('autostart', { cmd: 'delete', id: entry.id })
      if (!res.ok) {
        window.alert(t('view.autostart.delete.failed', { error: res.error }))
        return
      }
      await runScan()
    } catch (e) {
      window.alert(t('view.autostart.delete.failed', { error: String(e) }))
    }
  }

  return (
    <div>
      {phase.kind === 'idle' && (
        <div className="glass empty-state">
          {t('view.autostart.intro')}
          <br />
          <button className="btn btn-primary" onClick={runScan}>{t('view.autostart.load')}</button>
        </div>
      )}

      {phase.kind === 'loading' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          {t('view.autostart.loading')}
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          {t('view.autostart.error', { error: phase.message })}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>{t('view.autostart.retry')}</button>
        </div>
      )}

      {phase.kind === 'loaded' && (
        <>
          <div className="section-head">
            <h2>{t('view.autostart.title')}</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="count">{phase.entries.length}</span>
              <button className="btn btn-ghost btn-mini" onClick={runScan}>{t('view.autostart.refresh')}</button>
              {/* Na Windowsie programy same dopisują się do autostartu; tu tylko je przełączamy. */}
              {detectOs() !== 'windows' && <button className="btn btn-primary btn-mini" onClick={openAddForm}>{t('view.autostart.add')}</button>}
            </div>
          </div>

          {phase.entries.length === 0 ? (
            <div className="glass empty-state">{t('view.autostart.empty')}</div>
          ) : (
            <div className="autostart-list">
              {phase.entries.map((entry) => (
                <div key={entry.id} className={`glass autostart-row${entry.enabled ? '' : ' disabled'}`}>
                  <div className="autostart-info">
                    <div className="autostart-name">
                      {entry.name}
                      {entry.custom && <span className="chip os" style={{ marginLeft: 8 }}>{t('view.autostart.custom')}</span>}
                    </div>
                    {entry.comment && <div className="autostart-comment">{entry.comment}</div>}
                    <div className="autostart-exec mono">{entry.exec}</div>
                  </div>
                  {entry.custom && (
                    <button className="btn btn-ghost btn-mini" onClick={() => openEditForm(entry)}>{t('view.autostart.edit')}</button>
                  )}
                  {entry.custom && (
                    <button className="btn btn-ghost btn-mini" onClick={() => handleDelete(entry)}>{t('common.remove')}</button>
                  )}
                  <button
                    className={`toggle${entry.enabled ? ' on' : ''}`}
                    aria-label={t(entry.enabled ? 'view.autostart.disable' : 'view.autostart.enable', { name: entry.name })}
                    disabled={pending.has(entry.id)}
                    onClick={() => handleToggle(entry)}
                  />
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {form && (
        <Modal onClose={() => !saving && setForm(null)} cardClassName="glass modal-card">
            <h3>{form.id ? t('view.autostart.form.edit-title') : t('view.autostart.form.add-title')}</h3>

            <label className="form-field">
              <span>{t('view.autostart.form.name')}</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </label>

            <label className="form-field">
              <span>{t('view.autostart.form.path')}</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="mono"
                  value={form.path}
                  placeholder="/usr/bin/..."
                  onChange={(e) => setPathAndCheck(e.target.value)}
                />
                <button className="btn btn-ghost btn-mini" type="button" onClick={pickPath}>{t('view.autostart.form.browse')}</button>
              </div>
            </label>

            {form.pathCheck && !form.pathCheck.exists && form.path.trim() !== '' && (
              <div className="form-warning">{t('view.autostart.form.not-found')}</div>
            )}
            {form.pathCheck?.exists && !form.pathCheck.executable && (
              <div className="form-warning">
                {t('view.autostart.form.not-executable')}
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={form.makeExecutable}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, makeExecutable: e.target.checked, wrapInShell: e.target.checked ? false : f.wrapInShell } : f))
                      }
                    />
                    {t('view.autostart.form.make-executable')}
                  </label>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={form.wrapInShell}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, wrapInShell: e.target.checked, makeExecutable: e.target.checked ? false : f.makeExecutable } : f))
                      }
                    />
                    {t('view.autostart.form.run-with-bash')}
                  </label>
                </div>
              </div>
            )}

            <label className="form-field">
              <span>{t('view.autostart.form.args')}</span>
              <input
                type="text"
                className="mono"
                value={form.args}
                onChange={(e) => setForm((f) => (f ? { ...f, args: e.target.value } : f))}
              />
            </label>

            <div className="form-preview mono">
              Exec={form.wrapInShell ? `bash "${form.path || '...'}"` : `"${form.path || '...'}"`}
              {form.args ? ` ${form.args}` : ''}
            </div>

            {formError && <div className="form-warning" style={{ color: 'var(--critical)' }}>{formError}</div>}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button className="btn btn-ghost" onClick={() => setForm(null)} disabled={saving}>{t('common.cancel')}</button>
              <button className="btn btn-primary" onClick={submitForm} disabled={saving}>
                {saving ? t('view.autostart.form.saving') : t('view.autostart.form.save')}
              </button>
            </div>
        </Modal>
      )}
    </div>
  )
}
