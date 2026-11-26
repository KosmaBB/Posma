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
import { t } from '../../i18n'

/** Off the home spread only the balance is on show; it need not be read as often as the CPU statement. */
const QUIET_REFRESH_MS = 10_000

// Getters, so the text follows the language at render time.
const RISK_TERMS: Record<ModuleDef['risk'], string> = {
  get low() { return t('world.ksiazeczka.risk.low') },
  get medium() { return t('world.ksiazeczka.risk.medium') },
  get critical() { return t('world.ksiazeczka.risk.critical') },
}

function Bar({ app, refreshMs }: { app: AppState; refreshMs: number }) {
  const { view, setView, onboarding } = app
  return (
    <header className="kz-bar">
      <b className="kz-bar__brand">POSMA</b>
      <span className="kz-bar__dim">{version}</span>
      <span className="kz-bar__title">{t('world.ksiazeczka.bar.title')}</span>
      <span className="kz-bar__dim kz-bar__sys">
        {systemName(app)} · {t('world.ksiazeczka.bar.access', { level: t(onboarding?.accessLevel === 'full' ? 'world.ksiazeczka.card.access.full' : 'world.ksiazeczka.card.access.selective') })}
      </span>
      <span className="kz-bar__sp" />
      <span className="kz-bar__live">
        <i aria-hidden="true" />
        {t('world.ksiazeczka.bar.live', { s: UP_TO_ONE.format(refreshMs / 1000) })}
      </span>
      <nav className="kz-bar__nav" aria-label={t('nav.app')}>
        {APP_PAGES.map((p) => (
          <button key={p.kind} aria-current={view.kind === p.kind ? 'page' : undefined} onClick={() => setView({ kind: p.kind })}>
            <span className="kz-bar__no">{p.no}</span> {p.name}
          </button>
        ))}
        <button data-tour="tour" onClick={app.startTour}>
          <span className="kz-bar__no">904</span> {t('nav.tour')}
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
    <nav className="kz-tabs" aria-label={t('world.ksiazeczka.tabs.aria')}>
      <button
        className="kz-tab kz-tab--acct"
        aria-current={view.kind === 'dashboard' ? 'page' : undefined}
        onClick={() => setView({ kind: 'dashboard' })}
      >
        {t('world.ksiazeczka.tabs.account')}
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
          <span className="kz-pre">{t('world.ksiazeczka.form.pre', { no })}</span>
          <span className="kz-pre kz-pre--n">{t('world.ksiazeczka.form.print', { no })}</span>
        </div>
        <h1 className="kz-form__title">
          <span className="kz-mx">{no}</span> {mod.name}
        </h1>
        <p className="kz-form__desc">{mod.desc}</p>
        <div className="kz-cells">
          <div className="kz-cell">
            <span className="kz-lbl">{t('world.ksiazeczka.form.order-no')}</span>
            <b className="kz-mx">{no}</b>
          </div>
          <div className="kz-cell">
            <span className="kz-lbl">{t('world.ksiazeczka.form.folder')}</span>
            <b>
              {folderNumber(folder.id)} {folder.name}
            </b>
          </div>
          <div className="kz-cell">
            <span className="kz-lbl">{t('world.ksiazeczka.form.from')}</span>
            <b className="kz-path">{mount}</b>
          </div>
          <div className="kz-cell">
            <span className="kz-lbl">{t('world.ksiazeczka.form.risk')}</span>
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
      <h2 className="kz-lbl">{t('world.ksiazeczka.terms.title')}</h2>
      <p>
        <b>{t('world.ksiazeczka.terms.what')}</b> {mod.desc}
      </p>
      <p>
        <b>{riskLabel[mod.risk]}.</b> {RISK_TERMS[mod.risk]}
      </p>
      {hit && hit.bytes !== null && (
        <p>
          <b>{t('world.ksiazeczka.terms.check')}</b> {t('world.ksiazeczka.terms.check-text', { size: size(hit.bytes) })}
        </p>
      )}
    </div>
  )
}

/** Left-page extras for the app's own pages: their contents, as the passbook's last pages. */
function Contents({ app }: { app: AppState }) {
  const { view, setView } = app
  return (
    <nav className="kz-contents" aria-label={t('world.ksiazeczka.contents.aria')}>
      <h2 className="kz-lbl">{t('world.ksiazeczka.contents.title')}</h2>
      {APP_PAGES.map((p) => (
        <button key={p.kind} aria-current={view.kind === p.kind ? 'page' : undefined} onClick={() => setView({ kind: p.kind })}>
          <span className="kz-mx">{p.no}</span> {p.name}
        </button>
      ))}
      <button onClick={app.startTour}>
        <span className="kz-mx">904</span> {t('nav.tour')}
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
      left = <AccountPage {...account} full page={t('world.ksiazeczka.page.account')} />
      right = <LedgerPage app={app} machine={machine} reclaim={reclaim} />
      break
    case 'module': {
      const no = mod ? catalogNumbers(app.onboarding?.os, app.linuxProfile).get(mod.id) : undefined
      left = (
        <AccountPage {...account} after={mod ? reclaim.foundOf(mod.id)?.bytes : null} page={t('world.ksiazeczka.page.order-card', { no: no ?? '' })}>
          {mod && <Terms mod={mod} reclaim={reclaim} />}
        </AccountPage>
      )
      right = (
        <section className="kz-page kz-page--r kz-page--form" aria-label={mod ? t('world.ksiazeczka.order.aria', { name: mod.name }) : t('world.ksiazeczka.order.aria-none')}>
          <div className="kz-pad">
            {mod ? (
              <OrderForm app={app} mod={mod} mount={mount} />
            ) : (
              <div className="glass empty-state">
                {t('world.ksiazeczka.order.missing')}
                <br />
                <button className="btn btn-primary" onClick={() => app.setView({ kind: 'dashboard' })}>
                  {t('world.ksiazeczka.order.back')}
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
      left = <AccountPage {...account} page={t('world.ksiazeczka.page.subaccount', { no: folder ? folderNumber(folder.id) : '' })} />
      right = (
        <Sheet
          title={t('world.ksiazeczka.register.title', { name: folder?.name ?? t('world.ksiazeczka.register.folder-fallback') })}
          page={folder ? t('world.ksiazeczka.register.page', { no: folderNumber(folder.id) }) : ''}
        >
          <FolderView app={app} folderId={view.folderId} />
        </Sheet>
      )
      break
    }
    default: {
      const page = APP_PAGES.find((p) => p.kind === view.kind)!
      left = (
        <AccountPage {...account} page={t('world.ksiazeczka.page.app', { no: page.no })}>
          <Contents app={app} />
        </AccountPage>
      )
      right = (
        <Sheet title={`${page.no} · ${page.name}`} page={t('world.ksiazeczka.page.app', { no: page.no })}>
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
