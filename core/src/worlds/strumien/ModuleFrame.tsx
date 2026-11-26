/**
 * A module in this world: a cover that owns the window, then the module's
 * own interface in one tall panel underneath. The module code is shared;
 * only its frame and its blocks' drawing belong to Strumień.
 */
import { useEffect, useRef } from 'react'
import type { AppState } from '../../state/appState'
import { catalogNumbers, folderNumber, folders, moduleById, riskLabel } from '../../data/modules'
import { size, type ReclaimState } from '../../state/machine'
import { motionReduced } from '../../state/looks'
import { t } from '../../i18n'
import { ModuleBody } from '../../views/ModuleView'
import { Item, type FeedItem, type FeedNav } from './Feed'
import { RISK_DENSITY } from './Folder'
import { PatternField, SquareField } from './visuals'

export function ModuleFrame({
  app, moduleId, reclaim, paused,
}: {
  app: AppState
  moduleId: string
  reclaim: ReclaimState
  paused: boolean
}) {
  const { setView, linuxProfile, onboarding } = app
  const mod = moduleById(moduleId, linuxProfile)
  const wrap = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLElement>(null)
  const behavior = () => (motionReduced() ? 'auto' : 'smooth') as ScrollBehavior
  const toBody = () => body.current?.scrollIntoView({ behavior: behavior(), block: 'start' })
  const toCover = () => wrap.current?.scrollTo({ top: 0, behavior: behavior() })
  const back = () => setView(mod ? { kind: 'folder', folderId: mod.folder } : { kind: 'dashboard' })

  // The cover's letters work only while the cover is on screen; inside the module the keys are the module's.
  useEffect(() => {
    if (paused) return
    function onKey(e: KeyboardEvent) {
      const el = wrap.current
      if (!el || e.altKey || e.ctrlKey || e.metaKey || e.defaultPrevented) return
      if (e.target instanceof HTMLElement && e.target.closest('input, select, textarea')) return
      if (document.querySelector('.modal-backdrop')) return
      const onCover = el.scrollTop < (el.firstElementChild as HTMLElement).offsetHeight / 2
      if (onCover && (e.key === 'o' || e.key === 'ArrowDown' || e.key === 'PageDown')) {
        e.preventDefault()
        toBody()
      } else if (onCover && e.key === 'b') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!mod) {
    return (
      <div className="sm-page">
        <div className="empty-state">
          {t('world.strumien.module.missing')}
          <br />
          <button className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>{t('world.strumien.back')}</button>
        </div>
      </div>
    )
  }

  const folder = folders.find((f) => f.id === mod.folder)!
  const no = catalogNumbers(onboarding?.os, linuxProfile).get(mod.id) ?? '—'
  const hit = reclaim.foundOf(mod.id)
  const nav: FeedNav = { next: toBody, goTo: () => {} }

  const cover: FeedItem = {
    id: mod.id,
    field: mod.folder,
    peek: mod.name,
    source: `${folderNumber(folder.id)} · ${folder.name}`,
    note: <span className={`chip ${mod.risk}`}>{riskLabel[mod.risk]}</span>,
    figure: no,
    figureNote: hit?.bytes != null ? t('world.strumien.module.figure-note', { size: size(hit.bytes) }) : undefined,
    title: mod.name,
    text: mod.desc,
    visual:
      hit?.bytes != null ? (
        <SquareField
          tiles={reclaim.found.map((f) => ({
            key: f.id,
            size: Math.max(f.bytes ?? 0, reclaim.total * 0.006, 1),
            label: '',
            hot: f.id === mod.id,
            quiet: f.id !== mod.id,
          }))}
        />
      ) : (
        <PatternField seed={mod.id} density={RISK_DENSITY[mod.risk]} />
      ),
    actions: [
      { key: 'o', label: t('world.strumien.module.open'), glyph: 'down', primary: true, run: toBody },
      { key: 'b', label: folder.name, glyph: 'back', run: back },
    ],
    tour: { caption: 'module-hero' },
  }

  return (
    <div className="sm-module" ref={wrap} data-tour="module">
      <Item item={cover} nav={nav} label={t('world.strumien.module.cover-label', { no, name: mod.name })} state="now" />
      <section className="sm-body" ref={body} aria-label={t('world.strumien.module.label', { name: mod.name })}>
        <header className="sm-body__head">
          <span className="sm-body__no">{no}</span>
          <h1>{mod.name}</h1>
          <span className={`chip ${mod.risk}`}>{riskLabel[mod.risk]}</span>
          <button type="button" className="btn btn-ghost btn-mini" onClick={toCover}>{t('world.strumien.module.cover')}</button>
        </header>
        <div className="sm-body__inner">
          <ModuleBody app={app} mod={mod} />
        </div>
      </section>
    </div>
  )
}
