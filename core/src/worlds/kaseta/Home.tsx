import { Fragment, useEffect, useMemo, useState } from 'react'
import type { AppState } from '../../state/appState'
import type { SettingsState } from '../../state/settings'
import { catalogNumbers, type ModuleDef } from '../../data/modules'
import { CpuProfile } from '../../components/CpuProfile'
import {
  DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, size, systemName, usedPct,
  type DiskInfo, type Machine, type ReclaimState,
} from '../../state/machine'
import { Band, Key, SideBox, Underline } from './parts'
import { locale, t } from '../../i18n'

const dayFormat = () => new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'numeric' })
const clockFormat = () => new Intl.DateTimeFormat(locale(), { hour: '2-digit', minute: '2-digit', second: '2-digit' })
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
    <span className="ks-drums" role="img" aria-label={bytes === null ? t('world.kaseta.counter.none') : t('world.kaseta.counter.free', { size: gb(bytes) })}>
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
    name: main ? t('world.kaseta.track.disk-system') : t('world.kaseta.track.disk'),
    path: d.mount_point,
    value: main ? `${bare(d.total_bytes - d.available_bytes)} / ${gb(d.total_bytes)}` : `${pct.toFixed(0)}${NBSP}%`,
    warn: pct >= DISK_WARN_PCT,
    title: [model, t('world.kaseta.track.disk-free', { free: gb(d.available_bytes), total: gb(d.total_bytes) })].filter(Boolean).join(' · '),
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
    if (state.kind === 'idle') return { text: t('world.kaseta.track.not-checked'), pencil: true }
    if (state.kind === 'scanning') return { text: t('world.kaseta.track.checking'), pencil: true }
    const hit = foundOf(m.id)
    if (!hit) return { text: t('world.kaseta.track.nothing'), pencil: true }
    if (hit.error) return { text: t('world.kaseta.track.not-read'), pencil: true, title: hit.error, failed: true }
    return { text: size(hit.bytes ?? 0), pencil: false }
  }

  // ------------------------------------------------------------ side B
  const tracks: MachineTrack[] = []
  if (cpu) {
    tracks.push({
      key: 'cpu',
      name: coreCount ? t('world.kaseta.cpu.title-cores', { cores: t('world.kaseta.cpu.cores', { n: coreCount }) }) : t('world.kaseta.cpu'),
      value: `${cpu.value.toFixed(0)}${NBSP}%`,
    })
  }
  if (ram) tracks.push({ key: 'ram', name: t('world.kaseta.memory'), value: ram.detail ?? `${ram.value.toFixed(0)}${NBSP}%` })
  if (mainDisk) tracks.push(diskTrack(mainDisk, true))
  for (const d of disks) if (d !== mainDisk) tracks.push(diskTrack(d, false))
  if (temp) tracks.push({ key: 'temp', name: t('world.kaseta.temperature'), value: `${temp.value.toFixed(0)}${NBSP}°C` })

  const diskMapNo = numbers.get('disk-map')
  const canOpenMap = installedSet.has('disk-map')

  const sideA = (
    <section className="ks-side ks-side--a" data-tour="reclaim" aria-labelledby="ks-side-a">
      <div className="ks-side__head">
        <SideBox side="A" />
        <span className="ks-printed">{t('world.kaseta.side-a.name')}</span>
      </div>
      <h2 className="ks-side__title" id="ks-side-a">
        {t('world.kaseta.side-a.title')}
        <Underline />
      </h2>
      {mainDisk ? (
        <div className="ks-tape">
          <div className="ks-tape__lbl">
            <span className="ks-printed">
              {t('world.kaseta.tape.label', { mount: mainDisk.mount_point, size: gb(mainDisk.total_bytes) })}
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
        <p className="ks-pencil ks-tape__none">{t(error ? 'world.kaseta.tape.error' : 'world.kaseta.tape.waiting')}</p>
      )}

      {sources.length > 0 ? (
        <ol className="ks-tracks">
          {sources.map((m) => {
            const tr = trackTime(m)
            const ok = state.kind === 'done' && !tr.pencil
            return (
              <li key={m.id}>
                <button type="button" className="ks-track" title={tr.title} onClick={() => setView({ kind: 'module', moduleId: m.id })}>
                  <span className="ks-track__no">{numbers.get(m.id)}</span>
                  <span className={`ks-tick${ok ? ' on' : ''}`} aria-hidden="true" />
                  <span className="ks-track__name">{m.name}</span>
                  <span className={tr.pencil ? `ks-track__note${tr.failed ? ' failed' : ''}` : 'ks-track__time'}>{tr.text}</span>
                </button>
              </li>
            )
          })}
        </ol>
      ) : (
        <div className="ks-side__empty">
          <p className="ks-pencil">{t('world.kaseta.side-a.empty')}</p>
          <button type="button" className="btn btn-ghost btn-mini" onClick={() => setView({ kind: 'manager' })}>
            {t('page.manager')}
          </button>
        </div>
      )}

      {sources.length > 0 && (
        <div className="ks-total">
          <span className="ks-printed">
            {state.kind === 'idle' && t('world.kaseta.total.idle')}
            {state.kind === 'scanning' && t('world.kaseta.total.scanning', { done: state.done, n: sources.length })}
            {state.kind === 'done' && t('world.kaseta.total.done', { n: sources.length })}
          </span>
          {state.kind === 'done' && <span className="ks-total__sum">{size(total)}</span>}
        </div>
      )}
      <p className="ks-margin">
        {state.kind === 'done'
          ? t('world.kaseta.margin.done', { mount: mainDisk?.mount_point ?? '/' })
          : t('world.kaseta.margin.idle')}
      </p>
    </section>
  )

  const sideB = (
    <section className="ks-side ks-side--b" data-tour="machine" aria-labelledby="ks-side-b">
      <div className="ks-side__head">
        <SideBox side="B" />
        <span className="ks-printed">{t('world.kaseta.side-b.name')}</span>
      </div>
      <h2 className="ks-side__title" id="ks-side-b">
        {t('world.kaseta.side-b.title')}
        <Underline />
      </h2>
      <div className="ks-tape__lbl ks-side__sub">
        <span className="ks-printed">{t('world.kaseta.side-b.live', { s: UP_TO_ONE.format(refreshMs / 1000) })}</span>
        <span className="ks-typed">{readAt ? clockFormat().format(readAt) : '—'}</span>
      </div>
      {tracks.length > 0 ? (
        <ol className="ks-tracks">
          {tracks.map((tk, i) => (
            <li key={tk.key} className="ks-track ks-track--static" title={tk.title}>
              <span className="ks-track__no">{String(i + 1).padStart(2, '0')}</span>
              <span className="ks-track__name">
                {tk.name}
                {tk.path && (
                  <span className="ks-track__path">
                    {/* Lines break after a slash, so a path is never cut inside a folder name. */}
                    {tk.path.split('/').map((seg, i) => (
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
              <span className={`ks-track__time${tk.warn ? ' ks-ring' : ''}`}>{tk.value}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="ks-pencil ks-side__wait">
          {t(error ? 'world.kaseta.side-b.error' : 'world.kaseta.side-b.waiting')}
        </p>
      )}
      <div className="ks-total">
        <span className="ks-printed">
          {mainDisk ? t('world.kaseta.free.on', { mount: mainDisk.mount_point, size: gb(mainDisk.available_bytes) }) : t('world.kaseta.free.none')}
        </span>
        {disks.length > 0 && (
          <span className="ks-total__sum ks-total__sum--small">
            {t('world.kaseta.mounted', { n: disks.length })}
          </span>
        )}
      </div>
      {anyCrowded &&
        (canOpenMap ? (
          <button type="button" className="ks-margin ks-margin--link" onClick={() => setView({ kind: 'module', moduleId: 'disk-map' })}>
            {t('world.kaseta.crowded.link', { no: diskMapNo ?? '' })}
          </button>
        ) : (
          <p className="ks-margin">{t('world.kaseta.crowded.off')}</p>
        ))}
    </section>
  )

  return (
    <div className="ks-home">
      <article className="ks-jcard">
        {/* ------------------------------------------------ cover */}
        <section className="ks-cover" aria-label={t('world.kaseta.cover.aria')}>
          <Band />
          <div className="ks-cover__pad">
            <h1 className="ks-cover__title">
              <span className="ks-cover__big">{title}</span>
              <span className="ks-cover__sub">{t('world.kaseta.cover.mix', { date: dayFormat().format(readAt ?? new Date()) })}</span>
            </h1>
          </div>
          <div className="ks-art" data-tour="cpu">
            <span className="ks-printed ks-art__cap">
              {t('world.kaseta.cover.cap', { seconds })}
              {coreCount > 0 && ` · ${t('world.kaseta.cpu.cores', { n: coreCount })}`}
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
                {t(error ? 'world.kaseta.side-b.error' : 'world.kaseta.cover.wait')}
              </div>
            )}
          </div>
          {watchedNow.length > 0 && (
            <div className="ks-watch">
              <span className="ks-printed">{t('world.kaseta.watch.label')}</span>
              <span className="ks-typed">{watchedNow.map((c) => String(c).padStart(2, '0')).join(' · ')}</span>
              <button type="button" className="btn btn-ghost btn-mini" onClick={() => settings.set('watchedCores', [])}>
                {t('world.kaseta.watch.clear')}
              </button>
            </div>
          )}
          <dl className="ks-caps">
            <div>
              <dt className="ks-printed">{t('world.kaseta.cpu')}</dt>
              <dd>{cpu ? `${cpu.value.toFixed(0)}${NBSP}%` : '—'}</dd>
            </div>
            <div>
              <dt className="ks-printed">{t('world.kaseta.memory')}</dt>
              <dd>{ram ? (ram.detail ?? `${ram.value.toFixed(0)}${NBSP}%`) : '—'}</dd>
            </div>
            <div>
              <dt className="ks-printed">{t('world.kaseta.temperature')}</dt>
              <dd>{temp ? `${temp.value.toFixed(0)}${NBSP}°C` : '—'}</dd>
            </div>
          </dl>
          <dl className="ks-fields">
            <div>
              <dt className="ks-printed">{t('world.kaseta.field.recorded')}</dt>
              <dd>{readAt ? `${dayFormat().format(readAt)} · ${clockFormat().format(readAt).slice(0, 5)}` : '—'}</dd>
            </div>
            <div>
              <dt className="ks-printed">{t('world.kaseta.field.source')}</dt>
              <dd>{system}</dd>
            </div>
            <div>
              <dt className="ks-printed">{t('world.kaseta.field.access')}</dt>
              <dd>{t(onboarding?.accessLevel === 'full' ? 'world.kaseta.access.full' : 'world.kaseta.access.selective')}</dd>
            </div>
            <div>
              <dt className="ks-printed">{t('world.kaseta.field.modules')}</dt>
              <dd>{t('world.kaseta.modules.enabled', { on: enabled, n: numbers.size })}</dd>
            </div>
          </dl>
        </section>

        {/* ------------------------------------------------ spine */}
        <div className="ks-jspine" aria-hidden="true">
          <Band />
          <span className="ks-jspine__title">
            {title} · {t('world.kaseta.cover.mix', { date: dayFormat().format(readAt ?? new Date()) })}
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
          <span className="ks-printed">{t('world.kaseta.counter.label', { mount: mainDisk?.mount_point ?? '/' })}</span>
          <Counter bytes={mainDisk ? mainDisk.available_bytes : null} />
          <span className="ks-counter__after">
            {state.kind === 'done' && mainDisk
              ? t('world.kaseta.counter.after', { size: gb(mainDisk.available_bytes + freed) })
              : mainDisk
                ? t('world.kaseta.counter.of', { size: gb(mainDisk.total_bytes) })
                : ' '}
          </span>
        </div>
        <div className="ks-keys" data-tour="reclaim">
          {sources.length > 0 ? (
            <Key
              primary
              icon={state.kind === 'done' ? 'rescan' : 'play'}
              label={t(state.kind === 'scanning' ? 'world.kaseta.key.checking' : state.kind === 'done' ? 'world.kaseta.key.recheck' : 'world.kaseta.key.check')}
              sub={
                state.kind === 'scanning'
                  ? t('world.kaseta.key.checking-sub', { done: state.done, n: sources.length })
                  : t('world.kaseta.key.check-sub')
              }
              lamp={state.kind === 'scanning' ? 'busy' : state.kind === 'done' ? 'on' : undefined}
              disabled={state.kind === 'scanning'}
              onClick={check}
            />
          ) : (
            <Key icon="eject" label={t('page.manager')} sub={t('world.kaseta.key.manage-sub')} onClick={() => setView({ kind: 'manager' })} />
          )}
          <Key
            icon="flip"
            label={t('world.kaseta.key.flip')}
            sub={t(flipped ? 'world.kaseta.key.flip-a' : 'world.kaseta.key.flip-b')}
            aria-pressed={flipped}
            onClick={() => setTurns((n) => n + 1)}
          />
        </div>
        <p className="ks-pen ks-deck__note">{t('world.kaseta.deck.note')}</p>
      </div>
    </div>
  )
}
