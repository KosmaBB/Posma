/**
 * Książeczka: the machine as a savings account in a bank passbook. A bar on
 * the green cover, order-form tabs along the top edge (folders and their
 * modules), and the open spread: the account card on the left page, the
 * ledger, an order form or an app page on the right.
 */
import { useMemo } from 'react'
import { version } from '../../../package.json'
import type { ShellProps } from '../index'
import type { AppState } from '../../state/appState'
import {
  applyOrder, catalogNumbers, folderNumber, folders, moduleById, modulesInFolder, riskLabel, type ModuleDef,
} from '../../data/modules'
import { APP_PAGES } from '../../components/shell/Sidebar'
import { Tour } from '../../components/tour/Tour'
import { FolderView } from '../../views/FolderView'
import { ModuleBody } from '../../views/ModuleView'
import { ModuleManager } from '../../views/ModuleManager'
import { Settings } from '../../views/Settings'
import { Links } from '../../views/Links'
import { UP_TO_ONE, size, systemName, useMachine, useReclaim, type ReclaimState } from '../../state/machine'
import { AccountPage } from './Account'
import { LedgerPage } from './Ledger'
import { Guilloche } from './Print'

/** Off the home spread only the balance is on show; it need not be read as often as the CPU statement. */
const QUIET_REFRESH_MS = 10_000

const RISK_TERMS: Record<ModuleDef['risk'], string> = {
  low: 'Moduł najpierw tylko czyta. Nic nie znika, dopóki tego nie potwierdzisz.',
  medium: 'Zmienia ustawienia systemu. Przeczytaj pozycje, zanim je potwierdzisz.',
  critical: 'Zmiana może utrudnić start systemu. POSMA zapyta więcej niż raz.',
}

function Bar({ app, refreshMs }: { app: AppState; refreshMs: number }) {
  const { view, setView, onboarding } = app
  return (
    <header className="kz-bar">
      <b className="kz-bar__brand">POSMA</b>
      <span className="kz-bar__dim">{version}</span>
      <span className="kz-bar__title">Książeczka wolnego miejsca</span>
      <span className="kz-bar__dim kz-bar__sys">
        {systemName(app)} · dostęp {onboarding?.accessLevel === 'full' ? 'pełny' : 'wybiórczy'}
      </span>
      <span className="kz-bar__sp" />
      <span className="kz-bar__live">
        <i aria-hidden="true" />
        odczyt co {UP_TO_ONE.format(refreshMs / 1000)} s
      </span>
      <nav className="kz-bar__nav" aria-label="Aplikacja">
        {APP_PAGES.map((p) => (
          <button key={p.kind} aria-current={view.kind === p.kind ? 'page' : undefined} onClick={() => setView({ kind: p.kind })}>
            <span className="kz-bar__no">{p.no}</span> {p.name}
          </button>
        ))}
        <button data-tour="tour" onClick={app.startTour}>
          <span className="kz-bar__no">904</span> Samouczek
        </button>
      </nav>
    </header>
  )
}

