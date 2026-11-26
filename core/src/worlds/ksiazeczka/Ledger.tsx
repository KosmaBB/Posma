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
import { locale, t } from '../../i18n'

const dayFormat = () => new Intl.DateTimeFormat(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })
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
    if (hit && hit.bytes !== null) return t('world.ksiazeczka.ledger.reclaimable', { size: size(hit.bytes) })
    if (m.id === 'disk-map' && machine.mainDisk) return t('world.ksiazeczka.ledger.map-reading', { mount, pct: usedPct(machine.mainDisk).toFixed(0) })
    if (m.id === 'health-monitor' && machine.cpu)
      return [t('world.ksiazeczka.ledger.cpu-reading', { pct: machine.cpu.value.toFixed(0) }), machine.temp && `${machine.temp.value.toFixed(0)} °C`].filter(Boolean).join(' · ')
    return null
  }

  return (
    <section className="kz-page kz-page--r" aria-label={t('world.ksiazeczka.ledger.aria')}>
      <Guilloche side="right" />
      <div className="kz-pad">
        <div className="kz-head">
          <span className="kz-pre">{t('world.ksiazeczka.ledger.head', { mount })}</span>
          <span className="kz-pre kz-pre--n">{dayFormat().format(new Date())}</span>
        </div>

        <div className="kz-ledger-wrap" data-tour="reclaim">
          <table className="kz-table kz-ledger">
            <thead>
              <tr>
                <th className="kz-c-pos">{t('world.ksiazeczka.ledger.col.pos')}</th>
                <th>{t('world.ksiazeczka.ledger.col.operation')}</th>
                <th className="kz-c-mod">{t('world.ksiazeczka.ledger.col.module')}</th>
                <th className="n">{t('world.ksiazeczka.ledger.col.credit')}</th>
                <th className="n">{t('world.ksiazeczka.ledger.col.balance')}</th>
                <th className="kz-c-sig">{t('world.ksiazeczka.ledger.col.signature')}</th>
              </tr>
            </thead>
            <tbody>
              <tr className="kz-row kz-row--carry">
                <td className="kz-mx">—</td>
                <td>
                  <span className="kz-op">{t('world.ksiazeczka.ledger.opening')}</span>
                  <span className="kz-proof">{t('world.ksiazeczka.ledger.opening-proof', { mount })}</span>
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
                        <span className="kz-proof">{t('world.ksiazeczka.ledger.failed', { error: r.error })}</span>
                      </td>
                      <td className="kz-mx">{numbers.get(r.id)}</td>
                      <td className="n kz-mx">—</td>
                      <td className="n" />
                      <td>
                        <span className="kz-stamp kz-stamp--debit">{t('world.ksiazeczka.ledger.rejected')}</span>
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
                      <span className="kz-proof">{t(empty ? 'world.ksiazeczka.ledger.empty' : 'world.ksiazeczka.ledger.pending')}</span>
                    </td>
                    <td className="kz-mx">{numbers.get(r.id)}</td>
                    <td className="n kz-mx kz-credit">{size(r.bytes ?? 0)}</td>
                    <td className="n kz-mx">{free !== null ? gb(running) : '—'}</td>
                    <td>
                      {empty ? (
                        <span className="kz-proof">—</span>
                      ) : (
                        <button className="kz-sign" onClick={() => open(r.id)}>
                          {t('world.ksiazeczka.ledger.to-sign')}
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
                    <span className="kz-op">{t('world.ksiazeczka.ledger.none-found')}</span>
                  </td>
                </tr>
              )}

              {state.kind === 'done' && found.length > 0 && (
                <tr className="kz-row kz-row--total">
                  <td />
                  <td colSpan={2}>
                    <span className="kz-op">{t('world.ksiazeczka.ledger.total')}</span>
                    <span className="kz-proof">{t('world.ksiazeczka.ledger.total-proof', { mount })}</span>
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
                <span className="kz-op">{t('world.ksiazeczka.ledger.no-cleaners')}</span>
                <span className="kz-proof">{t('world.ksiazeczka.ledger.no-cleaners-proof')}</span>
              </div>
              <button className="btn btn-ghost" onClick={() => setView({ kind: 'manager' })}>
                {t('world.ksiazeczka.ledger.enable')}
              </button>
            </div>
          ) : state.kind === 'scanning' ? (
            <div className="kz-order kz-order--busy" role="status" aria-busy="true">
              <div>
                <span className="kz-op">{t('world.ksiazeczka.ledger.printing')}</span>
                <span className="kz-proof">
                  {t('world.ksiazeczka.ledger.answered', { done: state.done, n: sources.length })}
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
                  {t(state.kind === 'done' ? 'world.ksiazeczka.ledger.printed' : 'world.ksiazeczka.ledger.order-pending')}
                </span>
                <span className="kz-proof">
                  {t('world.ksiazeczka.ledger.read-only', { n: sources.length })}
                </span>
              </div>
              <button className={`btn ${state.kind === 'done' ? 'btn-ghost' : 'btn-primary'}`} onClick={check}>
                {t(state.kind === 'done' ? 'world.ksiazeczka.ledger.recheck' : 'world.ksiazeczka.ledger.place-order')}
                <span className="sr-only"> — {t('world.ksiazeczka.ledger.sr-check')}</span>
              </button>
            </div>
          )}
        </div>

        <p className="kz-legend">
          <span className="kz-legend__line kz-legend__line--solid" aria-hidden="true" /> {t('world.ksiazeczka.ledger.legend.read')}
          <span className="kz-legend__line kz-legend__line--dashed" aria-hidden="true" /> {t('world.ksiazeczka.ledger.legend.waits')}
          <span className="kz-legend__line kz-legend__line--struck" aria-hidden="true" /> {t('world.ksiazeczka.ledger.legend.failed')}
        </p>
        <p className="kz-proof kz-note">
          {t('world.ksiazeczka.ledger.note')}
        </p>

        <section className="kz-index" data-tour="index" aria-labelledby="kz-index-title">
          <h2 id="kz-index-title" className="kz-lbl kz-index__title">
            {t('world.ksiazeczka.ledger.templates')}
          </h2>
          {quick.length === 0 ? (
            <p className="kz-proof">{t('world.ksiazeczka.ledger.templates-empty')}</p>
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
          <span className="kz-pageno">{t('world.ksiazeczka.ledger.page')}</span>
        </footer>
      </div>
    </section>
  )
}
