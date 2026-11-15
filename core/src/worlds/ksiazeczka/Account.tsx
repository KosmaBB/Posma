/**
 * The left page: the account card. Free space on the main disk is the
 * balance; every disk is a sub-account; memory, temperature and the CPU
 * are the statement. On the home spread it is the whole card; elsewhere
 * it keeps the balance in view and lends the rest of the page to the view.
 */
import { useMemo, type ReactNode } from 'react'
import type { AppState } from '../../state/appState'
import type { SettingsState } from '../../state/settings'
import { catalogNumbers } from '../../data/modules'
import { CpuProfile } from '../../components/CpuProfile'
import {
  DISK_WARN_PCT, HISTORY, UP_TO_ONE, gb, plural, systemName, usedPct, type DiskInfo, type Machine,
} from '../../state/machine'
import { Guilloche, MicroRule, Seal } from './Print'

const TIME = new Intl.DateTimeFormat('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const PCT = (v: number) => `${Math.round(v)} %`

/** "47,5 GB" as a figure and its unit, so the unit can sit smaller beside it. */
function figure(bytes: number): [string, string] {
  const [num, unit] = gb(bytes).split(' ')
  return [num, unit]
}

function Balance({ machine, after }: { machine: Machine; after?: number | null }) {
  const { info, error, mainDisk } = machine
  // The moment this reading arrived, printed like the passbook's "stan na".
  const stamp = useMemo(() => (info ? TIME.format(new Date()) : null), [info])

  if (!info) {
    return (
      <div className="kz-balance kz-balance--wait" role="status">
        <span className="kz-lbl">Saldo wolnego miejsca</span>
        {error ? (
          <p className="kz-void">Odczyt nie doszedł — moduł system-info nie odpowiada. Saldo pojawi się po następnej próbie.</p>
        ) : (
          <p className="kz-proof">Czekam na pierwszy odczyt dysku…</p>
        )}
      </div>
    )
  }
  if (!mainDisk) {
    return (
      <div className="kz-balance kz-balance--wait">
        <span className="kz-lbl">Saldo wolnego miejsca</span>
        <p className="kz-proof">System nie podał żadnego dysku.</p>
      </div>
    )
  }

  const [num, unit] = figure(mainDisk.available_bytes)
  const used = mainDisk.total_bytes - mainDisk.available_bytes
  const low = usedPct(mainDisk) >= DISK_WARN_PCT
  const projected = after ? figure(mainDisk.available_bytes + after) : null
  return (
    <div className="kz-balance">
      <div>
        <span className="kz-lbl">Saldo wolnego miejsca na {mainDisk.mount_point}</span>
        <div className="kz-balance__row">
          <span className={`kz-big${low ? ' kz-debit' : ''}`}>
            {num}
            <small>{unit}</small>
          </span>
          {projected && (
            <>
              <svg className="kz-arrow" viewBox="0 0 34 14" aria-hidden="true">
                <path d="M0 7h30M24 1l7 6-7 6" />
              </svg>
              <span className="kz-big kz-big--after" aria-label={`po dyspozycji ${projected.join(' ')}`}>
                {projected[0]}
                <small>{projected[1]}</small>
              </span>
            </>
          )}
        </div>
      </div>
      <div className="kz-balance__side">
        <span className="kz-mx">
          z {gb(mainDisk.total_bytes)} · zajęte {gb(used)}
        </span>
        <span className="kz-mx">
          {PCT(usedPct(mainDisk))}
          {mainDisk.model ? ` · ${mainDisk.model}` : ''}
        </span>
        <span className="kz-proof">
          {projected ? 'po dyspozycji: według sprawdzenia na stronie rachunku' : `stan na ${stamp}`}
        </span>
      </div>
    </div>
  )
}

function Subaccounts({ disks: all, app }: { disks: DiskInfo[]; app: AppState }) {
  const { installedSet, onboarding, linuxProfile, setView } = app
  // Zero-capacity mounts (bind and namespace leftovers) carry no balance.
  const disks = all.filter((d) => d.total_bytes > 0)
  const mapNo = catalogNumbers(onboarding?.os, linuxProfile).get('disk-map')
  const crowded = disks.some((d) => usedPct(d) >= DISK_WARN_PCT)
  if (disks.length === 0) return null
  return (
    <div className="kz-sub">
      <table className="kz-table">
        <thead>
          <tr>
            <th>Subkonta · nośniki</th>
            <th className="n">Wolne</th>
            <th>Zajęte</th>
            <th className="n">Pojemność</th>
          </tr>
        </thead>
        <tbody>
          {disks.map((d) => {
            const pct = usedPct(d)
            const low = pct >= DISK_WARN_PCT
            return (
              <tr key={d.mount_point} className={low ? 'kz-low' : undefined}>
                <td>
                  <span className="kz-path" title={d.mount_point}>{d.mount_point}</span>
                  {d.model && <span className="kz-proof"> {d.model}</span>}
                  {low && <span className="kz-stamp kz-stamp--debit">saldo niskie</span>}
                </td>
                <td className="n kz-mx">{gb(d.available_bytes)}</td>
                <td>
                  <span className="kz-fill" aria-hidden="true">
                    <i style={{ width: `${Math.min(100, pct)}%` }} />
                  </span>
                  <span className="kz-mx">{PCT(pct)}</span>
                </td>
                <td className="n kz-mx">{gb(d.total_bytes)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {crowded && mapNo && installedSet.has('disk-map') && (
        <button className="kz-link" onClick={() => setView({ kind: 'module', moduleId: 'disk-map' })}>
          Co zajmuje miejsce — {mapNo} Mapa dysków
        </button>
      )}
    </div>
  )
}

function Statement({ machine }: { machine: Machine }) {
  const { ram, temp, cpu, coreCount } = machine
  return (
    <div className="kz-statement" aria-label="Wyciąg">
      <div>
        <span className="kz-lbl">Pamięć</span>
        <span className="kz-mx kz-mx--l">{ram ? PCT(ram.value) : '—'}</span>
        <span className="kz-proof">{ram?.detail ?? 'brak odczytu'}</span>
      </div>
      <div>
        <span className="kz-lbl">Temperatura</span>
        <span className="kz-mx kz-mx--l">{temp ? `${temp.value.toFixed(0)} °C` : '—'}</span>
        <span className="kz-proof">{temp ? temp.detail ?? 'procesor' : 'czujnik niedostępny'}</span>
      </div>
      <div>
        <span className="kz-lbl">Procesor</span>
        <span className="kz-mx kz-mx--l">{cpu ? PCT(cpu.value) : '—'}</span>
        <span className="kz-proof">
          {coreCount ? `${coreCount} ${plural(coreCount, 'rdzeń', 'rdzenie', 'rdzeni')}` : 'czekam na rdzenie'}
        </span>
      </div>
    </div>
  )
}

function CpuStatement({ machine, settings, refreshMs }: { machine: Machine; settings: SettingsState; refreshMs: number }) {
  const { record, error, coreCount } = machine
  const watched = settings.settings.watchedCores.filter((c) => c < coreCount)
  return (
    <div className="kz-cpu" data-tour="cpu">
      <div className="kz-cpu__head">
        <span className="kz-lbl">Wyciąg · procesor</span>
        <span className="kz-proof">odczyt co {UP_TO_ONE.format(refreshMs / 1000)} s</span>
      </div>
      {record.samples.length > 1 ? (
        <div className="cpu-box">
          <CpuProfile
            samples={record.samples}
            capacity={HISTORY}
            tick={record.tick}
            intervalMs={refreshMs}
            watched={settings.settings.watchedCores}
            onWatch={(cores) => settings.set('watchedCores', cores)}
          />
        </div>
      ) : (
        <div className="cpu-box cpu-box--wait" role="status">
          {error ? 'Wyciąg nie doszedł — moduł system-info nie odpowiada.' : 'Wyciąg potrzebuje dwóch odczytów — czekam na kolejny…'}
        </div>
      )}
      {watched.length > 0 && (
        <div className="kz-watch">
          <span className="kz-lbl">Obserwowane rdzenie</span>
          <span className="kz-mx">{watched.map((c) => String(c).padStart(2, '0')).join(' · ')}</span>
          <button className="btn btn-ghost btn-mini" onClick={() => settings.set('watchedCores', [])}>
            Wyczyść
          </button>
        </div>
      )}
      <p className="kz-cap">
        Linia ciągła to średnia procesora, przerywana — najbardziej zajęty rdzeń. Słupki to rdzenie teraz; kliknij słupek, by
        obserwować go na stałe.
      </p>
    </div>
  )
}

interface AccountProps {
  app: AppState
  settings: SettingsState
  machine: Machine
  refreshMs: number
  /** The whole card (home spread); otherwise just the balance plus `children`. */
  full?: boolean
  /** Bytes the open order would free, to print the balance after it. */
  after?: number | null
  page: string
  children?: ReactNode
}

export function AccountPage({ app, settings, machine, refreshMs, full, after, page, children }: AccountProps) {
  const { onboarding, installedSet, linuxProfile } = app
  const numbers = useMemo(() => catalogNumbers(onboarding?.os, linuxProfile), [onboarding?.os, linuxProfile])
  const enabled = [...numbers.keys()].filter((id) => installedSet.has(id)).length
  const mount = machine.mainDisk?.mount_point ?? '/'

  return (
    <section className="kz-page kz-page--l" aria-label="Karta rachunku">
      <Guilloche side="left" />
      <div className="kz-pad">
        <div className="kz-head">
          <span className="kz-pre">Książeczka oszczędnościowa · rachunek wolnego miejsca</span>
        </div>
        <div className="kz-acct" data-tour={full ? 'machine' : undefined}>
          <h1 className="kz-acct__title">
            {systemName(app)} <span>· {mount}</span>
          </h1>
          {full && (
            <dl className="kz-fields">
              <div>
                <dt className="kz-lbl">Dostęp</dt>
                <dd>{onboarding?.accessLevel === 'full' ? 'pełny' : 'wybiórczy'}</dd>
              </div>
              <div>
                <dt className="kz-lbl">Dyspozycje</dt>
                <dd>
                  {enabled} z {numbers.size}
                </dd>
              </div>
              <div>
                <dt className="kz-lbl">Kasjer</dt>
                <dd>broker POSMA</dd>
              </div>
            </dl>
          )}
          <MicroRule text="POSMA · RACHUNEK WOLNEGO MIEJSCA · KAŻDA ZMIANA PRZEZ BROKERA" />
          <Balance machine={machine} after={after} />
          {full && <Subaccounts disks={machine.disks} app={app} />}
          {full && <Statement machine={machine} />}
        </div>
        {full && <CpuStatement machine={machine} settings={settings} refreshMs={refreshMs} />}
        {children}
        <footer className="kz-foot">
          <span className="kz-pageno">{page}</span>
          <Seal label="0001" />
        </footer>
      </div>
    </section>
  )
}
