import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Modal } from '../../components/Modal'

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

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

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
      const res = await invoke<ApiResponse<ScanData>>('scan_autostart')
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
      const res = await invoke<ApiResponse<{ enabled: boolean }>>('toggle_autostart', { id: entry.id, enabled: nextEnabled })
      if (!res.ok) {
        setPhase((p) =>
          p.kind === 'loaded'
            ? { kind: 'loaded', entries: p.entries.map((e) => (e.id === entry.id ? { ...e, enabled: entry.enabled } : e)) }
            : p,
        )
        window.alert(`Nie udało się zmienić: ${res.error}`)
      }
    } catch (e) {
      setPhase((p) =>
        p.kind === 'loaded'
          ? { kind: 'loaded', entries: p.entries.map((ent) => (ent.id === entry.id ? { ...ent, enabled: entry.enabled } : ent)) }
          : p,
      )
      window.alert(`Nie udało się zmienić: ${String(e)}`)
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
      const res = await invoke<ApiResponse<CheckPathData>>('check_autostart_path', { path })
      setForm((f) => (f ? { ...f, checking: false, pathCheck: res.ok ? res.data : null } : f))
    } catch {
      setForm((f) => (f ? { ...f, checking: false, pathCheck: null } : f))
    }
  }

  async function pickPath() {
    const selected = await open({ multiple: false, directory: false, title: 'Wybierz aplikację lub skrypt' })
    if (typeof selected === 'string') {
      await setPathAndCheck(selected)
    }
  }

  async function submitForm() {
    if (!form) return
    if (!form.name.trim() || !form.path.trim()) {
      setFormError('Podaj nazwę i ścieżkę.')
      return
    }
    setSaving(true)
    setFormError(null)
    try {
      const res = await invoke<ApiResponse<{ id: string }>>('add_autostart', {
        id: form.id,
        name: form.name.trim(),
        path: form.path.trim(),
        args: form.args.trim() || null,
        icon: form.icon.trim() || null,
        wrapInShell: form.wrapInShell,
        makeExecutable: form.makeExecutable,
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
    if (!window.confirm(`Usunąć wpis „${entry.name}"? Tej operacji nie można cofnąć.`)) return
    try {
      const res = await invoke<ApiResponse<{ removed: boolean }>>('delete_autostart', { id: entry.id })
      if (!res.ok) {
        window.alert(`Nie udało się usunąć: ${res.error}`)
        return
      }
      await runScan()
    } catch (e) {
      window.alert(`Nie udało się usunąć: ${String(e)}`)
    }
  }

  return (
    <div>
      {phase.kind === 'idle' && (
        <div className="glass empty-state">
          Przejrzyj programy uruchamiające się automatycznie po zalogowaniu (~/.config/autostart) i wyłącz te,
          których nie potrzebujesz — nic nie jest usuwane, zawsze możesz włączyć z powrotem.
          <br />
          <button className="btn btn-primary" onClick={runScan}>Wczytaj</button>
        </div>
      )}

      {phase.kind === 'loading' && (
        <div className="glass empty-state">
          <span className="scan-spinner" aria-hidden />
          Wczytywanie wpisów autostartu...
        </div>
      )}

      {phase.kind === 'error' && (
        <div className="glass empty-state" style={{ color: 'var(--critical)' }}>
          Błąd: {phase.message}
          <br />
          <button className="btn btn-ghost" onClick={runScan}>Spróbuj ponownie</button>
        </div>
      )}

      {phase.kind === 'loaded' && (
        <>
          <div className="section-head">
            <h2>Programy startowe</h2>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span className="count">{phase.entries.length}</span>
              <button className="btn btn-ghost btn-mini" onClick={runScan}>Odśwież</button>
              <button className="btn btn-primary btn-mini" onClick={openAddForm}>+ Dodaj własny wpis</button>
            </div>
          </div>

          {phase.entries.length === 0 ? (
            <div className="glass empty-state">Brak wpisów autostartu w Twoim profilu.</div>
          ) : (
            <div className="autostart-list">
              {phase.entries.map((entry) => (
                <div key={entry.id} className={`glass autostart-row${entry.enabled ? '' : ' disabled'}`}>
                  <div className="autostart-info">
                    <div className="autostart-name">
                      {entry.name}
                      {entry.custom && <span className="chip os" style={{ marginLeft: 8 }}>Własny</span>}
                    </div>
                    {entry.comment && <div className="autostart-comment">{entry.comment}</div>}
                    <div className="autostart-exec mono">{entry.exec}</div>
                  </div>
                  {entry.custom && (
                    <button className="btn btn-ghost btn-mini" onClick={() => openEditForm(entry)}>Edytuj</button>
                  )}
                  {entry.custom && (
                    <button className="btn btn-ghost btn-mini" onClick={() => handleDelete(entry)}>Usuń</button>
                  )}
                  <button
                    className={`toggle${entry.enabled ? ' on' : ''}`}
                    aria-label={`${entry.enabled ? 'Wyłącz' : 'Włącz'} ${entry.name}`}
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
            <h3>{form.id ? 'Edytuj wpis' : 'Dodaj własny wpis'}</h3>

            <label className="form-field">
              <span>Nazwa</span>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => (f ? { ...f, name: e.target.value } : f))}
              />
            </label>

            <label className="form-field">
              <span>Co uruchomić</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  className="mono"
                  value={form.path}
                  placeholder="/usr/bin/..."
                  onChange={(e) => setPathAndCheck(e.target.value)}
                />
                <button className="btn btn-ghost btn-mini" type="button" onClick={pickPath}>Przeglądaj...</button>
              </div>
            </label>

            {form.pathCheck && !form.pathCheck.exists && form.path.trim() !== '' && (
              <div className="form-warning">Nie znaleziono pliku pod tą ścieżką.</div>
            )}
            {form.pathCheck?.exists && !form.pathCheck.executable && (
              <div className="form-warning">
                Ten plik nie jest wykonywalny — bez tego wpis nie uruchomi się przy logowaniu.
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={form.makeExecutable}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, makeExecutable: e.target.checked, wrapInShell: e.target.checked ? false : f.wrapInShell } : f))
                      }
                    />
                    Nadaj uprawnienia wykonywania
                  </label>
                  <label className="form-check">
                    <input
                      type="checkbox"
                      checked={form.wrapInShell}
                      onChange={(e) =>
                        setForm((f) => (f ? { ...f, wrapInShell: e.target.checked, makeExecutable: e.target.checked ? false : f.makeExecutable } : f))
                      }
                    />
                    Uruchom przez bash
                  </label>
                </div>
              </div>
            )}

            <label className="form-field">
              <span>Argumenty (opcjonalnie)</span>
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
              <button className="btn btn-ghost" onClick={() => setForm(null)} disabled={saving}>Anuluj</button>
              <button className="btn btn-primary" onClick={submitForm} disabled={saving}>
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>
            </div>
        </Modal>
      )}
    </div>
  )
}
