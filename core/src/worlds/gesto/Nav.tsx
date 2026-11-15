/**
 * Gęsto's navigation: a header band with search and live readings, folder
 * tabs, the open folder's modules in a second row, and a category rail.
 * Nothing is hidden behind a menu; every destination is one click away.
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
import { version } from '../../../package.json'
import { folderNumber, folders, modulesForOs, orderedModules, type FolderId } from '../../data/modules'
import { APP_PAGES } from '../../components/shell/Sidebar'
import { Icon } from '../../components/Icons'
import { UP_TO_ONE, systemName, usedPct } from '../../state/machine'
import { installedIn, readingOf, type Ctx } from './parts'

/** Which tab the current view sits under: a folder, the app's own pages, or the home page. */
export type Section = FolderId | 'app' | null

const APP_ICON = { manager: 'manager', settings: 'settings', links: 'links' } as const
const MAX_HITS = 8

interface Hit {
  key: string
  no: string
  label: string
  note: string
  go: () => void
}

/** Modules, folders and app pages whose name or number matches; switched-off modules lead to their folder. */
function search({ app, numbers }: Ctx, query: string): Hit[] {
  const q = query.trim().toLocaleLowerCase('pl')
  if (!q || !app.onboarding) return []
  const go = app.setView
  const all: Hit[] = [
    ...modulesForOs(app.onboarding.os, app.linuxProfile).map((m) => {
      const on = app.installedSet.has(m.id)
      const folder = folders.find((f) => f.id === m.folder)!
      return {
        key: m.id,
        no: numbers.get(m.id) ?? '—',
        label: m.name,
        note: on ? folder.name : 'wyłączony · otwórz folder',
        go: () => go(on ? { kind: 'module', moduleId: m.id } : { kind: 'folder', folderId: m.folder }),
      }
    }),
    ...folders.map((f) => ({ key: f.id, no: folderNumber(f.id), label: f.name, note: 'folder', go: () => go({ kind: 'folder', folderId: f.id }) })),
    ...APP_PAGES.map((p) => ({ key: p.kind, no: p.no, label: p.name, note: 'aplikacja', go: () => go({ kind: p.kind }) })),
    { key: 'tour', no: '904', label: 'Samouczek', note: 'aplikacja', go: app.startTour },
  ]
  return all.filter((h) => h.label.toLocaleLowerCase('pl').includes(q) || h.no.startsWith(q)).slice(0, MAX_HITS)
}

/** Long mount points keep their start, which is what tells them apart here. */
function shortMount(path: string): string {
  return path.length > 18 ? `${path.slice(0, 16)}…` : path
}

