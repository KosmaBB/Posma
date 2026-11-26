/**
 * Strumień's frame: a thin bar over the feed (folders as text tabs, the
 * tour, the menu), the feed or page beneath, and a full-screen menu on Esc.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { AppState, View } from '../../state/appState'
import { useReclaim } from '../../state/machine'
import { applyOrder, catalogNumbers, folderNumber, folders, modulesInFolder } from '../../data/modules'
import { APP_PAGES } from '../../components/shell/Sidebar'
import { Tour } from '../../components/tour/Tour'
import { Settings } from '../../views/Settings'
import { ModuleManager } from '../../views/ModuleManager'
import { Links } from '../../views/Links'
import type { ShellProps } from '../index'
import { t } from '../../i18n'
import { typing } from './Feed'
import { Glyph } from './glyphs'
import { Home } from './Home'
import { Folder } from './Folder'
import { ModuleFrame } from './ModuleFrame'

function Page({ no, title, children }: { no: string; title: string; children: ReactNode }) {
  return (
    <div className="sm-page">
      <header className="sm-page__head">
        <span className="sm-page__no">{no}</span>
        <h1>{title}</h1>
      </header>
      <div className="sm-page__body">{children}</div>
    </div>
  )
}

function Menu({ app, go, onClose }: { app: AppState; go: (v: View) => void; onClose: () => void }) {
  const { installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const numbers = catalogNumbers(os, linuxProfile)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    ref.current?.querySelector<HTMLElement>('button')?.focus()
    return () => back?.focus()
  }, [])

  return (
    <div className="sm-menu" role="dialog" aria-modal="true" aria-label={t('world.strumien.menu')} ref={ref}>
      <div className="sm-menu__head">
        <button type="button" className="sm-menu__home" onClick={() => go({ kind: 'dashboard' })}>
          Strumień <span>{t('world.strumien.menu.tagline')}</span>
        </button>
        <button type="button" className="btn btn-ghost btn-mini" onClick={onClose}>
          {t('world.strumien.menu.close')} <kbd>Esc</kbd>
        </button>
      </div>
      <div className="sm-menu__cols">
        {folders.map((f) => {
          const mods = applyOrder(modulesInFolder(f.id, os, linuxProfile), moduleOrder[f.id]).filter((m) => installedSet.has(m.id))
          return (
            <section key={f.id} className={`sm-menu__col sm-field--${f.id}`}>
              <button type="button" className="sm-menu__folder" onClick={() => go({ kind: 'folder', folderId: f.id })}>
                <span>{folderNumber(f.id)}</span>
                {f.name}
              </button>
              <ul>
                {mods.map((m) => (
                  <li key={m.id}>
                    <button type="button" onClick={() => go({ kind: 'module', moduleId: m.id })}>
                      <span>{numbers.get(m.id)}</span>
                      {m.name}
                    </button>
                  </li>
                ))}
                {mods.length === 0 && <li className="sm-menu__empty">{t('world.strumien.menu.empty')}</li>}
              </ul>
            </section>
          )
        })}
        <section className="sm-menu__col sm-field--index">
          <span className="sm-menu__folder sm-menu__folder--static">
            <span>900</span>{t('nav.app')}
          </span>
          <ul>
            {APP_PAGES.map((p) => (
              <li key={p.kind}>
                <button type="button" onClick={() => go({ kind: p.kind })}>
                  <span>{p.no}</span>
                  {p.name}
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  app.startTour()
                }}
              >
                <span>904</span>{t('nav.tour')}
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  )
}

export function Shell({ app, settings }: ShellProps) {
  const { view, setView } = app
  // Lives here, not in the feed, so a check's results survive visiting a module and coming back.
  const reclaim = useReclaim(app)
  const [menu, setMenu] = useState(false)
  const paused = menu || app.touring

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape' || app.touring || e.defaultPrevented || typing(e.target)) return
      if (document.querySelector('.modal-backdrop, .ctx-menu')) return
      setMenu((m) => !m)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app.touring])

  const go = (v: View) => {
    setMenu(false)
    setView(v)
  }
  const page = APP_PAGES.find((p) => p.kind === view.kind)
  const tab = view.kind === 'dashboard' ? 'home' : view.kind === 'folder' ? view.folderId : view.kind === 'module' ? null : 'app'

  return (
    <div className="sm-shell" data-view={view.kind}>
      <header className="sm-top">
        <button type="button" className="sm-brand" onClick={() => go({ kind: 'dashboard' })}>
          POSMA<small>Strumień</small>
        </button>
        <nav className="sm-tabs" aria-label={t('world.strumien.tabs')}>
          <button type="button" aria-current={tab === 'home' ? 'page' : undefined} onClick={() => go({ kind: 'dashboard' })}>
            {t('world.strumien.tabs.all')}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              data-tour="folder"
              aria-current={tab === f.id ? 'page' : undefined}
              onClick={() => go({ kind: 'folder', folderId: f.id })}
            >
              <span>{folderNumber(f.id)}</span>
              {f.name}
            </button>
          ))}
        </nav>
        <div className="sm-top__right">
          <button type="button" className="sm-link" data-tour="tour" onClick={app.startTour}>
            {t('nav.tour')}
          </button>
          <button type="button" className="sm-menu-btn" aria-haspopup="dialog" aria-expanded={menu} onClick={() => setMenu(true)}>
            <Glyph name="menu" />
            {t('world.strumien.menu')} <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      <main className="sm-main">
        {view.kind === 'dashboard' && <Home app={app} settings={settings} reclaim={reclaim} paused={paused} />}
        {view.kind === 'folder' && <Folder app={app} folderId={view.folderId} reclaim={reclaim} paused={paused} />}
        {view.kind === 'module' && <ModuleFrame key={view.moduleId} app={app} moduleId={view.moduleId} reclaim={reclaim} paused={paused} />}
        {page && (
          <Page no={page.no} title={page.name}>
            {view.kind === 'manager' && <ModuleManager app={app} />}
            {view.kind === 'settings' && <Settings app={app} settings={settings} />}
            {view.kind === 'links' && <Links />}
          </Page>
        )}
      </main>

      {menu && <Menu app={app} go={go} onClose={() => setMenu(false)} />}
      {app.touring && <Tour app={app} onClose={app.endTour} />}
    </div>
  )
}
