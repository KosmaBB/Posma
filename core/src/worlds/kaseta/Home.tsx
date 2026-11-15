import { Fragment, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../../state/appState'
import type { SettingsState } from '../../state/settings'
import { catalogNumbers, type ModuleDef } from '../../data/modules'
import { CpuProfile } from '../../components/CpuProfile'
import {
  DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, plural, size, systemName, usedPct,
  type DiskInfo, type Machine, type ReclaimState,
} from '../../state/machine'
import { Band, Key, SideBox, Underline } from './parts'

const DAY = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'numeric' })
const CLOCK = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const NBSP = ' '

/** "43,0" — gb() without its unit, for "used / total" pairs. */
const bare = (bytes: number) => gb(bytes).replace(' GB', '')

interface HomeProps {
  app: AppState
  settings: SettingsState
  machine: Machine
  reclaim: ReclaimState
}

/** Free space on the main disk as counter drums that roll to each new reading. */
function Counter({ bytes }: { bytes: number | null }) {
  const [whole, tenth] = bytes === null ? ['---', '-'] : (bytes / 1024 ** 3).toFixed(1).split('.')
  const digits = [...whole.padStart(3, '0'), ',', tenth]
  return (
    <span className="ks-drums" role="img" aria-label={bytes === null ? 'Brak odczytu' : `${gb(bytes)} wolnego`}>
      {digits.map((d, i) =>
        d === ',' ? (
          <span key={i} className="ks-drums__sep">,</span>
        ) : (
          <span key={i} className="ks-drum">
            {/^\d$/.test(d) ? (
              <span className="ks-drum__reel" style={{ '--n': Number(d) } as React.CSSProperties}>
                {'0123456789'.split('').map((c) => (
                  <span key={c}>{c}</span>
                ))}
              </span>
            ) : (
              <span className="ks-drum__dash">–</span>
            )}
          </span>
        ),
      )}
      <span className="ks-drums__unit">GB</span>
    </span>
  )
}

interface MachineTrack {
  key: string
  name: string
  path?: string
  value: string
  warn?: boolean
  title?: string
}

function diskTrack(d: DiskInfo, main: boolean): MachineTrack {
  const pct = usedPct(d)
  const model = [d.solid_state === undefined ? null : d.solid_state ? 'SSD' : 'HDD', d.model].filter(Boolean).join(' · ')
  return {
    key: d.mount_point,
    name: main ? 'Dysk systemowy' : 'Dysk',
    path: d.mount_point,
    value: main ? `${bare(d.total_bytes - d.available_bytes)} / ${gb(d.total_bytes)}` : `${pct.toFixed(0)}${NBSP}%`,
    warn: pct >= DISK_WARN_PCT,
    title: [model, `${gb(d.available_bytes)} wolnego z ${gb(d.total_bytes)}`].filter(Boolean).join(' · '),
  }
}