export function Header({ ctx }: { ctx: Ctx }) {
  const { app, machine } = ctx
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const hits = open ? search(ctx, query) : []
  const { info, error, cpu, ram, temp, mainDisk, crowded } = machine
  const mapOn = app.installedSet.has('disk-map')
  const view = app.view.kind

  function go(hit: Hit | undefined) {
    if (!hit) return
    hit.go()
    setQuery('')
    setOpen(false)
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') go(search(ctx, query)[0])
    if (e.key === 'Escape') {
      setQuery('')
      setOpen(false)
    }
  }

  return (
    <header className="g-hd">
      <button type="button" className="g-logo" onClick={() => app.setView({ kind: 'dashboard' })} aria-label="POSMA — pulpit">
        <span className="g-mark" aria-hidden="true">
          <Icon name="sweep" />
        </span>
        POSMA
        <small>v{version}</small>
      </button>

      <div
        className="g-search"
        role="search"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false)
        }}
      >
        <label>
          <Icon name="search" />
          <input
            type="search"
            value={query}
            placeholder="Szukaj modułu, folderu lub ustawienia"
            aria-label="Szukaj modułu, folderu lub ustawienia"
            aria-controls="g-results"
            aria-expanded={hits.length > 0}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value)
              setOpen(true)
            }}
            onKeyDown={onKey}
          />
        </label>
        <button type="button" className="g-search__go" onClick={() => go(search(ctx, query)[0])}>
          <Icon name="search" />
          Szukaj
        </button>
        {open && query.trim() && (
          <div className="g-results" id="g-results">
            {hits.length ? (
              hits.map((h) => (
                <button key={h.key} type="button" onClick={() => go(h)}>
                  <b>{h.no}</b>
                  <span>{h.label}</span>
                  <small>{h.note}</small>
                </button>
              ))
            ) : (
              <p className="g-results__none">Nic nie pasuje do „{query.trim()}”.</p>
            )}
          </div>
        )}
      </div>

      <div className="g-pills" role="group" aria-label="Stan maszyny">
        <span className="g-pill g-pill--opt">{systemName(app)}</span>
        {error && !info && <span className="g-pill g-pill--warn">system-info nie odpowiada</span>}
        <span className="g-pill">
          Procesor <b>{cpu ? `${cpu.value.toFixed(0)}%` : '—'}</b>
        </span>
        <span className="g-pill">
          Pamięć <b>{ram ? `${ram.value.toFixed(0)}%` : '—'}</b>
        </span>
        {mainDisk && (
          <span className="g-pill">
            Dysk {mainDisk.mount_point} <b>{usedPct(mainDisk).toFixed(0)}%</b>
          </span>
        )}
        {crowded.map((d) => {
          const body = (
            <>
              <Icon name="alert" />
              {shortMount(d.mount_point)} <b>{usedPct(d).toFixed(0)}%</b>
            </>
          )
          return mapOn ? (
            <button
              key={d.mount_point}
              type="button"
              className="g-pill g-pill--warn"
              title={`${d.mount_point} — otwórz mapę dysków`}
              onClick={() => app.setView({ kind: 'module', moduleId: 'disk-map' })}
            >
              {body}
            </button>
          ) : (
            <span key={d.mount_point} className="g-pill g-pill--warn" title={d.mount_point}>
              {body}
            </span>
          )
        })}
        {temp && (
          <span className="g-pill g-pill--opt">
            Temp. <b>{temp.value.toFixed(0)} °C</b>
          </span>
        )}
        <span className="g-pill g-pill--opt">Dostęp {app.onboarding?.accessLevel === 'full' ? 'pełny' : 'wybiórczy'}</span>
      </div>

      <nav className="g-util" aria-label="Aplikacja">
        <button type="button" aria-current={view === 'manager' ? 'page' : undefined} title="901 Zarządzanie modułami" onClick={() => app.setView({ kind: 'manager' })}>
          <Icon name="manager" />
          <span>Moduły</span>
        </button>
        <button type="button" data-tour="tour" title="904 Samouczek" onClick={app.startTour}>
          <Icon name="docs" />
          <span>Samouczek</span>
        </button>
        <button type="button" aria-current={view === 'settings' ? 'page' : undefined} title="902 Ustawienia" onClick={() => app.setView({ kind: 'settings' })}>
          <Icon name="settings" />
          <span>Ustawienia</span>
        </button>
      </nav>
    </header>
  )
}

export function Tabs({ ctx, section }: { ctx: Ctx; section: Section }) {
  const { app, settings } = ctx
  const go = app.setView
  return (
    <nav className="g-tabs" aria-label="Foldery">
      <button type="button" className="g-tab" aria-current={app.view.kind === 'dashboard' ? 'page' : undefined} onClick={() => go({ kind: 'dashboard' })}>
        Pulpit
      </button>
      {folders.map((f) => (
        <button
          key={f.id}
          type="button"
          className="g-tab"
          data-tour="folder"
          aria-current={section === f.id ? 'page' : undefined}
          onClick={() => go({ kind: 'folder', folderId: f.id })}
        >
          {f.name}
          <em>{installedIn(ctx, f.id).length}</em>
        </button>
      ))}
      <button type="button" className="g-tab" aria-current={section === 'app' ? 'page' : undefined} onClick={() => go({ kind: 'manager' })}>
        Aplikacja
      </button>
      <span className="g-tabs__aside">Odczyt co {UP_TO_ONE.format(settings.settings.refreshMs / 1000)} s</span>
    </nav>
  )
}

interface SubItem {
  key: string
  no: string
  label: string
  figure?: string
  current: boolean
  go: () => void
}

