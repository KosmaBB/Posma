import { useMemo } from 'react'
import type { AppState } from '../state/appState'
import type { SettingsState } from '../state/settings'
import { catalogNumbers, folders, moduleById, orderedModules, type ModuleDef } from '../data/modules'
import { CpuProfile } from '../components/CpuProfile'
import {
  DISK_WARN_PCT, HISTORY, UP_TO_ONE, fill, gb, size, systemName, useMachine, useReclaim, usedPct,
} from '../state/machine'
import { t } from '../i18n'

function codeOf(m: ModuleDef): React.CSSProperties {
  return { '--code': folders.find((f) => f.id === m.folder)!.gradient.g1 } as React.CSSProperties
}

export function Dashboard({ app, settings }: { app: AppState; settings: SettingsState }) {
  const { installedSet, setView, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const refreshMs = settings.settings.refreshMs
  const { info, error, record, disks, cpu, ram, temp, mainDisk, crowded, anyCrowded, coreCount } = useMachine(refreshMs)
  const { reclaim, sources, check: checkReclaim, found, total: foundTotal, foundOf } = useReclaim(app)

  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const enabled = [...numbers.keys()].filter((id) => installedSet.has(id)).length

  // Same ordering the folder view arranges, so dragging a card there moves it here too.
  const quickActions = orderedModules(os, moduleOrder, linuxProfile).filter((m) => installedSet.has(m.id) && m.quickAction)
  const watchedNow = settings.settings.watchedCores.filter((c) => c < coreCount)
  const system = systemName(app)
  /** What the index can already say about a module, before anything is asked of it. */
  function reading(m: ModuleDef): string {
    const hit = foundOf(m.id)
    if (hit && hit.bytes !== null) return t('dashboard.reading.reclaim', { size: size(hit.bytes) })
    if (m.id === 'disk-map' && mainDisk) return t('dashboard.reading.disk', { mount: mainDisk.mount_point, pct: usedPct(mainDisk).toFixed(0) })
    if (m.id === 'health-monitor' && cpu)
      return [t('dashboard.reading.cpu', { pct: cpu.value.toFixed(0) }), temp && `${temp.value.toFixed(0)} °C`].filter(Boolean).join(' · ')
    return '—'
  }

  return (
    <div className="dash">
      {/* --------------------------------------------------- core record */}
      <section className="dash-plot" data-tour="cpu">
        <div className="dash-head">
          <h2 className="lbl">{t('dashboard.cpu.title')}</h2>
          {coreCount > 0 && (
            <span className="mono">
              {t('dashboard.cpu.meta', { cores: `${coreCount} ${t('dashboard.cores', { n: coreCount })}`, s: UP_TO_ONE.format(refreshMs / 1000) })}
            </span>
          )}
        </div>
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
              ? t('dashboard.cpu.error')
              : t('dashboard.cpu.wait')}
          </div>
        )}
        {watchedNow.length > 0 && (
          <div className="cpu-watching">
            <span className="lbl">{t('dashboard.watching')}</span>
            <span className="mono">{watchedNow.map((c) => String(c).padStart(2, '0')).join(' · ')}</span>
            <button className="btn btn-ghost btn-mini" onClick={() => settings.set('watchedCores', [])}>
              {t('dashboard.watching.clear')}
            </button>
          </div>
        )}
        <p className="dash-cap">
          {t('dashboard.caption.a')} <b>{t('dashboard.caption.avg')}</b>{t('dashboard.caption.b')}{' '}
          <b>{t('dashboard.caption.click')}</b> {t('dashboard.caption.c')}
        </p>
        {error && record.samples.length > 0 && <p className="dash-note">{t('dashboard.cpu.last-failed', { error })}</p>}
      </section>

      {/* ------------------------------------------------- machine sheet */}
      <section className="dash-spec" data-tour="machine">
        <h2 className="lbl">{t('dashboard.machine')}</h2>
        <div className="dash-no">POS 000</div>
        <p className="dash-sub">
          {t('dashboard.enabled.a')} <b>{enabled}</b> {t('dashboard.enabled.b', { total: numbers.size })}
        </p>

        <table className="spec-table">
          <tbody>
            <tr>
              <td>{t('dashboard.spec.system')}</td>
              <td>{system}</td>
            </tr>
            {!info && error && (
              <tr>
                <td>{t('dashboard.spec.reading')}</td>
                <td className="warn">{t('dashboard.spec.no-answer')}</td>
              </tr>
            )}
            {!info &&
              !error &&
              Array.from({ length: 3 }, (_, i) => (
                <tr key={i} aria-hidden="true">
                  <td colSpan={2}>
                    <div className="ghost-line ghost-line--row" />
                  </td>
                </tr>
              ))}
            {mainDisk && (
              <tr>
                <td>
                  {t('dashboard.spec.disk')} <span className="spec-path" title={mainDisk.mount_point}>{mainDisk.mount_point}</span>
                </td>
                <td className={usedPct(mainDisk) >= DISK_WARN_PCT ? 'warn' : undefined}>{fill(mainDisk)}</td>
              </tr>
            )}
            {/* A crowded volume earns a row of its own; the rest stay in the drives list. */}
            {crowded.map((d) => (
              <tr key={d.mount_point}>
                <td>
                  {t('dashboard.spec.disk')} <span className="spec-path" title={d.mount_point}>{d.mount_point}</span>
                </td>
                <td className="warn">{fill(d)}</td>
              </tr>
            ))}
            {ram && (
              <tr>
                <td>{t('dashboard.spec.memory')}</td>
                <td>
                  {ram.detail} · {ram.value.toFixed(0)}%
                </td>
              </tr>
            )}
            {cpu && (
              <tr>
                <td>{t('dashboard.spec.cpu')}</td>
                <td>
                  {cpu.value.toFixed(0)}% · {coreCount || '—'} {t('dashboard.cores', { n: coreCount })}
                </td>
              </tr>
            )}
            {temp && (
              <tr>
                <td>{t('dashboard.spec.temp')}</td>
                <td>{temp.value.toFixed(0)} °C</td>
              </tr>
            )}
          </tbody>
        </table>

        {anyCrowded && (
          <button className="dash-more dash-more--warn" onClick={() => setView({ kind: 'module', moduleId: 'disk-map' })}>
            {t('dashboard.crowded', { code: numbers.get('disk-map') ?? '' })}
          </button>
        )}

        {sources.length > 0 ? (
          <>
            {/* One equal mark per module that will be asked. After a check
                the rows below carry the codes, so the strip steps aside. */}
            {reclaim.kind !== 'done' && (
              <div className="code-strip" aria-hidden="true">
                {sources.map((m) => (
                  <span key={m.id} className="code-seg">
                    <i className="code" style={codeOf(m)} />
                    {numbers.get(m.id)}
                  </span>
                ))}
              </div>
            )}

            <div className="dash-actions" data-tour="reclaim">
              {reclaim.kind === 'done' ? (
                <>
                  <div className="reclaim-total">
                    <span className="lbl">{t('dashboard.reclaim.total')}</span>
                    <b>{size(foundTotal)}</b>
                  </div>
                  <div className="reclaim">
                    {found.map((r) => {
                      const m = moduleById(r.id, linuxProfile)!
                      return (
                        <button
                          key={r.id}
                          className="reclaim-row"
                          data-failed={r.error !== null}
                          title={r.error ?? undefined}
                          onClick={() => setView({ kind: 'module', moduleId: r.id })}
                        >
                          <span className="nav-no">{numbers.get(r.id)}</span>
                          <span>{m.name}</span>
                          <em>{r.error ? t('dashboard.reclaim.failed') : size(r.bytes ?? 0)}</em>
                          <span className="code" style={codeOf(m)} />
                        </button>
                      )
                    })}
                  </div>
                  <button className="dash-more" onClick={checkReclaim}>
                    {t('dashboard.reclaim.again')}
                  </button>
                </>
              ) : (
                <button className="btn btn-primary" disabled={reclaim.kind === 'scanning'} onClick={checkReclaim}>
                  {reclaim.kind === 'scanning' ? t('dashboard.reclaim.scanning') : t('dashboard.reclaim.check')}
                  {reclaim.kind === 'scanning' && <b>{`${reclaim.done} / ${sources.length}`}</b>}
                </button>
              )}
              {reclaim.kind !== 'done' && <p className="dash-note">{t('dashboard.reclaim.note')}</p>}
            </div>
          </>
        ) : (
          <div className="dash-actions" data-tour="reclaim">
            <p className="dash-note">{t('dashboard.reclaim.none')}</p>
            <button className="btn btn-ghost" onClick={() => setView({ kind: 'manager' })}>
              {t('page.manager')}
            </button>
          </div>
        )}
      </section>

      {/* ------------------------------------------------ index + drives */}
      <div className="dash-index">
        <section className="dash-idx" data-tour="index">
          <div className="dash-head">
            <h2 className="lbl">{t('dashboard.index')}</h2>
            {/* Surfaces modules the user never switched on — including ones
                that arrived in an update and would otherwise stay unseen. */}
            {numbers.size > enabled && (
              <button className="dash-more" onClick={() => setView({ kind: 'manager' })}>
                {t('dashboard.not-enabled', { n: numbers.size - enabled })}
              </button>
            )}
          </div>
          {quickActions.length > 0 ? (
            <div className="idx-list">
              {quickActions.map((m) => {
                return (
                  <button key={m.id} className="idx-row" onClick={() => setView({ kind: 'module', moduleId: m.id })}>
                    <span className="nav-no">{numbers.get(m.id)}</span>
                    <span>{m.quickAction}</span>
                    <em>{reading(m)}</em>
                    <span className="code" style={codeOf(m)} />
                  </button>
                )
              })}
            </div>
          ) : (
            <div className="idx-empty">
              {t('dashboard.index.empty')}
              <button className="btn btn-ghost btn-mini" onClick={() => setView({ kind: 'manager' })}>
                {t('dashboard.index.browse')}
              </button>
            </div>
          )}
        </section>

        <section className="dash-disks">
          <div className="dash-head">
            <h2 className="lbl">{t('dashboard.drives')}</h2>
            {disks.length > 0 && (
              <span className="mono">
                {t('dashboard.mounted', { n: disks.length })}
              </span>
            )}
          </div>
          <div className="disk-rows">
            {!info && !error && <div className="ghost-line ghost-line--row" aria-hidden="true" />}
            {!info && error && <p className="dash-note">{t('dashboard.drives.none')}</p>}
            {disks.map((d) => {
              const pct = usedPct(d)
              return (
                <div className="disk-row" key={d.mount_point} title={t('dashboard.drives.free', { free: gb(d.available_bytes), total: gb(d.total_bytes) })}>
                  <span className="disk-row__mount">
                    <span className="mono">{d.mount_point}</span>
                    {/* Omitted by the sidecar when the kernel does not describe the device. */}
                    {(d.model || d.solid_state !== undefined) && (
                      <span className="disk-row__model">
                        {[d.solid_state === undefined ? null : d.solid_state ? 'SSD' : 'HDD', d.model].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <div className="disk-row__track">
                    <div
                      className="disk-row__fill"
                      data-level={pct >= DISK_WARN_PCT ? 'full' : pct >= 75 ? 'high' : undefined}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="disk-row__pct">{pct.toFixed(0)}%</span>
                </div>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
