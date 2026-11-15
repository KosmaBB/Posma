import type { ShellProps } from '../index'
import { orderedModules, moduleById } from '../../data/modules'
import { DISK_WARN_PCT, fill, plural, size, systemName, useMachine, usedPct, useReclaim } from '../../state/machine'

/**
 * The home screen: live readings, the read-only reclaim check and the main
 * action of every switched-on module. Show only what the machine reported —
 * a missing reading stays missing, never a made-up number.
 */
export function Home({ app, settings }: ShellProps) {
  const { error, cpu, ram, temp, disks, coreCount } = useMachine(settings.settings.refreshMs)
  const { reclaim, sources, check, found, total } = useReclaim(app)
  const { onboarding, moduleOrder, linuxProfile, installedSet, setView } = app
  const quick = orderedModules(onboarding?.os, moduleOrder, linuxProfile).filter((m) => installedSet.has(m.id) && m.quickAction)

  return (
    <div className="st-home">
      <section className="st-card" data-tour="cpu">
        <h2>Procesor</h2>
        <p className="st-big">{cpu ? `${cpu.value.toFixed(0)} %` : '—'}</p>
        <p className="st-sub">
          {coreCount} {plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}
          {temp && ` · ${temp.value.toFixed(0)} °C`}
        </p>
      </section>

      <section className="st-card" data-tour="machine">
        <h2>Ten komputer</h2>
        {error && <p className="st-warn">Brak odczytu: {error}</p>}
        <dl className="st-facts">
          <dt>System</dt>
          <dd>{systemName(app)}</dd>
          {ram && (
            <>
              <dt>Pamięć</dt>
              <dd>{ram.detail ?? `${ram.value.toFixed(0)} %`}</dd>
            </>
          )}
          {disks.map((d) => (
            <div key={d.mount_point} className="st-facts__row">
              <dt>{d.mount_point}</dt>
              <dd className={usedPct(d) >= DISK_WARN_PCT ? 'st-warn' : undefined}>{fill(d)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="st-card" data-tour="reclaim">
        <h2>Do odzyskania</h2>
        {reclaim.kind === 'idle' && (
          <p className="st-sub">
            {sources.length} {plural(sources.length, 'moduł policzy', 'moduły policzą', 'modułów policzy')}, ile miejsca zwolnią. To tylko odczyt.
          </p>
        )}
        {reclaim.kind === 'scanning' && <p className="st-sub" aria-live="polite">Sprawdzam… {reclaim.done} z {sources.length}</p>}
        {reclaim.kind === 'done' && (
          <>
            <p className="st-big">{size(total)}</p>
            <ul className="st-found">
              {found.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setView({ kind: 'module', moduleId: r.id })}>{moduleById(r.id, linuxProfile)?.name ?? r.id}</button>
                  <span>{r.error ? 'nie udało się sprawdzić' : size(r.bytes ?? 0)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="btn btn-primary" onClick={check} disabled={reclaim.kind === 'scanning' || sources.length === 0}>
          {reclaim.kind === 'done' ? 'Sprawdź ponownie' : 'Sprawdź, co da się odzyskać'}
        </button>
      </section>

      <section className="st-card st-card--wide" data-tour="index">
        <h2>Szybkie akcje</h2>
        <ul className="st-quick">
          {quick.map((m) => (
            <li key={m.id}>
              <button onClick={() => setView({ kind: 'module', moduleId: m.id })}>{m.quickAction}</button>
              <span>{m.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
