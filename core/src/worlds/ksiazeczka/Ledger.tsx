/**
 * The right page of the home spread: the ledger. POSMA keeps no history of
 * past operations the interface could read, so the ledger only ever holds
 * true rows: the opening balance read from the disk now, the pending order
 * to check what could be reclaimed, and one projected credit per module
 * once that read-only check is back. Line form carries state: solid is a
 * reading, dashed waits for the person's signature in the module, struck
 * failed. Below it, the order templates — the enabled modules' quick actions.
 */
import { useMemo, type CSSProperties } from 'react'
import type { AppState } from '../../state/appState'
import { catalogNumbers, moduleById, orderedModules, type ModuleDef } from '../../data/modules'
import { gb, size, usedPct, type Machine, type ReclaimState } from '../../state/machine'
import { Guilloche } from './Print'

const DAY = new Intl.DateTimeFormat('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
const pos = (i: number) => String(i + 1).padStart(2, '0')

interface LedgerProps {
  app: AppState
  machine: Machine
  reclaim: ReclaimState
}

export function LedgerPage({ app, machine, reclaim }: LedgerProps) {
  const { setView, installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const { reclaim: state, sources, check, found, total, foundOf } = reclaim
  const free = machine.mainDisk?.available_bytes ?? null
  const mount = machine.mainDisk?.mount_point ?? '/'
  const open = (id: string) => setView({ kind: 'module', moduleId: id })

  let running = free ?? 0
  const quick = orderedModules(os, moduleOrder, linuxProfile).filter((m) => installedSet.has(m.id) && m.quickAction)

  /** What a template can already say about its module before anything is asked of it. */
  function reading(m: ModuleDef): string | null {
    const hit = foundOf(m.id)
    if (hit && hit.bytes !== null) return `${size(hit.bytes)} do odzyskania`
    if (m.id === 'disk-map' && machine.mainDisk) return `${mount} zajęty w ${usedPct(machine.mainDisk).toFixed(0)} %`
    if (m.id === 'health-monitor' && machine.cpu)
      return [`procesor ${machine.cpu.value.toFixed(0)} %`, machine.temp && `${machine.temp.value.toFixed(0)} °C`].filter(Boolean).join(' · ')
    return null
  }

  return (
    <section className="kz-page kz-page--r" aria-label="Obroty na rachunku">
      <Guilloche side="right" />
      <div className="kz-pad">
        <div className="kz-head">
          <span className="kz-pre">Obroty na rachunku {mount}</span>
          <span className="kz-pre kz-pre--n">{DAY.format(new Date())}</span>
        </div>

        <div className="kz-ledger-wrap" data-tour="reclaim">
          <table className="kz-table kz-ledger">
            <thead>
              <tr>
                <th className="kz-c-pos">Poz.</th>
                <th>Operacja · dowód</th>
                <th className="kz-c-mod">Moduł</th>
                <th className="n">Uznanie</th>
                <th className="n">Saldo</th>
                <th className="kz-c-sig">Podpis</th>
              </tr>
            </thead>
            <tbody>
              <tr className="kz-row kz-row--carry">
                <td className="kz-mx">—</td>
                <td>
                  <span className="kz-op">Saldo otwarcia</span>
                  <span className="kz-proof">wolne miejsce na {mount}, odczytane teraz</span>
                </td>
                <td />
                <td />
                <td className="n kz-mx">{free !== null ? gb(free) : '—'}</td>
                <td />
              </tr>

              {found.map((r, i) => {
                const mod = moduleById(r.id, linuxProfile)
                const name = mod?.name ?? r.id
                const style = { '--i': i } as CSSProperties
                if (r.error) {
                  return (
                    <tr key={r.id} className="kz-row kz-row--struck kz-row--new" style={style}>
                      <td className="kz-mx">{pos(i)}</td>
                      <td>
                        <span className="kz-op">{name}</span>
                        <span className="kz-proof">odczyt się nie udał: {r.error}</span>
                      </td>
                      <td className="kz-mx">{numbers.get(r.id)}</td>
                      <td className="n kz-mx">—</td>
                      <td className="n" />
                      <td>
                        <span className="kz-stamp kz-stamp--debit">odrzucone</span>
                      </td>
                    </tr>
                  )
                }
                running += r.bytes ?? 0
                const empty = !r.bytes
                return (
                  <tr key={r.id} className={`kz-row kz-row--new ${empty ? 'kz-row--done' : 'kz-row--pending'}`} style={style}>
                    <td className="kz-mx">{pos(i)}</td>
                    <td>
                      <button className="kz-op kz-op--link" onClick={() => open(r.id)}>
                        {name}
                      </button>
                      <span className="kz-proof">{empty ? 'nic do odzyskania' : 'do odzyskania · tylko odczyt, nic nie usunięto'}</span>
                    </td>
                    <td className="kz-mx">{numbers.get(r.id)}</td>
                    <td className="n kz-mx kz-credit">{size(r.bytes ?? 0)}</td>
                    <td className="n kz-mx">{free !== null ? gb(running) : '—'}</td>
                    <td>
                      {empty ? (
                        <span className="kz-proof">—</span>
                      ) : (
                        <button className="kz-sign" onClick={() => open(r.id)}>
                          do podpisu
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}

              {state.kind === 'done' && found.length === 0 && (
                <tr className="kz-row kz-row--done">
                  <td className="kz-mx">—</td>
                  <td colSpan={5}>
                    <span className="kz-op">Żaden moduł nie ma nic do odzyskania</span>
                  </td>
                </tr>
              )}

              {state.kind === 'done' && found.length > 0 && (
                <tr className="kz-row kz-row--total">
                  <td />
                  <td colSpan={2}>
                    <span className="kz-op">Razem do odzyskania</span>
                    <span className="kz-proof">prognoza: zakłada, że wszystko leży na {mount}</span>
                  </td>
                  <td className="n kz-mx kz-credit">{size(total)}</td>
                  <td className="n kz-mx">{free !== null ? gb(free + total) : '—'}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>

          {sources.length === 0 ? (
            <div className="kz-order">
              <div>
                <span className="kz-op">Brak włączonych modułów czyszczących</span>
                <span className="kz-proof">Dyspozycję sprawdzenia składają moduły z folderu 100 i 300.</span>
              </div>
              <button className="btn btn-ghost" onClick={() => setView({ kind: 'manager' })}>
                Włącz moduły — 901
              </button>
            </div>
          ) : state.kind === 'scanning' ? (
            <div className="kz-order kz-order--busy" role="status" aria-busy="true">
              <div>
                <span className="kz-op">Drukuję wyciąg…</span>
                <span className="kz-proof">
                  odpowiedziało {state.done} z {sources.length} modułów · tylko odczyt
                </span>
              </div>
              <span className="kz-head-run" aria-hidden="true">
                <i style={{ width: `${(state.done / sources.length) * 100}%` }} />
              </span>
            </div>
          ) : (
            <div className="kz-order">
              <div>
                <span className="kz-op">
                  {state.kind === 'done' ? 'Wyciąg wydrukowany' : 'Dyspozycja oczekująca: sprawdź, co da się odzyskać'}
                </span>
                <span className="kz-proof">
                  {sources.length} {sources.length === 1 ? 'moduł' : 'moduły'} · tylko odczyt — usuwasz zawsze w module, po jego
                  potwierdzeniu
                </span>
              </div>
              <button className={`btn ${state.kind === 'done' ? 'btn-ghost' : 'btn-primary'}`} onClick={check}>
                {state.kind === 'done' ? 'Sprawdź ponownie' : 'Złóż dyspozycję'}
                <span className="sr-only"> — sprawdź, co da się odzyskać</span>
              </button>
            </div>
          )}
        </div>

        <p className="kz-legend">
          <span className="kz-legend__line kz-legend__line--solid" aria-hidden="true" /> odczyt
          <span className="kz-legend__line kz-legend__line--dashed" aria-hidden="true" /> czeka na podpis w module
          <span className="kz-legend__line kz-legend__line--struck" aria-hidden="true" /> nie powiodło się
        </p>
        <p className="kz-proof kz-note">
          Książeczka nie przechowuje operacji z poprzednich uruchomień — widać tu to, co sprawdzisz teraz.
        </p>

        <section className="kz-index" data-tour="index" aria-labelledby="kz-index-title">
          <h2 id="kz-index-title" className="kz-lbl kz-index__title">
            Wzory dyspozycji
          </h2>
          {quick.length === 0 ? (
            <p className="kz-proof">Żaden włączony moduł nie ma gotowego wzoru. Moduły włączysz w 901.</p>
          ) : (
            <ul>
              {quick.map((m) => {
                const read = reading(m)
                return (
                  <li key={m.id}>
                    <button className="kz-idx" onClick={() => open(m.id)}>
                      <span className="kz-mx">{numbers.get(m.id)}</span>
                      <span className="kz-idx__name">
                        {m.quickAction}
                        <span className="kz-proof">{m.name}</span>
                      </span>
                      <span className="kz-idx__read kz-mx">{read ?? ''}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <footer className="kz-foot">
          <span className="kz-pageno">s. 2 · obroty</span>
        </footer>
      </div>
    </section>
  )
}