/** Second row: the open folder's modules, every module on the home page, the app pages under 900. */
export function SubNav({ ctx, section }: { ctx: Ctx; section: Section }) {
  const { app, numbers } = ctx
  const { view } = app
  const items: SubItem[] =
    section === 'app'
      ? [
          ...APP_PAGES.map((p) => ({ key: p.kind, no: p.no, label: p.name, current: view.kind === p.kind, go: () => app.setView({ kind: p.kind }) })),
          { key: 'tour', no: '904', label: 'Samouczek', current: false, go: app.startTour },
        ]
      : (section
          ? installedIn(ctx, section)
          : orderedModules(app.onboarding?.os, app.moduleOrder, app.linuxProfile).filter((m) => app.installedSet.has(m.id))
        ).map((m) => {
          const r = readingOf(m, ctx)
          return {
            key: m.id,
            no: numbers.get(m.id) ?? '—',
            label: m.name,
            figure: r?.hot ? r.text : undefined,
            current: view.kind === 'module' && view.moduleId === m.id,
            go: () => app.setView({ kind: 'module', moduleId: m.id }),
          }
        })

  return (
    <nav className="g-sub" aria-label={section === 'app' ? 'Strony aplikacji' : 'Moduły'}>
      {items.length ? (
        items.map((it) => (
          <button key={it.key} type="button" aria-current={it.current ? 'page' : undefined} onClick={it.go}>
            <b>{it.no}</b>
            {it.label}
            {it.figure && <em>{it.figure}</em>}
          </button>
        ))
      ) : (
        <span className="g-sub__empty">W tym folderze nie ma włączonych modułów.</span>
      )}
    </nav>
  )
}

/** Left rail: every folder as an accordion of its modules, then the app's own pages. */
export function Rail({ ctx, section }: { ctx: Ctx; section: Section }) {
  const { app, numbers } = ctx
  const { view } = app
  const [open, setOpen] = useState<Set<FolderId>>(() => new Set([section && section !== 'app' ? section : 'data']))

  // Arriving in a folder from elsewhere opens its group; closing it stays a person's choice.
  useEffect(() => {
    if (section && section !== 'app') setOpen((prev) => (prev.has(section) ? prev : new Set(prev).add(section)))
  }, [section])

  function toggle(id: FolderId) {
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <aside className="g-rail" aria-label="Kategorie">
      <section className="g-box g-acc">
        <header className="g-bh">
          <span className="g-tag g-tag--ink" aria-hidden="true">
            <Icon name="manager" />
          </span>
          <h2>Kategorie</h2>
        </header>
        <ul>
          {folders.map((f) => {
            const mods = installedIn(ctx, f.id)
            const isOpen = open.has(f.id)
            return (
              <li key={f.id}>
                <button type="button" className="g-acc__head" aria-expanded={isOpen} onClick={() => toggle(f.id)}>
                  <Icon name="chevron" className={isOpen ? 'open' : undefined} />
                  <span>{f.name}</span>
                  <em>{mods.length}</em>
                </button>
                {isOpen && (
                  <ul className="g-acc__list">
                    {mods.map((m) => {
                      const r = readingOf(m, ctx)
                      return (
                        <li key={m.id}>
                          <button
                            type="button"
                            aria-current={view.kind === 'module' && view.moduleId === m.id ? 'page' : undefined}
                            onClick={() => app.setView({ kind: 'module', moduleId: m.id })}
                          >
                            <b>{numbers.get(m.id)}</b>
                            <span>{m.name}</span>
                            {r?.hot && <i>{r.text}</i>}
                          </button>
                        </li>
                      )
                    })}
                    <li>
                      <button
                        type="button"
                        className="g-acc__all"
                        aria-current={view.kind === 'folder' && view.folderId === f.id ? 'page' : undefined}
                        onClick={() => app.setView({ kind: 'folder', folderId: f.id })}
                      >
                        <b>{folderNumber(f.id)}</b>
                        <span>{mods.length ? 'Cały folder' : 'Brak włączonych — otwórz folder'}</span>
                      </button>
                    </li>
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="g-box g-tools">
        <header className="g-bh">
          <span className="g-tag g-tag--ink">900</span>
          <h2>Aplikacja</h2>
        </header>
        {APP_PAGES.map((p) => (
          <button key={p.kind} type="button" aria-current={view.kind === p.kind ? 'page' : undefined} onClick={() => app.setView({ kind: p.kind })}>
            <Icon name={APP_ICON[p.kind]} />
            <span>{p.name}</span>
            <em>{p.no}</em>
          </button>
        ))}
        <button type="button" onClick={app.startTour}>
          <Icon name="docs" />
          <span>Samouczek</span>
          <em>904</em>
        </button>
      </section>
    </aside>
  )
}