/** Order-form tabs: the account, each folder with its installed modules, along the top edge of the book. */
function Tabs({ app, activeFolder }: { app: AppState; activeFolder: string | null }) {
  const { view, setView, installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  return (
    <nav className="kz-tabs" aria-label="Rachunek i dyspozycje">
      <button
        className="kz-tab kz-tab--acct"
        aria-current={view.kind === 'dashboard' ? 'page' : undefined}
        onClick={() => setView({ kind: 'dashboard' })}
      >
        000 · Rachunek
      </button>
      {folders.map((f) => {
        const items = applyOrder(modulesInFolder(f.id, os, linuxProfile), moduleOrder[f.id]).filter((m) => installedSet.has(m.id))
        return (
          <div key={f.id} className={`kz-tabgrp${activeFolder === f.id ? ' on' : ''}`} data-folder={f.id}>
            <button
              className="kz-tab kz-tab--folder"
              data-tour="folder"
              aria-current={view.kind === 'folder' && view.folderId === f.id ? 'page' : undefined}
              onClick={() => setView({ kind: 'folder', folderId: f.id })}
            >
              {folderNumber(f.id)} {f.name}
            </button>
            {items.map((m) => {
              const on = view.kind === 'module' && view.moduleId === m.id
              const no = numbers.get(m.id)
              return (
                <button
                  key={m.id}
                  className="kz-tab kz-tab--mod"
                  aria-current={on ? 'page' : undefined}
                  aria-label={`${no} ${m.name}`}
                  title={m.name}
                  onClick={() => setView({ kind: 'module', moduleId: m.id })}
                >
                  {no}
                  {on && <span className="kz-tab__name"> · {m.name}</span>}
                </button>
              )
            })}
          </div>
        )
      })}
    </nav>
  )
}

/** The order form: printed header with the module's fields, the module's own interface in the field area. */
function OrderForm({ app, mod, mount }: { app: AppState; mod: ModuleDef; mount: string }) {
  const no = catalogNumbers(app.onboarding?.os, app.linuxProfile).get(mod.id) ?? '—'
  const folder = folders.find((f) => f.id === mod.folder)!
  return (
    <div className="kz-form" data-tour="module">
      <header className="kz-form__head" data-tour="module-hero">
        <div className="kz-head">
          <span className="kz-pre">Polecenie · dyspozycja {no}</span>
          <span className="kz-pre kz-pre--n">druk P-{no}</span>
        </div>
        <h1 className="kz-form__title">
          <span className="kz-mx">{no}</span> {mod.name}
        </h1>
        <p className="kz-form__desc">{mod.desc}</p>
        <div className="kz-cells">
          <div className="kz-cell">
            <span className="kz-lbl">Nr dyspozycji</span>
            <b className="kz-mx">{no}</b>
          </div>
          <div className="kz-cell">
            <span className="kz-lbl">Folder</span>
            <b>
              {folderNumber(folder.id)} {folder.name}
            </b>
          </div>
          <div className="kz-cell">
            <span className="kz-lbl">Z rachunku</span>
            <b className="kz-path">{mount}</b>
          </div>
          <div className="kz-cell">
            <span className="kz-lbl">Ryzyko</span>
            <b>
              <span className={`kz-stamp kz-stamp--${mod.risk}`}>{riskLabel[mod.risk]}</span>
            </b>
          </div>
        </div>
      </header>
      <ModuleBody app={app} mod={mod} />
    </div>
  )
}

/** Left-page extras for an open order: what it does, what the risk means, what the check found. */
function Terms({ mod, reclaim }: { mod: ModuleDef; reclaim: ReclaimState }) {
  const hit = reclaim.foundOf(mod.id)
  return (
    <div className="kz-terms">
      <h2 className="kz-lbl">Warunki dyspozycji</h2>
      <p>
        <b>Co robi.</b> {mod.desc}
      </p>
      <p>
        <b>{riskLabel[mod.risk]}.</b> {RISK_TERMS[mod.risk]}
      </p>
      {hit && hit.bytes !== null && (
        <p>
          <b>Sprawdzenie z rachunku.</b> {size(hit.bytes)} do odzyskania przy domyślnym wyborze modułu.
        </p>
      )}
    </div>
  )
}

/** Left-page extras for the app's own pages: their contents, as the passbook's last pages. */
function Contents({ app }: { app: AppState }) {
  const { view, setView } = app
  return (
    <nav className="kz-contents" aria-label="Strony aplikacji">
      <h2 className="kz-lbl">Strony 900 · aplikacja</h2>
      {APP_PAGES.map((p) => (
        <button key={p.kind} aria-current={view.kind === p.kind ? 'page' : undefined} onClick={() => setView({ kind: p.kind })}>
          <span className="kz-mx">{p.no}</span> {p.name}
        </button>
      ))}
      <button onClick={app.startTour}>
        <span className="kz-mx">904</span> Samouczek
      </button>
    </nav>
  )
}

/** A right page that holds a whole reused view: folder register, manager, settings, links. */
function Sheet({ title, page, children }: { title: string; page: string; children: React.ReactNode }) {
  return (
    <section className="kz-page kz-page--r" aria-label={title}>
      <Guilloche side="right" />
      <div className="kz-pad">
        <div className="kz-head">
          <span className="kz-pre">{title}</span>
          <span className="kz-pre kz-pre--n">{page}</span>
        </div>
        <div className="kz-sheet">{children}</div>
      </div>
    </section>
  )
}

export function Shell({ app, settings }: ShellProps) {
  const { view } = app
  const refreshMs = settings.settings.refreshMs
  const home = view.kind === 'dashboard'
  const machine = useMachine(home ? refreshMs : Math.max(refreshMs, QUIET_REFRESH_MS))
  // Held here, not on the home page, so the check survives a visit to a module.
  const reclaim = useReclaim(app)
  const mount = machine.mainDisk?.mount_point ?? '/'
  const mod = view.kind === 'module' ? moduleById(view.moduleId, app.linuxProfile) : undefined
  const activeFolder = view.kind === 'folder' ? view.folderId : mod?.folder ?? null
  const account = { app, settings, machine, refreshMs }

  let left: React.ReactNode
  let right: React.ReactNode
  switch (view.kind) {
    case 'dashboard':
      left = <AccountPage {...account} full page="s. 1 · karta rachunku" />
      right = <LedgerPage app={app} machine={machine} reclaim={reclaim} />
      break
    case 'module': {
      const no = mod ? catalogNumbers(app.onboarding?.os, app.linuxProfile).get(mod.id) : undefined
      left = (
        <AccountPage {...account} after={mod ? reclaim.foundOf(mod.id)?.bytes : null} page={`karta dyspozycji ${no ?? ''}`}>
          {mod && <Terms mod={mod} reclaim={reclaim} />}
        </AccountPage>
      )
      right = (
        <section className="kz-page kz-page--r kz-page--form" aria-label={mod ? `Dyspozycja ${mod.name}` : 'Dyspozycja'}>
          <div className="kz-pad">
            {mod ? (
              <OrderForm app={app} mod={mod} mount={mount} />
            ) : (
              <div className="glass empty-state">
                Nie ma takiego druku.
                <br />
                <button className="btn btn-primary" onClick={() => app.setView({ kind: 'dashboard' })}>
                  Wróć do rachunku
                </button>
              </div>
            )}
          </div>
        </section>
      )
      break
    }
    case 'folder': {
      const folder = folders.find((f) => f.id === view.folderId)
      left = <AccountPage {...account} page={`subkonto ${folder ? folderNumber(folder.id) : ''}`} />
      right = (
        <Sheet title={`Rejestr dyspozycji · ${folder?.name ?? 'folder'}`} page={folder ? `rejestr ${folderNumber(folder.id)}` : ''}>
          <FolderView app={app} folderId={view.folderId} />
        </Sheet>
      )
      break
    }
    default: {
      const page = APP_PAGES.find((p) => p.kind === view.kind)!
      left = (
        <AccountPage {...account} page={`s. ${page.no}`}>
          <Contents app={app} />
        </AccountPage>
      )
      right = (
        <Sheet title={`${page.no} · ${page.name}`} page={`s. ${page.no}`}>
          {view.kind === 'manager' && <ModuleManager app={app} />}
          {view.kind === 'settings' && <Settings app={app} settings={settings} />}
          {view.kind === 'links' && <Links />}
        </Sheet>
      )
    }
  }

  return (
    <div className="kz">
      <Bar app={app} refreshMs={home ? refreshMs : Math.max(refreshMs, QUIET_REFRESH_MS)} />
      <Tabs app={app} activeFolder={activeFolder} />
      <main className="kz-book" data-view={view.kind} data-folder={activeFolder ?? undefined}>
        {left}
        {right}
      </main>
      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}