export function Home({ app, settings, machine, reclaim }: HomeProps) {
  const { setView, onboarding, installedSet, linuxProfile } = app
  const os = onboarding?.os
  const refreshMs = settings.settings.refreshMs
  const { info, error, record, disks, cpu, ram, temp, mainDisk, anyCrowded, coreCount } = machine
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const enabled = [...numbers.keys()].filter((id) => installedSet.has(id)).length

  // Each turn of the cassette remounts the fold, so the turn plays once per press and never at load.
  const [turns, setTurns] = useState(0)
  const flipped = turns % 2 === 1

  // When the last reading landed, for the "nagrano" field.
  const [readAt, setReadAt] = useState<Date | null>(null)
  useEffect(() => {
    if (info) setReadAt(new Date())
  }, [info])

  const system = systemName(app)
  const title = system.split(' · ')[0]
  const watchedNow = settings.settings.watchedCores.filter((c) => c < coreCount)
  const seconds = Math.round((HISTORY * refreshMs) / 1000)

  // ------------------------------------------------------------ side A
  const { sources, check, foundOf, total } = reclaim
  const state = reclaim.reclaim
  const used = mainDisk ? mainDisk.total_bytes - mainDisk.available_bytes : 0
  // The side is the main disk's tape: what the check finds is drawn inside what is
  // recorded on it, so the hatch can never run past the end of the tape.
  const freed = state.kind === 'done' ? Math.min(total, used) : 0
  const tapePct = (bytes: number) => (mainDisk && mainDisk.total_bytes > 0 ? (bytes / mainDisk.total_bytes) * 100 : 0)

  function trackTime(m: ModuleDef): { text: string; pencil: boolean; title?: string; failed?: boolean } {
    if (state.kind === 'idle') return { text: 'nie sprawdzono', pencil: true }
    if (state.kind === 'scanning') return { text: 'sprawdzam…', pencil: true }
    const hit = foundOf(m.id)
    if (!hit) return { text: 'nic tu nie ma', pencil: true }
    if (hit.error) return { text: 'nie odczytano', pencil: true, title: hit.error, failed: true }
    return { text: size(hit.bytes ?? 0), pencil: false }
  }

  // ------------------------------------------------------------ side B
  const tracks: MachineTrack[] = []
  if (cpu) {
    tracks.push({
      key: 'cpu',
      name: coreCount ? `Procesor · ${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}` : 'Procesor',
      value: `${cpu.value.toFixed(0)}${NBSP}%`,
    })
  }
  if (ram) tracks.push({ key: 'ram', name: 'Pamięć', value: ram.detail ?? `${ram.value.toFixed(0)}${NBSP}%` })
  if (mainDisk) tracks.push(diskTrack(mainDisk, true))
  for (const d of disks) if (d !== mainDisk) tracks.push(diskTrack(d, false))
  if (temp) tracks.push({ key: 'temp', name: 'Temperatura', value: `${temp.value.toFixed(0)}${NBSP}°C` })

  const diskMapNo = numbers.get('disk-map')
  const canOpenMap = installedSet.has('disk-map')

  const sideA = (
    <section className="ks-side ks-side--a" data-tour="reclaim" aria-labelledby="ks-side-a">
      <div className="ks-side__head">
        <SideBox side="A" />
        <span className="ks-printed">Strona A</span>
      </div>
      <h2 className="ks-side__title" id="ks-side-a">
        Do odzyskania
        <Underline />
      </h2>
      {mainDisk ? (
        <div className="ks-tape">
          <div className="ks-tape__lbl">
            <span className="ks-printed">
              Taśma · dysk {mainDisk.mount_point} · {gb(mainDisk.total_bytes)}
            </span>
            <span className="ks-typed">{state.kind === 'done' ? `${bare(used)} → ${gb(used - freed)}` : gb(used)}</span>
          </div>
          <div className="ks-tape__track" aria-hidden="true">
            <span className="ks-tape__used" style={{ width: `${tapePct(used - freed)}%` }} />
            {freed > 0 && <span className="ks-tape__freed" style={{ left: `${tapePct(used - freed)}%`, width: `${tapePct(freed)}%` }} />}
            <span className="ks-tape__end" style={{ left: `${tapePct(used)}%` }} />
          </div>
        </div>
      ) : (
        <p className="ks-pencil ks-tape__none">{error ? 'Bez odczytu dysku nie ma długości taśmy.' : 'Czekam na odczyt dysku…'}</p>
      )}

      {sources.length > 0 ? (
        <ol className="ks-tracks">
          {sources.map((m) => {
            const t = trackTime(m)
            const ok = state.kind === 'done' && !t.pencil
            return (
              <li key={m.id}>
                <button type="button" className="ks-track" title={t.title} onClick={() => setView({ kind: 'module', moduleId: m.id })}>
                  <span className="ks-track__no">{numbers.get(m.id)}</span>
                  <span className={`ks-tick${ok ? ' on' : ''}`} aria-hidden="true" />
                  <span className="ks-track__name">{m.name}</span>
                  <span className={t.pencil ? `ks-track__note${t.failed ? ' failed' : ''}` : 'ks-track__time'}>{t.text}</span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="ks-side__empty">
          <p className="ks-pencil">Żaden włączony moduł nie zwalnia miejsca na dysku.</p>
          <button type="button" className="btn btn-ghost btn-mini" onClick={() => setView({ kind: 'manager' })}>
            Zarządzanie modułami
          </button>
        </div>
      )}

      {sources.length > 0 && (
        <div className="ks-total">
          <span className="ks-printed">
            {state.kind === 'idle' && 'Razem · jeszcze nic nie sprawdzone'}
            {state.kind === 'scanning' && `Sprawdzam · ${state.done} z ${sources.length}`}
            {state.kind === 'done' && `Razem · ${sources.length} ${plural(sources.length, 'moduł sprawdzony', 'moduły sprawdzone', 'modułów sprawdzonych')}`}
          </span>
          {state.kind === 'done' && <span className="ks-total__sum">{size(total)}</span>}
        </div>
      )}
      <p className="ks-margin">
        {state.kind === 'done'
          ? `taśma to dysk ${mainDisk?.mount_point ?? '/'} — kreskowanie to miejsce, które zwolnią moduły`
          : 'ołówkiem = jeszcze nie sprawdzone; klawisz pod kasetą zapyta resztę'}
      </p>
    </section>
  )

  const sideB = (
    <section className="ks-side ks-side--b" data-tour="machine" aria-labelledby="ks-side-b">
      <div className="ks-side__head">
        <SideBox side="B" />
        <span className="ks-printed">Strona B</span>
      </div>
      <h2 className="ks-side__title" id="ks-side-b">
        Stan maszyny
        <Underline />
      </h2>
      <div className="ks-tape__lbl ks-side__sub">
        <span className="ks-printed">Odczyt co {UP_TO_ONE.format(refreshMs / 1000)} s · na żywo</span>
        <span className="ks-typed">{readAt ? CLOCK.format(readAt) : '—'}</span>
      </div>
      {tracks.length > 0 ? (
        <ol className="ks-tracks">
          {tracks.map((t, i) => (
            <li key={t.key} className="ks-track ks-track--static" title={t.title}>
              <span className="ks-track__no">{String(i + 1).padStart(2, '0')}</span>
              <span className="ks-track__name">
                {t.name}
                {t.path && (
                  <span className="ks-track__path">
                    {/* Lines break after a slash, so a path is never cut inside a folder name. */}
                    {t.path.split('/').map((seg, i) => (
                      <Fragment key={i}>
                        {i > 0 && (
                          <>
                            /<wbr />
                          </>
                        )}
                        {seg}
                      </Fragment>
                    ))}
                  </span>
                )}
              </span>
              <span className={`ks-track__time${t.warn ? ' ks-ring' : ''}`}>{t.value}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ks-pencil ks-side__wait">
          {error ? 'Nie udało się odczytać stanu maszyny — moduł system-info nie odpowiada.' : 'Czekam na pierwszy odczyt…'}
        </p>
      )}
      <div className="ks-total">
        <span className="ks-printed">
          {mainDisk ? `Wolne na ${mainDisk.mount_point} · ${gb(mainDisk.available_bytes)}` : 'Wolne · —'}
        </span>
        {disks.length > 0 && (
          <span className="ks-total__sum ks-total__sum--small">
            {disks.length} {plural(disks.length, 'zamontowany', 'zamontowane', 'zamontowanych')}
          </span>
        )}
      </div>
      {anyCrowded &&
        (canOpenMap ? (
          <button type="button" className="ks-margin ks-margin--link" onClick={() => setView({ kind: 'module', moduleId: 'disk-map' })}>
            prawie pełny dysk — mapa dysków ({diskMapNo}) pokaże, co zajmuje miejsce
          </button>
        ) : (
          <p className="ks-margin">prawie pełny dysk — mapa dysków pokaże, co zajmuje miejsce, gdy ją włączysz</p>
        ))}
    </section>
  )

  return (
    <div className="ks-home">
      <article className="ks-jcard">
        {/* ------------------------------------------------ cover */}
        <section className="ks-cover" aria-label="Okładka">
          <Band />
          <div className="ks-cover__pad">
            <h1 className="ks-cover__title">
              <span className="ks-cover__big">{title}</span>
              <span className="ks-cover__sub">mix na {DAY.format(readAt ?? new Date())}</span>
            </h1>
          </div>
          <div className="ks-art" data-tour="cpu">
            <span className="ks-printed ks-art__cap">
              Procesor · ostatnie {seconds} s{coreCount > 0 && ` · ${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}`}
            </span>
            {record.samples.length > 1 ? (
              <CpuProfile
                samples={record.samples}
                capacity={HISTORY}
                tick={record.tick}
                intervalMs={refreshMs}
                watched={settings.settings.watchedCores}
                onWatch={(cores) => settings.set('watchedCores', cores)}
              />
            ) : (
              <div className="cpu-box cpu-box--wait" role="status">
                {error
                  ? 'Nie udało się odczytać stanu maszyny — moduł system-info nie odpowiada.'
                  : 'Linia potrzebuje dwóch odczytów — czekam na kolejny…'}
              </div>
            )}
          </div>
          {watchedNow.length > 0 && (
            <div className="ks-watch">
              <span className="ks-printed">Obserwujesz</span>
              <span className="ks-typed">{watchedNow.map((c) => String(c).padStart(2, '0')).join(' · ')}</span>
              <button type="button" className="btn btn-ghost btn-mini" onClick={() => settings.set('watchedCores', [])}>
                Wyczyść
              </button>
            </div>
          )}
          <dl className="ks-caps">
            <div>
              <dt className="ks-printed">Procesor</dt>
              <dd>{cpu ? `${cpu.value.toFixed(0)}${NBSP}%` : '—'}</dd>
            </div>
            <div>
              <dt className="ks-printed">Pamięć</dt>
              <dd>{ram ? (ram.detail ?? `${ram.value.toFixed(0)}${NBSP}%`) : '—'}</dd>
            </div>
            <div>
              <dt className="ks-printed">Temperatura</dt>
              <dd>{temp ? `${temp.value.toFixed(0)}${NBSP}°C` : '—'}</dd>
            </div>
          </dl>
          <dl className="ks-fields">
            <div>
              <dt className="ks-printed">Nagrano</dt>
              <dd>{readAt ? `${DAY.format(readAt)} · ${CLOCK.format(readAt).slice(0, 5)}` : '—'}</dd>
            </div>
            <div>
              <dt className="ks-printed">Źródło</dt>
              <dd>{system}</dd>
            </div>
            <div>
              <dt className="ks-printed">Dostęp</dt>
              <dd>{onboarding?.accessLevel === 'full' ? 'pełny' : 'wybiórczy'}</dd>
            </div>
            <div>
              <dt className="ks-printed">Moduły</dt>
              <dd>
                {enabled} z {numbers.size} {plural(numbers.size, 'włączony', 'włączonych', 'włączonych')}
              </dd>
            </div>
          </dl>
        </section>

        {/* ------------------------------------------------ spine */}
        <div className="ks-jspine" aria-hidden="true">
          <Band />
          <span className="ks-jspine__title">
            {title} · mix na {DAY.format(readAt ?? new Date())}
          </span>
          <span className="ks-jspine__no">000</span>
        </div>

        {/* ------------------------------------------------ inner fold */}
        <div className={`ks-fold${turns > 0 ? ' ks-fold--turned' : ''}`} key={turns} data-flipped={flipped}>
          {flipped ? sideB : sideA}
          {flipped ? sideA : sideB}
        </div>
      </article>

      {/* -------------------------------------------------- deck */}
      <div className="ks-deck">
        <div className="ks-counter">
          <span className="ks-printed">Licznik · wolne na {mainDisk?.mount_point ?? '/'}</span>
          <Counter bytes={mainDisk ? mainDisk.available_bytes : null} />
          <span className="ks-counter__after">
            {state.kind === 'done' && mainDisk
              ? `po odzyskaniu → ${gb(mainDisk.available_bytes + freed)}`
              : mainDisk
                ? `z ${gb(mainDisk.total_bytes)}`
                : ' '}
          </span>
        </div>
        <div className="ks-keys" data-tour="reclaim">
          {sources.length > 0 ? (
            <Key
              primary
              icon={state.kind === 'done' ? 'rescan' : 'play'}
              label={state.kind === 'scanning' ? 'Sprawdzam' : state.kind === 'done' ? 'Sprawdź ponownie' : 'Sprawdź, co da się odzyskać'}
              sub={
                state.kind === 'scanning'
                  ? `${state.done} z ${sources.length} ${plural(sources.length, 'modułu', 'modułów', 'modułów')}`
                  : 'pyta wszystkie moduły · tylko odczyt'
              }
              lamp={state.kind === 'scanning' ? 'busy' : state.kind === 'done' ? 'on' : undefined}
              disabled={state.kind === 'scanning'}
              onClick={check}
            />
          ) : (
            <Key icon="eject" label="Zarządzanie modułami" sub="włącz moduł, który sprząta" onClick={() => setView({ kind: 'manager' })} />
          )}
          <Key
            icon="flip"
            label="Obróć"
            sub={flipped ? 'strona A na wierzch' : 'strona B na wierzch'}
            aria-pressed={flipped}
            onClick={() => setTurns((n) => n + 1)}
          />
        </div>
        <p className="ks-pen ks-deck__note">nic nie znika, dopóki nie wciśniesz klawisza w module</p>
      </div>
    </div>
  )
}
