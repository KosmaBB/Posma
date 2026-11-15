/**
 * Gęsto's small shared pieces: the portal box with its coloured number tag,
 * the meter, the breadcrumb and what a module can already say about itself.
 */
import type { ReactNode } from 'react'
import type { AppState } from '../../state/appState'
import type { SettingsState } from '../../state/settings'
import { size, usedPct, type Machine, type ReclaimState } from '../../state/machine'
import { applyOrder, modulesInFolder, type FolderId, type ModuleDef } from '../../data/modules'
import { Icon } from '../../components/Icons'

/** Everything a Gęsto page reads, gathered once by the shell so the machine is polled once. */
export interface Ctx {
  app: AppState
  settings: SettingsState
  machine: Machine
  reclaim: ReclaimState
  /** Catalog number per module id on this system. */
  numbers: Map<string, string>
}

interface BoxProps {
  no?: ReactNode
  /** Machine and app boxes carry an ink tag; module boxes carry the portal colour. */
  ink?: boolean
  title: ReactNode
  meta?: ReactNode
  more?: { label: string; onClick: () => void }
  className?: string
  tour?: string
  busy?: boolean
  children: ReactNode
}

export function Box({ no, ink, title, meta, more, className, tour, busy, children }: BoxProps) {
  return (
    <section className={className ? `g-box ${className}` : 'g-box'} data-tour={tour} aria-busy={busy || undefined}>
      <header className="g-bh">
        {no !== undefined && <span className={ink ? 'g-tag g-tag--ink' : 'g-tag'}>{no}</span>}
        <h2>{title}</h2>
        {meta !== undefined && <span className="g-meta">{meta}</span>}
        {more && (
          <button type="button" className="g-more" onClick={more.onClick}>
            {more.label}
            <Icon name="chevron" />
          </button>
        )}
      </header>
      <div className="g-bb">{children}</div>
    </section>
  )
}

export function Bar({ pct, hot }: { pct: number; hot?: boolean }) {
  return (
    <span className="g-bar" aria-hidden="true">
      <i className={hot ? 'hot' : undefined} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
    </span>
  )
}

export function Crumbs({ items }: { items: { label: string; onClick?: () => void }[] }) {
  return (
    <nav className="g-crumbs" aria-label="Ścieżka">
      {items.map((it, i) => (
        <span key={it.label}>
          {i > 0 && <Icon name="chevron" />}
          {it.onClick ? (
            <button type="button" onClick={it.onClick}>
              {it.label}
            </button>
          ) : (
            <span aria-current="page">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

/** The folder's switched-on modules, in the order the person arranged them. */
export function installedIn({ app }: Ctx, folder: FolderId): ModuleDef[] {
  return applyOrder(modulesInFolder(folder, app.onboarding?.os, app.linuxProfile), app.moduleOrder[folder]).filter((m) =>
    app.installedSet.has(m.id),
  )
}

/** What the portal can say about a module without asking it anything; `hot` marks bytes to reclaim. */
export function readingOf(m: ModuleDef, { reclaim, machine }: Ctx): { text: string; hot: boolean } | null {
  const hit = reclaim.foundOf(m.id)
  if (hit) return hit.error || hit.bytes === null ? { text: 'nie odczytano', hot: false } : { text: size(hit.bytes), hot: true }
  if (m.id === 'disk-map' && machine.mainDisk)
    return { text: `${machine.mainDisk.mount_point} · ${usedPct(machine.mainDisk).toFixed(0)}%`, hot: false }
  if (m.id === 'health-monitor' && machine.cpu)
    return {
      text: [`CPU ${machine.cpu.value.toFixed(0)}%`, machine.temp && `${machine.temp.value.toFixed(0)} °C`].filter(Boolean).join(' · '),
      hot: false,
    }
  return null
}
