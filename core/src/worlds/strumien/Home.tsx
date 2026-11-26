/**
 * The home feed: the machine now, what could be reclaimed, every volume,
 * memory, and the shortcuts last. Readings come from the shared machine
 * hooks; nothing here deletes anything.
 */
import { useMemo } from 'react'
import type { AppState } from '../../state/appState'
import type { SettingsState } from '../../state/settings'
import { catalogNumbers, moduleById, orderedModules, type ModuleDef } from '../../data/modules'
import {
  DISK_WARN_PCT, UP_TO_ONE, gb, size, systemName, useMachine, usedPct, type DiskInfo, type ReclaimState,
} from '../../state/machine'
import { t } from '../../i18n'
import { Feed, type FeedAction, type FeedItem } from './Feed'
import { CpuField, FillField, SquareField, StripeField, Waffle, cpuScale } from './visuals'

const pad2 = (n: number) => String(n).padStart(2, '0')
const pct = (v: number) => `${Math.round(v)} %`

/** btrfs subvolumes report the same device and size, container overlays report zero; one item per real volume. */
function volumes(disks: DiskInfo[]): DiskInfo[] {
  const seen = new Set<string>()
  return disks.filter((d) => {
    if (d.total_bytes <= 0) return false
    const id = `${d.name}|${d.total_bytes}`
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

export function Home({
  app, settings, reclaim, paused,
}: {
  app: AppState
  settings: SettingsState
  reclaim: ReclaimState
  paused: boolean
}) {
  const { setView, installedSet, onboarding, moduleOrder, linuxProfile } = app
  const os = onboarding?.os
  const s = settings.settings
  const m = useMachine(s.refreshMs)
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const has = (id: string) => installedSet.has(id)
  const open = (moduleId: string, param?: string) => setView({ kind: 'module', moduleId, param })
  const system = systemName(app)
  const last = m.record.samples[m.record.samples.length - 1] ?? []
  const busiest = last.length ? last.indexOf(Math.max(...last)) : -1
  const every = t('world.strumien.home.every', { every: UP_TO_ONE.format(s.refreshMs / 1000) })

  function toggleCore(c: number) {
    const w = s.watchedCores
    settings.set('watchedCores', w.includes(c) ? w.filter((x) => x !== c) : [...w, c])
  }

  // ------------------------------------------------------------- 1 machine
  const machineText = (() => {
    if (!m.info && m.error) return t('world.strumien.home.machine.text.error', { error: m.error })
    if (!m.info) return t('world.strumien.home.machine.text.waiting')
    const parts = [m.ram?.detail && t('world.strumien.home.machine.text.memory', { detail: m.ram.detail })]
    const full = m.disks.filter((d) => usedPct(d) >= DISK_WARN_PCT)
    if (full.length) parts.push(t('world.strumien.home.machine.text.disk-full', { mount: full[0].mount_point, pct: pct(usedPct(full[0])) }))
    else parts.push(t('world.strumien.home.machine.text.scroll'))
    return parts.filter(Boolean).join(' ')
  })()

  const machine: FeedItem = {
    id: 'machine',
    field: 'machine',
    peek: t('world.strumien.home.machine.peek'),
    source: t('world.strumien.home.machine.source'),
    note: m.error && m.info ? t('world.strumien.home.machine.note.failed') : t('world.strumien.home.machine.note.live', { every }),
    figure: m.cpu ? pct(m.cpu.value) : '—',
    figureNote: m.coreCount ? t('world.strumien.home.machine.figure-note', { n: m.coreCount }) : t('world.strumien.home.machine.figure-note.plain'),
    title: m.info
      ? [system, m.cpu && t('world.strumien.home.machine.title.cpu', { pct: pct(m.cpu.value) }), m.ram && t('world.strumien.home.machine.title.memory', { pct: pct(m.ram.value) }), m.temp && `${Math.round(m.temp.value)} °C`]
          .filter(Boolean)
          .join(' · ')
      : m.error
        ? t('world.strumien.home.machine.title.failed')
        : system,
    text: machineText,
    visual: <CpuField samples={m.record.samples} watched={s.watchedCores} />,
    overlay: last.length > 0 && (
      <>
        <div className="sm-legend">
          <span><i className="sm-key sm-key--mean" />{t('world.strumien.home.machine.legend.mean')} <b>{m.cpu ? pct(m.cpu.value) : '—'}</b></span>
          {busiest >= 0 && (
            <span><i className="sm-key sm-key--peak" />{t('world.strumien.home.machine.legend.busiest', { core: pad2(busiest) })} <b>{pct(last[busiest])}</b></span>
          )}
          <span>{t('world.strumien.home.machine.legend.scale', { max: cpuScale(m.record.samples) })}</span>
        </div>
        <div className="sm-cores" role="group" aria-label={t('world.strumien.home.machine.cores-group')}>
          {last.map((v, c) => (
            <button
              key={c}
              type="button"
              className="sm-core"
              aria-pressed={s.watchedCores.includes(c)}
              aria-label={t('world.strumien.home.machine.core', { core: pad2(c), pct: pct(v) })}
              title={t('world.strumien.home.machine.core', { core: pad2(c), pct: pct(v) })}
              onClick={() => toggleCore(c)}
            >
              <i style={{ height: `${Math.max(2, v)}%` }} />
            </button>
          ))}
        </div>
      </>
    ),
    actions: [
      {
        key: 's',
        label: t('world.strumien.home.check'),
        glyph: 'search',
        primary: true,
        disabled: reclaim.sources.length === 0 || reclaim.reclaim.kind === 'scanning',
        run: (nav) => {
          void reclaim.check()
          nav.goTo('reclaim')
        },
      },
      ...(has('health-monitor') ? [{ key: 'd', label: t('world.strumien.home.machine.details'), glyph: 'pulse', run: () => open('health-monitor') } as FeedAction] : []),
      { key: 'y', label: t('world.strumien.home.disks'), glyph: 'diskmap', count: String(volumes(m.disks).length || '—'), run: (nav) => nav.goTo('disk-0') },
    ],
    tour: { caption: 'machine', overlay: 'cpu' },
  }

  // ------------------------------------------------------------- 2 reclaim
  const reclaimItems = buildReclaim(reclaim, numbers, (id) => moduleById(id, linuxProfile), open, () => setView({ kind: 'manager' }))

  // ------------------------------------------------------------- 3 volumes
  const disks: FeedItem[] = volumes(m.disks).map((d, i) => {
    const used = usedPct(d)
    const full = used >= DISK_WARN_PCT
    const kind = d.solid_state === undefined ? null : d.solid_state ? 'SSD' : 'HDD'
    const actions: FeedAction[] = []
    if (has('disk-map')) actions.push({ key: 'm', label: t('module.disk-map.name'), glyph: 'diskmap', primary: full, run: () => open('disk-map', d.mount_point) })
    if (has('big-files')) actions.push({ key: 'l', label: t('world.strumien.home.disk.big-files'), glyph: 'search', run: () => open('big-files') })
    actions.push({ key: 'n', label: t('world.strumien.next'), glyph: 'down', run: (nav) => nav.next() })
    return {
      id: `disk-${i}`,
      field: full ? 'full' : 'disk',
      peek: t('world.strumien.home.disk.peek', { mount: d.mount_point }),
      source: t('world.strumien.home.disk.source', { i: i + 1, n: volumes(m.disks).length }),
      note: full ? t('world.strumien.home.disk.note.full') : [kind, d.model].filter(Boolean).join(' · ') || undefined,
      figure: pct(used),
      figureNote: t('world.strumien.home.disk.figure-note'),
      title: <span className="sm-path">{d.mount_point}</span>,
      text: t(full ? 'world.strumien.home.disk.text.full' : 'world.strumien.home.disk.text', { free: gb(d.available_bytes), total: gb(d.total_bytes) }),
      visual: <FillField pct={used} />,
      actions,
    }
  })
  if (!m.info) {
    disks.push({
      id: 'disk-0',
      field: 'disk',
      peek: t('world.strumien.home.disks'),
      source: t('world.strumien.home.disks'),
      figure: '—',
      title: m.error ? t('world.strumien.home.disk.none.title') : t('world.strumien.home.disk.none.waiting'),
      text: m.error ? t('world.strumien.home.disk.none.error', { error: m.error }) : undefined,
      visual: <FillField pct={0} />,
      actions: [{ key: 'n', label: t('world.strumien.next'), glyph: 'down', run: (nav) => nav.next() }],
    })
  }

  // ------------------------------------------------------------- 4 memory
  const memory: FeedItem[] = m.ram
    ? [
        {
          id: 'memory',
          field: 'mem',
          peek: t('world.strumien.home.memory'),
          source: t('world.strumien.home.memory'),
          note: every,
          figure: pct(m.ram.value),
          figureNote: t('world.strumien.home.memory.figure-note'),
          title: m.ram.detail ?? t('world.strumien.home.memory.title'),
          text: t('world.strumien.home.memory.text'),
          visual: <Waffle pct={m.ram.value} />,
          actions: has('health-monitor')
            ? [{ key: 'd', label: t('world.strumien.home.memory.processes'), glyph: 'pulse', run: () => open('health-monitor') }]
            : [{ key: 'n', label: t('world.strumien.next'), glyph: 'down', run: (nav) => nav.next() }],
        },
      ]
    : []

  // ------------------------------------------------------------- 5 shortcuts
  const quick = orderedModules(os, moduleOrder, linuxProfile).filter((q) => has(q.id) && q.quickAction)
  const enabled = [...numbers.keys()].filter(has).length
  const off = numbers.size - enabled
  const shortcuts: FeedItem = {
    id: 'index',
    field: 'index',
    peek: t('world.strumien.home.shortcuts'),
    source: t('world.strumien.home.shortcuts'),
    note: off > 0 ? t('world.strumien.home.shortcuts.off', { n: off }) : undefined,
    figure: String(quick.length),
    figureNote: t('world.strumien.home.shortcuts.figure-note', { n: quick.length }),
    title: quick.length ? t('world.strumien.home.shortcuts.title') : t('world.strumien.home.shortcuts.title.none'),
    body: quick.length > 0 && (
      <ul className="sm-quick" data-tour="index">
        {quick.map((q) => (
          <li key={q.id}>
            <button type="button" className={`sm-quick__row sm-field--${q.folder}`} onClick={() => open(q.id)}>
              <span className="sm-quick__no">{numbers.get(q.id)}</span>
              <span>{q.quickAction}</span>
              <em>{q.name}</em>
            </button>
          </li>
        ))}
      </ul>
    ),
    visual: <StripeField fields={quick.length ? quick.map((q) => q.folder) : ['index']} />,
    actions: [{ key: 'z', label: t('page.manager'), glyph: 'manager', primary: quick.length === 0, run: () => setView({ kind: 'manager' }) }],
    tour: quick.length ? undefined : { caption: 'index' },
  }

  const items = [machine, ...reclaimItems, ...disks, ...memory, shortcuts]
  return <Feed items={items} label={t('world.strumien.home.feed-label')} paused={paused} />
}

function buildReclaim(
  r: ReclaimState,
  numbers: Map<string, string>,
  mod: (id: string) => ModuleDef | undefined,
  open: (id: string) => void,
  manage: () => void,
): FeedItem[] {
  const { reclaim, sources, found, total } = r
  const names = sources.map((s) => s.name).join(', ')
  const check: FeedAction = {
    key: 's',
    label: reclaim.kind === 'scanning' ? t('world.strumien.home.reclaim.checking') : reclaim.kind === 'done' ? t('world.strumien.home.reclaim.check-again') : t('world.strumien.home.check'),
    glyph: reclaim.kind === 'done' ? 'refresh' : 'search',
    primary: reclaim.kind !== 'done',
    disabled: reclaim.kind === 'scanning',
    run: () => void r.check(),
  }

  if (sources.length === 0) {
    return [
      {
        id: 'reclaim',
        field: 'data',
        peek: t('world.strumien.home.reclaim.peek'),
        source: t('world.strumien.home.reclaim.peek'),
        figure: '—',
        title: t('world.strumien.home.reclaim.none.title'),
        text: t('world.strumien.home.reclaim.none.text'),
        visual: <StripeField fields={['data']} />,
        actions: [{ key: 'z', label: t('page.manager'), glyph: 'manager', primary: true, run: manage }],
        tour: { group: 'reclaim' },
      },
    ]
  }

  if (reclaim.kind !== 'done') {
    const scanning = reclaim.kind === 'scanning'
    return [
      {
        id: 'reclaim',
        field: 'data',
        peek: t('world.strumien.home.reclaim.peek'),
        source: t('world.strumien.home.reclaim.peek'),
        note: t('world.strumien.home.reclaim.note'),
        figure: scanning ? `${reclaim.done} / ${sources.length}` : String(sources.length),
        figureNote: scanning ? t('world.strumien.home.reclaim.figure-note.scanning') : t('world.strumien.home.reclaim.figure-note.idle', { n: sources.length }),
        title: scanning ? t('world.strumien.home.reclaim.title.scanning') : t('world.strumien.home.reclaim.title.idle'),
        text: t('world.strumien.home.reclaim.text.idle', { names }),
        visual: (
          <SquareField
            tiles={sources.map((s, i) => ({
              key: s.id,
              size: 1,
              label: `${numbers.get(s.id)} · ${s.name}`,
              quiet: !scanning || i >= reclaim.done,
            }))}
          />
        ),
        actions: [check],
        tour: { group: 'reclaim' },
      },
    ]
  }

  const readable = found.filter((f) => f.bytes !== null && !f.error)
  // A zero-byte answer still deserves a tile the eye can find.
  const floor = Math.max(total * 0.006, 1)
  const tiles = (hot?: string) =>
    found.map((f) => ({
      key: f.id,
      size: Math.max(f.bytes ?? 0, floor),
      label: mod(f.id)?.name ?? f.id,
      sub: f.error ? t('world.strumien.home.reclaim.unread') : size(f.bytes ?? 0),
      hot: hot === undefined ? !f.error : f.id === hot,
      quiet: hot !== undefined && f.id !== hot,
    }))

  const summary: FeedItem = {
    id: 'reclaim',
    field: 'data',
    peek: t('world.strumien.home.reclaim.peek'),
    source: t('world.strumien.home.reclaim.peek'),
    note: t('world.strumien.home.reclaim.note'),
    figure: size(total),
    figureNote: t('world.strumien.home.reclaim.figure-note.done'),
    title:
      found.length === 0
        ? t('world.strumien.home.reclaim.title.zero')
        : t('world.strumien.home.reclaim.title.found', { n: readable.length }),
    text: t('world.strumien.home.reclaim.text.done'),
    visual: <SquareField tiles={tiles()} />,
    actions: [
      ...(found.length ? [{ key: 'n', label: t('world.strumien.home.reclaim.one-by-one'), glyph: 'down', primary: true, run: (nav) => nav.next() } as FeedAction] : []),
      check,
    ],
    tour: { group: 'reclaim' },
  }

  const each: FeedItem[] = [...found]
    .sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1))
    .map((f) => {
      const def = mod(f.id)
      return {
        id: `found-${f.id}`,
        field: def?.folder ?? 'data',
        peek: `${numbers.get(f.id)} ${def?.name ?? f.id}`,
        source: `${numbers.get(f.id)} · ${def?.name ?? f.id}`,
        note: t('world.strumien.home.reclaim.note.last'),
        figure: f.error ? '—' : size(f.bytes ?? 0),
        figureNote: f.error ? t('world.strumien.home.reclaim.unread') : t('world.strumien.home.reclaim.figure-note.done'),
        title: def?.quickAction ?? def?.name ?? f.id,
        text: f.error ? t('world.strumien.home.reclaim.text.error', { error: f.error }) : def?.desc,
        visual: <SquareField tiles={tiles(f.id)} />,
        actions: [
          { key: 'o', label: t('world.strumien.home.reclaim.open'), glyph: 'open', primary: true, run: () => open(f.id) },
          { key: 'p', label: t('world.strumien.home.reclaim.later'), glyph: 'clock', run: (nav) => nav.next() },
        ],
      }
    })

  return [summary, ...each]
}
