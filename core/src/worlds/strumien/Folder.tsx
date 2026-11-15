/** A folder as its own feed: one installed module per item, in the order the person arranged. */
import type { AppState } from '../../state/appState'
import { applyOrder, catalogNumbers, folderNumber, folders, modulesInFolder, riskLabel, type FolderId } from '../../data/modules'
import { plural, size, type ReclaimState } from '../../state/machine'
import { Feed, type FeedItem } from './Feed'
import { PatternField, SquareField, StripeField } from './visuals'

/** Share of lit cells in a module's field: the riskier, the denser. */
export const RISK_DENSITY = { low: 0.18, medium: 0.36, critical: 0.62 } as const

export function Folder({
  app, folderId, reclaim, paused,
}: {
  app: AppState
  folderId: string
  reclaim: ReclaimState
  paused: boolean
}) {
  const { setView, installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const folder = folders.find((f) => f.id === folderId)
  if (!folder) {
    return (
      <div className="sm-page">
        <div className="empty-state">
          Nie ma takiego folderu.
          <br />
          <button className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>Wróć do strumienia</button>
        </div>
      </div>
    )
  }
  const no = folderNumber(folder.id)
  const numbers = catalogNumbers(os, linuxProfile)
  const all = applyOrder(modulesInFolder(folder.id as FolderId, os, linuxProfile), moduleOrder[folder.id])
  const mods = all.filter((m) => installedSet.has(m.id))
  const off = all.length - mods.length

  const items: FeedItem[] = mods.map((m, i) => {
    const hit = reclaim.foundOf(m.id)
    return {
      id: m.id,
      field: folder.id,
      peek: `${numbers.get(m.id)} ${m.name}`,
      source: `${no} · ${folder.name}`,
      note: `${i + 1}. z ${mods.length}`,
      figure: numbers.get(m.id) ?? '—',
      figureNote: hit?.bytes != null ? `${size(hit.bytes)} do odzyskania` : riskLabel[m.risk],
      title: m.name,
      text: m.quickAction ? `${m.desc} Główna akcja: ${m.quickAction.toLowerCase()}.` : m.desc,
      visual:
        hit?.bytes != null ? (
          <SquareField
            tiles={reclaim.found.map((f) => ({
              key: f.id,
              size: Math.max(f.bytes ?? 0, reclaim.total * 0.006, 1),
              label: '',
              hot: f.id === m.id,
              quiet: f.id !== m.id,
            }))}
          />
        ) : (
          <PatternField seed={m.id} density={RISK_DENSITY[m.risk]} />
        ),
      actions: [
        { key: 'o', label: 'Otwórz', glyph: 'open', primary: true, run: () => setView({ kind: 'module', moduleId: m.id }) },
        { key: 'n', label: 'Dalej', glyph: 'down', run: (nav) => nav.next() },
      ],
    }
  })

  if (items.length === 0) {
    items.push({
      id: 'empty',
      field: folder.id,
      peek: folder.name,
      source: `${no} · ${folder.name}`,
      figure: no,
      figureNote: folder.name,
      title: 'W tym folderze nic nie jest włączone',
      text:
        off > 0
          ? `Czeka tu ${off} ${plural(off, 'moduł', 'moduły', 'modułów')} — włączysz je w Zarządzaniu modułami.`
          : 'Ten system nie ma w tym folderze żadnych modułów.',
      visual: <StripeField fields={[folder.id]} />,
      actions: [{ key: 'z', label: 'Zarządzanie modułami', glyph: 'manager', primary: true, run: () => setView({ kind: 'manager' }) }],
    })
  }

  return <Feed key={folder.id} items={items} label={`Folder ${no} ${folder.name}`} tour="folder-list" paused={paused} />
}
