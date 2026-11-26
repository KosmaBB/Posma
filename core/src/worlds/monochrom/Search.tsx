import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { AppState, View } from '../../state/appState'
import { catalogNumbers, folders, modulesForOs } from '../../data/modules'
import { locale, t } from '../../i18n'

interface Hit {
  key: string
  label: string
  hint: string
  go: () => void
}

/** Case and Polish letters folded, so "lancuch" finds "łańcuch". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/ł/g, 'l')

/** Ctrl K field: modules, folders and the app's own pages, opened with Enter. */
export function Search({ app }: { app: AppState }) {
  const { onboarding, linuxProfile, installedSet, setView } = app
  const os = onboarding?.os
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [at, setAt] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useId()

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // The tour and a module's dialog own the keyboard while they are open.
      if (app.touring || document.querySelector('.modal-backdrop')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
        input.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [app.touring])

  const all = useMemo<Hit[]>(() => {
    const to = (view: View) => () => setView(view)
    const numbers = catalogNumbers(os, linuxProfile)
    const pages: Hit[] = [
      { key: 'home', label: t('world.monochrom.overview'), hint: t('world.monochrom.search.home.hint'), go: to({ kind: 'dashboard' }) },
      { key: 'settings', label: t('page.settings'), hint: t('world.monochrom.search.settings.hint'), go: to({ kind: 'settings' }) },
      { key: 'manager', label: t('page.manager'), hint: t('world.monochrom.search.manager.hint'), go: to({ kind: 'manager' }) },
      { key: 'links', label: t('page.links'), hint: t('world.monochrom.search.links.hint'), go: to({ kind: 'links' }) },
      { key: 'tour', label: t('nav.tour'), hint: t('world.monochrom.search.tour.hint'), go: app.startTour },
    ]
    const dirs: Hit[] = folders.map((f) => ({ key: `f-${f.id}`, label: f.name, hint: t('world.monochrom.search.folder'), go: to({ kind: 'folder', folderId: f.id }) }))
    const mods: Hit[] = (os ? modulesForOs(os, linuxProfile) : []).map((m) => {
      const on = installedSet.has(m.id)
      return {
        key: `m-${m.id}`,
        label: `${numbers.get(m.id) ?? ''} ${m.name}`.trim(),
        hint: on ? m.desc : t('world.monochrom.search.off'),
        go: on ? to({ kind: 'module', moduleId: m.id }) : to({ kind: 'folder', folderId: m.folder }),
      }
    })
    return [...pages, ...dirs, ...mods]
  }, // locale() re-runs the memo when the language changes
  [os, linuxProfile, installedSet, setView, app.startTour, locale()])

  const needle = fold(q.trim())
  const hits = needle ? all.filter((h) => fold(`${h.label} ${h.hint}`).includes(needle)).slice(0, 8) : []
  const shown = open && needle.length > 0

  function pick(h: Hit | undefined) {
    if (!h) return
    h.go()
    setQ('')
    setOpen(false)
    input.current?.blur()
  }

  return (
    <div className="mono-search">
      <svg className="mono-search__icon" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label={t('world.monochrom.search.placeholder')}
        aria-expanded={shown}
        aria-controls={list}
        aria-activedescendant={shown && hits[at] ? `${list}-${at}` : undefined}
        placeholder={t('world.monochrom.search.placeholder')}
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setAt(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(i + 1, hits.length - 1)) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(i - 1, 0)) }
          if (e.key === 'Enter') pick(hits[at])
          if (e.key === 'Escape') { setQ(''); input.current?.blur() }
        }}
      />
      <kbd>Ctrl K</kbd>
      {shown && (
        <ul className="mono-search__list" id={list} role="listbox" aria-label={t('world.monochrom.search.results')}>
          {hits.length === 0 && <li className="mono-search__none">{t('world.monochrom.search.none', { q: q.trim() })}</li>}
          {hits.map((h, i) => (
            <li
              key={h.key}
              id={`${list}-${i}`}
              role="option"
              aria-selected={i === at}
              // mousedown, not click: the field's blur would close the list first.
              onMouseDown={(e) => { e.preventDefault(); pick(h) }}
              onMouseEnter={() => setAt(i)}
            >
              <b>{h.label}</b>
              <span>{h.hint}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
