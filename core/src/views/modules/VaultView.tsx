import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Preparing } from '../../components/Preparing'
import { Icon } from '../../components/Icons'
import { Modal } from '../../components/Modal'
import { vaultCall, vaultStart } from './vaultApi'

// ------------------------------------------------------------------ types

interface TemplateField {
  name: string
  secret: boolean
}
interface TemplateInfo {
  id: number
  name: string
  fields: TemplateField[]
}
interface FolderInfo {
  id: number
  parent_id: number | null
  name: string
}
interface EntrySummary {
  id: number
  folder_id: number
  title: string
  template_id: number | null
}
interface Structure {
  folders: FolderInfo[]
  entries: EntrySummary[]
}
interface EntryDetail {
  id: number
  folder_id: number
  title: string
  template_id: number | null
  fields: Record<string, string>
}
interface AuditHit {
  entry_id: number
  entry_title: string
  field: string
  score: number
}
interface ReusedGroup {
  entry_titles: string[]
}
interface AuditResult {
  weak_count: number
  weak: AuditHit[]
  reused_count: number
  reused: ReusedGroup[]
}

const AUTO_LOCK_MS = 5 * 60 * 1000

function isSecretFieldName(name: string): boolean {
  const n = name.toLowerCase()
  return n.includes('hasło') || n.includes('password') || n.includes('klucz') || n.includes('cvc') || n.includes('cvv')
}

const STRENGTH_LABEL: Record<number, { label: string; chip: string }> = {
  0: { label: 'Bardzo słabe', chip: 'critical' },
  1: { label: 'Słabe', chip: 'critical' },
  2: { label: 'Średnie', chip: 'medium' },
  3: { label: 'Dobre', chip: 'low' },
  4: { label: 'Bardzo dobre', chip: 'low' },
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
  } catch {
    // clipboard access can be denied by the webview in some contexts — silently no-op rather than throw into the UI
  }
}

// ------------------------------------------------------------- root screen

export function VaultView() {
  const [phase, setPhase] = useState<'loading' | 'create' | 'locked' | 'unlocked' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      await vaultStart()
      const status = await vaultCall<{ initialized: boolean; unlocked: boolean }>({ cmd: 'status' })
      if (!status.initialized) setPhase('create')
      else if (status.unlocked) setPhase('unlocked')
      else setPhase('locked')
    } catch (e) {
      setError(String(e))
      setPhase('error')
    }
  }, [])

  useEffect(() => {
    refreshStatus()
  }, [refreshStatus])

  if (phase === 'loading') return <Preparing title="Uruchamiam sejf" note="Otwieram zaszyfrowaną bazę i przygotowuję ją do odblokowania." />
  if (phase === 'error') return <div className="glass empty-state" style={{ color: 'var(--critical)' }}>Błąd: {error}</div>
  if (phase === 'create') return <UnlockOrCreate mode="create" onReady={() => setPhase('unlocked')} />
  if (phase === 'locked') return <UnlockOrCreate mode="unlock" onReady={() => setPhase('unlocked')} />
  return <VaultMain onLocked={() => setPhase('locked')} />
}

// --------------------------------------------------------- unlock / create

interface UnlockResult {
  status: 'success' | 'wrong_pin' | 'locked_out'
  attempts_remaining?: number
  retry_after_secs?: number
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, '').slice(0, 6)
}

