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
  DISK_WARN_PCT, UP_TO_ONE, gb, plural, size, systemName, useMachine, usedPct, type DiskInfo, type ReclaimState,
} from '../../state/machine'
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
  const every = `odczyt co ${UP_TO_ONE.format(s.refreshMs / 1000)} s`

  function toggleCore(c: number) {
    const w = s.watchedCores
    settings.set('watchedCores', w.includes(c) ? w.filter((x) => x !== c) : [...w, c])
  }

  // ------------------------------------------------------------- 1 machine
  const machineText = (() => {
    if (!m.info && m.error) return `Moduł system-info nie odpowiada: ${m.error}`
    if (!m.info) return 'Czekam na pierwszy odczyt.'
    const parts = [m.ram?.detail && `Pamięć ${m.ram.detail}.`]
    const full = m.disks.filter((d) => usedPct(d) >= DISK_WARN_PCT)
    if (full.length) parts.push(`Dysk ${full[0].mount_point} jest zajęty w ${pct(usedPct(full[0]))} — przewiń w dół, a strumień pokaże go z bliska.`)
    else parts.push('Przewiń w dół: po kolei to, co da się odzyskać, dyski i pamięć.')
    return parts.filter(Boolean).join(' ')
  })()

  const machine: FeedItem = {
    id: 'machine',
    field: 'machine',
    peek: 'Ta maszyna',
    source: '000 · Ta maszyna',
    note: m.error && m.info ? `ostatni odczyt się nie udał` : `na żywo, ${every}`,
    figure: m.cpu ? pct(m.cpu.value) : '—',
    figureNote: m.coreCount ? `procesor, średnio z ${m.coreCount} ${plural(m.coreCount, 'rdzenia', 'rdzeni', 'rdzeni')}` : 'procesor',
    title: m.info
      ? [system, m.cpu && `procesor ${pct(m.cpu.value)}`, m.ram && `pamięć ${pct(m.ram.value)}`, m.temp && `${Math.round(m.temp.value)} °C`]
          .filter(Boolean)
          .join(' · ')
      : m.error
        ? 'Nie udało się odczytać stanu maszyny'
        : system,
    text: machineText,
    visual: <CpuField samples={m.record.samples} watched={s.watchedCores} />,
    overlay: last.length > 0 && (
      <>
        <div className="sm-legend">
          <span><i className="sm-key sm-key--mean" />średnia <b>{m.cpu ? pct(m.cpu.value) : '—'}</b></span>
          {busiest >= 0 && (
            <span><i className="sm-key sm-key--peak" />najbardziej zajęty, rdzeń {pad2(busiest)} <b>{pct(last[busiest])}</b></span>
          )}
          <span>skala 0–{cpuScale(m.record.samples)} %</span>
        </div>
        <div className="sm-cores" role="group" aria-label="Rdzenie teraz — kliknij, by obserwować">
          {last.map((v, c) => (
            <button
              key={c}
              type="button"
              className="sm-core"
              aria-pressed={s.watchedCores.includes(c)}
              aria-label={`Rdzeń ${pad2(c)}: ${pct(v)}`}
              title={`Rdzeń ${pad2(c)}: ${pct(v)}`}
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
        label: 'Sprawdź, co da się odzyskać',
        glyph: 'search',
        primary: true,
        disabled: reclaim.sources.length === 0 || reclaim.reclaim.kind === 'scanning',
        run: (nav) => {
          void reclaim.check()
          nav.goTo('reclaim')
        },
      },
      ...(has('health-monitor') ? [{ key: 'd', label: 'Szczegóły', glyph: 'pulse', run: () => open('health-monitor') } as FeedAction] : []),
      { key: 'y', label: 'Dyski', glyph: 'diskmap', count: String(volumes(m.disks).length || '—'), run: (nav) => nav.goTo('disk-0') },
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
    if (has('disk-map')) actions.push({ key: 'm', label: 'Mapa dysków', glyph: 'diskmap', primary: full, run: () => open('disk-map', d.mount_point) })
    if (has('big-files')) actions.push({ key: 'l', label: 'Duże pliki', glyph: 'search', run: () => open('big-files') })
    actions.push({ key: 'n', label: 'Dalej', glyph: 'down', run: (nav) => nav.next() })
    return {
      id: `disk-${i}`,
      field: full ? 'full' : 'disk',
      peek: `Dysk ${d.mount_point}`,
      source: `Dysk ${i + 1} z ${volumes(m.disks).length}`,
      note: full ? 'prawie pełny' : [kind, d.model].filter(Boolean).join(' · ') || undefined,
      figure: pct(used),
      figureNote: 'zajęte',
      title: <span className="sm-path">{d.mount_point}</span>,
      text: `${gb(d.available_bytes)} wolnego z ${gb(d.total_bytes)}.${full ? ' Mapa dysków pokaże, co zajmuje miejsce.' : ''}`,
      visual: <FillField pct={used} />,
      actions,
    }
  })
  if (!m.info) {
    disks.push({
      id: 'disk-0',
      field: 'disk',
      peek: 'Dyski',
      source: 'Dyski',
      figure: '—',
      title: m.error ? 'Brak odczytu dysków' : 'Czekam na odczyt dysków',
      text: m.error ? `system-info nie odpowiada: ${m.error}` : undefined,
      visual: <FillField pct={0} />,
      actions: [{ key: 'n', label: 'Dalej', glyph: 'down', run: (nav) => nav.next() }],
    })
  }

  // ------------------------------------------------------------- 4 memory
  const memory: FeedItem[] = m.ram
    ? [
        {
          id: 'memory',
          field: 'mem',
          peek: 'Pamięć',
          source: 'Pamięć',
          note: every,
          figure: pct(m.ram.value),
          figureNote: 'pamięci zajęte',
          title: m.ram.detail ?? 'Pamięć operacyjna',
          text: 'Każda kratka to pół procenta pamięci. Zajęte zapalają się od dołu.',
          visual: <Waffle pct={m.ram.value} />,
          actions: has('health-monitor')
            ? [{ key: 'd', label: 'Procesy', glyph: 'pulse', run: () => open('health-monitor') }]
            : [{ key: 'n', label: 'Dalej', glyph: 'down', run: (nav) => nav.next() }],
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
    peek: 'Skróty',
    source: 'Skróty',
    note: off > 0 ? `${off} ${plural(off, 'moduł niewłączony', 'moduły niewłączone', 'modułów niewłączonych')}` : undefined,
    figure: String(quick.length),
    figureNote: plural(quick.length, 'skrót', 'skróty', 'skrótów'),
    title: quick.length ? 'Główne akcje włączonych modułów' : 'Nie masz jeszcze włączonych modułów z szybkimi akcjami',
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
    actions: [{ key: 'z', label: 'Zarządzanie modułami', glyph: 'manager', primary: quick.length === 0, run: () => setView({ kind: 'manager' }) }],
    tour: quick.length ? undefined : { caption: 'index' },
  }

  const items = [machine, ...reclaimItems, ...disks, ...memory, shortcuts]
  return <Feed items={items} label="Strumień: wszystko" paused={paused} />
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
    label: reclaim.kind === 'scanning' ? 'Sprawdzam' : reclaim.kind === 'done' ? 'Sprawdź ponownie' : 'Sprawdź, co da się odzyskać',
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
        peek: 'Ile da się odzyskać',
        source: 'Ile da się odzyskać',
        figure: '—',
        title: 'Żaden włączony moduł nie zwalnia miejsca na dysku',
        text: 'Włącz Czyszczenie Temp, cache pakietów albo przycinanie logów, a strumień zapyta je o miejsce.',
        visual: <StripeField fields={['data']} />,
        actions: [{ key: 'z', label: 'Zarządzanie modułami', glyph: 'manager', primary: true, run: manage }],
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
        peek: 'Ile da się odzyskać',
        source: 'Ile da się odzyskać',
        note: 'tylko odczyt',
        figure: scanning ? `${reclaim.done} / ${sources.length}` : String(sources.length),
        figureNote: scanning ? 'modułów odpowiedziało' : `${plural(sources.length, 'moduł', 'moduły', 'modułów')} do zapytania`,
        title: scanning ? 'Sprawdzam, ile miejsca zwolnią moduły' : 'Ile da się odzyskać?',
        text: `Jeden przycisk pyta: ${names}. To tylko odczyt — usuwasz zawsze w module, po jego potwierdzeniu.`,
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
      sub: f.error ? 'nie odczytano' : size(f.bytes ?? 0),
      hot: hot === undefined ? !f.error : f.id === hot,
      quiet: hot !== undefined && f.id !== hot,
    }))

  const summary: FeedItem = {
    id: 'reclaim',
    field: 'data',
    peek: 'Ile da się odzyskać',
    source: 'Ile da się odzyskać',
    note: 'tylko odczyt',
    figure: size(total),
    figureNote: 'do odzyskania',
    title:
      found.length === 0
        ? 'Żaden moduł nie znalazł nic do zwolnienia'
        : `${readable.length} ${plural(readable.length, 'moduł znalazł', 'moduły znalazły', 'modułów znalazło')} miejsce do zwolnienia`,
    text: 'Przewiń w dół: każdy moduł po kolei, od największego. Nic nie znika, dopóki nie potwierdzisz w module.',
    visual: <SquareField tiles={tiles()} />,
    actions: [
      ...(found.length ? [{ key: 'n', label: 'Po kolei', glyph: 'down', primary: true, run: (nav) => nav.next() } as FeedAction] : []),
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
        note: 'z ostatniego sprawdzenia',
        figure: f.error ? '—' : size(f.bytes ?? 0),
        figureNote: f.error ? 'nie odczytano' : 'do odzyskania',
        title: def?.quickAction ?? def?.name ?? f.id,
        text: f.error ? `Moduł nie odpowiedział: ${f.error}` : def?.desc,
        visual: <SquareField tiles={tiles(f.id)} />,
        actions: [
          { key: 'o', label: 'Otwórz moduł', glyph: 'open', primary: true, run: () => open(f.id) },
          { key: 'p', label: 'Później', glyph: 'clock', run: (nav) => nav.next() },
        ],
      }
    })

  return [summary, ...each]
}