function UnlockOrCreate({ mode, onReady }: { mode: 'create' | 'unlock'; onReady: () => void }) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (pin.length !== 6) {
      setError('PIN musi mieć dokładnie 6 cyfr.')
      return
    }
    if (mode === 'create' && pin !== confirm) {
      setError('Kody PIN nie są takie same.')
      return
    }
    setBusy(true)
    try {
      if (mode === 'create') {
        await vaultCall<boolean>({ cmd: 'create', pin })
        onReady()
      } else {
        const result = await vaultCall<UnlockResult>({ cmd: 'unlock', pin })
        if (result.status === 'success') {
          onReady()
          return
        }
        if (result.status === 'wrong_pin') {
          setError(`Nieprawidłowy PIN. Pozostało prób: ${result.attempts_remaining}.`)
        } else {
          setError(`Zbyt wiele prób. Spróbuj ponownie za ${result.retry_after_secs} s.`)
        }
        setBusy(false)
      }
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <div className="glass empty-state" style={{ textAlign: 'left', maxWidth: 380, margin: '40px auto' }}>
      <div className="ico-badge" style={{ margin: '0 auto 14px', width: 46, height: 46, borderRadius: 13 }}>
        <Icon name="vault" />
      </div>
      <h2 style={{ textAlign: 'center', marginBottom: 6 }}>{mode === 'create' ? 'Utwórz sejf haseł' : 'Odblokuj sejf'}</h2>
      <p style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 12.5, marginBottom: 18 }}>
        {mode === 'create'
          ? 'Właściwy klucz szyfrujący generujemy losowo i trzymamy w bezpiecznym magazynie systemowym (Secret Service / Keychain) — nigdy w pliku sejfu. 6-cyfrowy PIN to tylko szybka blokada dostępu, nie klucz.'
          : 'Wpisz 6-cyfrowy PIN, żeby odblokować sejf.'}
      </p>

      <div className="form-field">
        <span>Kod PIN</span>
        <input
          type="password"
          inputMode="numeric"
          maxLength={6}
          value={pin}
          onChange={(e) => setPin(digitsOnly(e.target.value))}
          onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
          style={{ letterSpacing: '0.4em', textAlign: 'center', fontSize: 20 }}
          autoFocus
        />
      </div>
      {mode === 'create' && (
        <div className="form-field">
          <span>Powtórz PIN</span>
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={confirm}
            onChange={(e) => setConfirm(digitsOnly(e.target.value))}
            onKeyDown={(e) => e.key === 'Enter' && !busy && submit()}
            style={{ letterSpacing: '0.4em', textAlign: 'center', fontSize: 20 }}
          />
        </div>
      )}

      {error && <div className="form-warning" style={{ marginTop: 10 }}>{error}</div>}

      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 14 }} onClick={submit} disabled={busy || pin.length !== 6}>
        {busy ? 'Proszę czekać...' : mode === 'create' ? 'Utwórz sejf' : 'Odblokuj'}
      </button>
    </div>
  )
}

// -------------------------------------------------------- password generator

function PasswordGenerator({ onUse, onClose }: { onUse: (pw: string) => void; onClose: () => void }) {
  const [length, setLength] = useState(20)
  const [upper, setUpper] = useState(true)
  const [lower, setLower] = useState(true)
  const [digits, setDigits] = useState(true)
  const [symbols, setSymbols] = useState(true)
  const [generated, setGenerated] = useState('')
  const [error, setError] = useState<string | null>(null)

  const generate = useCallback(async () => {
    setError(null)
    try {
      const pw = await vaultCall<string>({ cmd: 'generate_password', length, upper, lower, digits, symbols })
      setGenerated(pw)
    } catch (e) {
      setError(String(e))
    }
  }, [length, upper, lower, digits, symbols])

  useEffect(() => {
    generate()
  }, [generate])

  return (
    <Modal onClose={onClose} style={{ maxWidth: 420 }}>
        <h3 style={{ marginBottom: 12 }}>Generator haseł</h3>
        <div className="form-preview mono" style={{ fontSize: 15, textAlign: 'center', marginBottom: 12, wordBreak: 'break-all' }}>{generated}</div>
        {error && <div className="form-warning">{error}</div>}
        <div className="form-field">
          <span>Długość: {length}</span>
          <input type="range" min={8} max={64} value={length} onChange={(e) => setLength(Number(e.target.value))} />
        </div>
        <label className="form-check"><input type="checkbox" checked={upper} onChange={(e) => setUpper(e.target.checked)} /><span>Wielkie litery (A-Z)</span></label>
        <label className="form-check"><input type="checkbox" checked={lower} onChange={(e) => setLower(e.target.checked)} /><span>Małe litery (a-z)</span></label>
        <label className="form-check"><input type="checkbox" checked={digits} onChange={(e) => setDigits(e.target.checked)} /><span>Cyfry (0-9)</span></label>
        <label className="form-check"><input type="checkbox" checked={symbols} onChange={(e) => setSymbols(e.target.checked)} /><span>Symbole (!@#...)</span></label>

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={generate}>Losuj ponownie</button>
          <button className="btn btn-ghost" onClick={() => copyToClipboard(generated)}>Kopiuj</button>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => { onUse(generated); onClose() }}>Użyj</button>
        </div>
    </Modal>
  )
}

// ------------------------------------------------------------ entry form

function EntryForm({
  templates,
  folderId,
  existing,
  onSaved,
  onClose,
}: {
  templates: TemplateInfo[]
  folderId: number
  existing: EntryDetail | null
  onSaved: () => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [templateId, setTemplateId] = useState<number | null>(existing?.template_id ?? templates[0]?.id ?? null)
  const [values, setValues] = useState<Record<string, string>>(existing?.fields ?? {})
  const [reveal, setReveal] = useState<Set<string>>(new Set())
  const [strengths, setStrengths] = useState<Record<string, number>>({})
  const [generatorFor, setGeneratorFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const template = templates.find((t) => t.id === templateId)

  function setField(name: string, value: string) {
    setValues((prev) => ({ ...prev, [name]: value }))
    if (isSecretFieldName(name) && value.length > 0) {
      vaultCall<number>({ cmd: 'estimate_strength', password: value }).then((s) => setStrengths((prev) => ({ ...prev, [name]: s }))).catch(() => {})
    }
  }

  function toggleReveal(name: string) {
    setReveal((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  async function save() {
    if (!title.trim()) {
      setError('Podaj tytuł wpisu.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (existing) {
        await vaultCall<boolean>({ cmd: 'update_entry', id: existing.id, title, template_id: templateId, fields: values })
      } else {
        await vaultCall<number>({ cmd: 'add_entry', folder_id: folderId, title, template_id: templateId, fields: values })
      }
      onSaved()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Modal onClose={onClose} style={{ maxWidth: 520 }}>
        <h3 style={{ marginBottom: 12 }}>{existing ? 'Edytuj wpis' : 'Nowy wpis'}</h3>

        <div className="form-field">
          <span>Tytuł</span>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>

        <div className="form-field">
          <span>Szablon</span>
          <select
            value={templateId ?? ''}
            onChange={(e) => {
              const id = Number(e.target.value)
              setTemplateId(id)
              setValues({})
            }}
            style={{ padding: '9px 12px', borderRadius: 10, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)' }}
          >
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>

        {template?.fields.map((f) => {
          const isSecret = f.secret
          const shown = reveal.has(f.name)
          const value = values[f.name] ?? ''
          const strength = strengths[f.name]
          const strengthInfo = strength !== undefined ? STRENGTH_LABEL[strength] : null
          return (
            <div className="form-field" key={f.name}>
              <span>{f.name}</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type={isSecret && !shown ? 'password' : 'text'}
                  value={value}
                  onChange={(e) => setField(f.name, e.target.value)}
                  style={{ flex: 1 }}
                />
                {isSecret && (
                  <>
                    <button type="button" className="btn btn-ghost btn-mini" onClick={() => toggleReveal(f.name)}>{shown ? 'Ukryj' : 'Pokaż'}</button>
                    <button type="button" className="btn btn-ghost btn-mini" onClick={() => setGeneratorFor(f.name)}>Generuj</button>
                  </>
                )}
                <button type="button" className="btn btn-ghost btn-mini" onClick={() => copyToClipboard(value)}>Kopiuj</button>
              </div>
              {isSecret && strengthInfo && <span className={`chip ${strengthInfo.chip}`} style={{ marginTop: 4, alignSelf: 'flex-start' }}>{strengthInfo.label}</span>}
            </div>
          )
        })}

        {error && <div className="form-warning">{error}</div>}

        <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Anuluj</button>
          <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={save} disabled={busy}>{busy ? 'Zapisywanie...' : 'Zapisz'}</button>
        </div>
      </Modal>

      {generatorFor && (
        <PasswordGenerator onClose={() => setGeneratorFor(null)} onUse={(pw) => setField(generatorFor, pw)} />
      )}
    </>
  )
}

// ------------------------------------------------------------ entry detail

function EntryDetailModal({ id, onClose, onEdit, onDeleted }: { id: number; onClose: () => void; onEdit: () => void; onDeleted: () => void }) {
  const [entry, setEntry] = useState<EntryDetail | null>(null)
  const [reveal, setReveal] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    vaultCall<EntryDetail>({ cmd: 'get_entry', id }).then(setEntry).catch((e) => setError(String(e)))
  }, [id])

  async function remove() {
    if (!window.confirm('Usunąć ten wpis? Tej operacji nie można cofnąć.')) return
    await vaultCall<boolean>({ cmd: 'delete_entry', id })
    onDeleted()
    onClose()
  }

  function toggleReveal(name: string) {
    setReveal((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  return (
    <Modal onClose={onClose} style={{ maxWidth: 480 }}>
        {error && <div className="form-warning">{error}</div>}
        {!entry && !error && <div className="glass empty-state">Odszyfrowywanie...</div>}
        {entry && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <h3>{entry.title}</h3>
              <button className="btn btn-ghost btn-mini" onClick={onClose}>Zamknij</button>
            </div>
            {Object.entries(entry.fields).map(([name, value]) => {
              const secret = isSecretFieldName(name)
              const shown = reveal.has(name)
              return (
                <div key={name} className="form-field">
                  <span>{name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className="mono form-preview" style={{ flex: 1, padding: '8px 12px' }}>
                      {secret && !shown ? '•'.repeat(Math.min(value.length, 16) || 8) : value || '—'}
                    </span>
                    {secret && <button className="btn btn-ghost btn-mini" onClick={() => toggleReveal(name)}>{shown ? 'Ukryj' : 'Pokaż'}</button>}
                    <button className="btn btn-ghost btn-mini" onClick={() => copyToClipboard(value)}>Kopiuj</button>
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={remove} style={{ color: 'var(--critical)' }}>Usuń</button>
              <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={onEdit}>Edytuj</button>
            </div>
          </>
        )}
    </Modal>
  )
}

// ---------------------------------------------------------------- change PIN

function ChangePinModal({ onClose }: { onClose: () => void }) {
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    setError(null)
    if (newPin.length !== 6 || oldPin.length !== 6) {
      setError('PIN musi mieć dokładnie 6 cyfr.')
      return
    }
    if (newPin !== confirmPin) {
      setError('Nowe kody PIN nie są takie same.')
      return
    }
    setBusy(true)
    try {
      await vaultCall<boolean>({ cmd: 'change_pin', old_pin: oldPin, new_pin: newPin })
      setDone(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} style={{ maxWidth: 380 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3>Zmień PIN</h3>
          <button className="btn btn-ghost btn-mini" onClick={onClose}>Zamknij</button>
        </div>
        {done ? (
          <div className="glass empty-state" style={{ padding: 20 }}>
            <div className="done-badge"><Icon name="check" /></div>
            PIN zmieniony. Klucz szyfrujący pozostał bez zmian — nic nie trzeba było ponownie szyfrować.
          </div>
        ) : (
          <>
            <div className="form-field">
              <span>Obecny PIN</span>
              <input type="password" inputMode="numeric" maxLength={6} value={oldPin} onChange={(e) => setOldPin(digitsOnly(e.target.value))} style={{ letterSpacing: '0.3em', textAlign: 'center' }} autoFocus />
            </div>
            <div className="form-field">
              <span>Nowy PIN</span>
              <input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e) => setNewPin(digitsOnly(e.target.value))} style={{ letterSpacing: '0.3em', textAlign: 'center' }} />
            </div>
            <div className="form-field">
              <span>Powtórz nowy PIN</span>
              <input type="password" inputMode="numeric" maxLength={6} value={confirmPin} onChange={(e) => setConfirmPin(digitsOnly(e.target.value))} style={{ letterSpacing: '0.3em', textAlign: 'center' }} />
            </div>
            {error && <div className="form-warning">{error}</div>}
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 10 }} onClick={submit} disabled={busy}>
              {busy ? 'Zapisywanie...' : 'Zmień PIN'}
            </button>
          </>
        )}
    </Modal>
  )
}

// ------------------------------------------------------------- security audit

function SecurityAuditModal({ onClose }: { onClose: () => void }) {
  const [result, setResult] = useState<AuditResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    vaultCall<AuditResult>({ cmd: 'security_audit' }).then(setResult).catch((e) => setError(String(e)))
  }, [])

  return (
    <Modal onClose={onClose} style={{ maxWidth: 520 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3>Audyt bezpieczeństwa</h3>
          <button className="btn btn-ghost btn-mini" onClick={onClose}>Zamknij</button>
        </div>
        {error && <div className="form-warning">{error}</div>}
        {!result && !error && <div className="glass empty-state">Analizowanie...</div>}
        {result && (
          <>
            {result.weak_count === 0 && result.reused_count === 0 ? (
              <div className="glass empty-state" style={{ padding: 24 }}>
                <div className="done-badge"><Icon name="check" /></div>
                Nie znaleziono słabych ani powtórzonych haseł.
              </div>
            ) : (
              <>
                {result.weak_count > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div className="section-head"><h2 style={{ fontSize: 13 }}>Słabe hasła ({result.weak_count})</h2></div>
                    <div className="clean-list">
                      {result.weak.map((w) => (
                        <div key={`${w.entry_id}-${w.field}`} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
                          <span className="cr-path">{w.entry_title}<span style={{ color: 'var(--muted)', marginLeft: 8, fontSize: 11 }}>{w.field}</span></span>
                          <span className={`chip ${STRENGTH_LABEL[w.score].chip}`}>{STRENGTH_LABEL[w.score].label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {result.reused_count > 0 && (
                  <div>
                    <div className="section-head"><h2 style={{ fontSize: 13 }}>Powtórzone hasła ({result.reused_count})</h2></div>
                    <div className="clean-list">
                      {result.reused.map((r, i) => (
                        <div key={i} className="glass clean-row" style={{ cursor: 'default', opacity: 1 }}>
                          <span className="cr-path">{r.entry_titles.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
    </Modal>
  )
}

// ---------------------------------------------------------------- main view

function VaultMain({ onLocked }: { onLocked: () => void }) {
  const [structure, setStructure] = useState<Structure | null>(null)
  const [templates, setTemplates] = useState<TemplateInfo[]>([])
  const [folderId, setFolderId] = useState(1)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editing, setEditing] = useState<EntryDetail | 'new' | null>(null)
  const [showAudit, setShowAudit] = useState(false)
  const [showChangePin, setShowChangePin] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const lockTimer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const [s, t] = await Promise.all([vaultCall<Structure>({ cmd: 'list_structure' }), vaultCall<TemplateInfo[]>({ cmd: 'list_templates' })])
      setStructure(s)
      setTemplates(t)
    } catch (e) {
      setError(String(e))
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const doLock = useCallback(async () => {
    await vaultCall<boolean>({ cmd: 'lock' }).catch(() => {})
    onLocked()
  }, [onLocked])

  useEffect(() => {
    function reset() {
      if (lockTimer.current) window.clearTimeout(lockTimer.current)
      lockTimer.current = window.setTimeout(doLock, AUTO_LOCK_MS)
    }
    reset()
    window.addEventListener('mousemove', reset)
    window.addEventListener('keydown', reset)
    return () => {
      window.removeEventListener('mousemove', reset)
      window.removeEventListener('keydown', reset)
      if (lockTimer.current) window.clearTimeout(lockTimer.current)
    }
  }, [doLock])

  async function addFolder() {
    if (!newFolderName.trim()) return
    await vaultCall<number>({ cmd: 'add_folder', name: newFolderName.trim(), parent_id: folderId })
    setNewFolderName('')
    setShowNewFolder(false)
    load()
  }

  const entriesInFolder = useMemo(() => structure?.entries.filter((e) => e.folder_id === folderId) ?? [], [structure, folderId])

  return (
    <div>
      <div className="section-head">
        <h2>Sejf</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn btn-ghost btn-mini" onClick={() => setShowAudit(true)}>Audyt bezpieczeństwa</button>
          <button className="btn btn-ghost btn-mini" onClick={() => setShowChangePin(true)}>Zmień PIN</button>
          <button className="btn btn-ghost btn-mini" onClick={doLock}>Zablokuj</button>
        </div>
      </div>

      {error && <div className="form-warning" style={{ marginBottom: 12 }}>{error}</div>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
        {structure?.folders.map((f) => (
          <button key={f.id} className={`diskmap-viewtab ${f.id === folderId ? 'active' : ''}`} onClick={() => setFolderId(f.id)}>{f.name}</button>
        ))}
        {showNewFolder ? (
          <span style={{ display: 'flex', gap: 6 }}>
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addFolder()}
              placeholder="Nazwa folderu"
              autoFocus
              style={{ padding: '6px 10px', borderRadius: 8, background: 'var(--bg-3)', border: '1px solid var(--border)', color: 'var(--ink)', fontSize: 12 }}
            />
            <button className="btn btn-ghost btn-mini" onClick={addFolder}>Dodaj</button>
          </span>
        ) : (
          <button className="btn btn-ghost btn-mini" onClick={() => setShowNewFolder(true)}>+ Folder</button>
        )}
      </div>

      <div className="section-head">
        <h2>Wpisy</h2>
        <button className="btn btn-primary btn-mini" onClick={() => setEditing('new')}>+ Nowy wpis</button>
      </div>

      {entriesInFolder.length === 0 ? (
        <div className="glass empty-state">Brak wpisów w tym folderze.</div>
      ) : (
        <div className="clean-list">
          {entriesInFolder.map((e) => {
            const tmpl = templates.find((t) => t.id === e.template_id)
            return (
              <div key={e.id} className="glass clean-row" style={{ cursor: 'pointer', opacity: 1 }} onClick={() => setDetailId(e.id)}>
                <span className="cr-path">{e.title}</span>
                {tmpl && <span className="chip os">{tmpl.name}</span>}
              </div>
            )
          })}
        </div>
      )}

      {detailId !== null && (
        <EntryDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onEdit={async () => {
            const entry = await vaultCall<EntryDetail>({ cmd: 'get_entry', id: detailId })
            setDetailId(null)
            setEditing(entry)
          }}
          onDeleted={load}
        />
      )}

      {editing && (
        <EntryForm
          templates={templates}
          folderId={folderId}
          existing={editing === 'new' ? null : editing}
          onSaved={load}
          onClose={() => setEditing(null)}
        />
      )}

      {showAudit && <SecurityAuditModal onClose={() => setShowAudit(false)} />}
      {showChangePin && <ChangePinModal onClose={() => setShowChangePin(false)} />}
    </div>
  )
}
