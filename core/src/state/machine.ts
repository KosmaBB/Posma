/**
 * What every world's home screen reads from the machine: live readings from
 * system-info and the read-only "how much could be reclaimed" check. Worlds
 * draw these differently; the numbers and their wording rules live here once.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AppState } from './appState'
import { catalogNumbers, moduleById, type ModuleDef } from '../data/modules'
import { callModule } from '../data/callModule'

export interface DiskInfo {
  name: string
  mount_point: string
  total_bytes: number
  available_bytes: number
  model?: string
  solid_state?: boolean
}

/**
 * One reading the machine was willing to give up. Everything past `value`
 * is optional because the sidecar omits what it cannot obtain — a metric
 * that is missing simply is not in the array.
 */
export interface Metric {
  id: string
  label: string
  value: number
  unit: string
  percent?: number
  detail?: string
  kind: 'load' | 'capacity' | 'temperature' | 'power'
  group?: string
}

export interface SystemInfo {
  metrics: Metric[]
  disks: DiskInfo[]
  /** Load of each core. Absent from a sidecar older than the per-core profile. */
  cores?: number[]
}

/** Readings kept for the plot. How long that covers depends on the chosen
 * refresh rate, which is the point: the plot holds the same number of
 * readings either way. */
export const HISTORY = 60
/** Above this, a disk is worth pointing at rather than just listing. */
export const DISK_WARN_PCT = 90
/** journald-trim's middle size preset — what a cautious trim keeps. */
const JOURNAL_KEEP = 500 * 1024 ** 2

const OS_NAME = { windows: 'Windows', linux: 'Linux', macos: 'macOS' } as const

const ONE_DECIMAL = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
export const UP_TO_ONE = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
const PLURAL = new Intl.PluralRules('pl')

/** Polish noun form for a count: 1 rdzeń, 2 rdzenie, 5 rdzeni. */
export function plural(n: number, one: string, few: string, many: string): string {
  const form = PLURAL.select(n)
  return form === 'one' ? one : form === 'few' ? few : many
}

export function gb(bytes: number): string {
  return `${ONE_DECIMAL.format(bytes / 1024 ** 3)} GB`
}

export function size(bytes: number): string {
  return bytes >= 1024 ** 3 ? gb(bytes) : `${Math.round(bytes / 1024 ** 2)} MB`
}

/** "341,0 z 512,0 GB · 67%" */
export function fill(d: DiskInfo): string {
  const used = (d.total_bytes - d.available_bytes) / 1024 ** 3
  return `${ONE_DECIMAL.format(used)} z ${gb(d.total_bytes)} · ${usedPct(d).toFixed(0)}%`
}

export function usedPct(d: DiskInfo): number {
  if (d.total_bytes === 0) return 0
  return ((d.total_bytes - d.available_bytes) / d.total_bytes) * 100
}

/** "CachyOS · arch" on Linux, the OS name elsewhere. */
export function systemName(app: AppState): string {
  const os = app.onboarding?.os
  const p = app.linuxProfile
  if (os === 'linux') return [p?.name, p?.family].filter(Boolean).join(' · ') || 'Linux'
  return os ? OS_NAME[os] : '—'
}

/** Live readings, polled at the chosen refresh rate; a hidden window skips its ticks. */
export function useMachine(refreshMs: number) {
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [record, setRecord] = useState<{ samples: number[][]; tick: number }>({ samples: [], tick: 0 })

  useEffect(() => {
    let cancelled = false
    // A slow reading must not overlap the next tick, or the history gets samples out of order.
    let busy = false
    async function refresh() {
      // A hidden window needs no fresh numbers; the next tick after it shows catches up.
      if (document.hidden || busy) return
      busy = true
      try {
        const res = await callModule<SystemInfo>('system-info', { cmd: 'get_info' })
        if (cancelled) return
        if (!res.ok) {
          setError(res.error)
          return
        }
        setInfo(res.data)
        setError(null)
        const cores = res.data.cores
        if (cores?.length) setRecord((r) => ({ samples: [...r.samples, cores].slice(-HISTORY), tick: r.tick + 1 }))
      } catch (e) {
        if (!cancelled) setError(String(e))
      } finally {
        busy = false
      }
    }
    refresh()
    const timer = setInterval(refresh, refreshMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [refreshMs])

  const metrics = info?.metrics ?? []
  // Container layers (Docker, Podman) mount the same disk again under overlay paths, and
  // pseudo mounts report no size; neither is a drive.
  const disks = (info?.disks ?? []).filter(
    (d) => d.total_bytes > 0 && !/\/(overlay|overlayfs|overlay2)\//.test(d.mount_point),
  )
  const mainDisk = disks.find((d) => d.mount_point === '/' || d.mount_point.startsWith('C:')) ?? disks[0]
  return {
    info,
    error,
    record,
    metrics,
    disks,
    cpu: metrics.find((m) => m.id === 'cpu'),
    ram: metrics.find((m) => m.id === 'ram'),
    temp: metrics.find((m) => m.id === 'temp-cpu'),
    mainDisk,
    /** Volumes other than the main one that are nearly full. */
    crowded: disks.filter((d) => d !== mainDisk && usedPct(d) >= DISK_WARN_PCT),
    anyCrowded: disks.some((d) => usedPct(d) >= DISK_WARN_PCT),
    coreCount: record.samples[record.samples.length - 1]?.length ?? 0,
  }
}

export type Machine = ReturnType<typeof useMachine>

async function read<T>(module: string, cmd: string): Promise<T> {
  const res = await callModule<T>(module, { cmd })
  if (!res.ok) throw new Error(res.error)
  return res.data
}

interface Sized {
  id: string
  total_bytes: number
}
const sum = (cs: Sized[]) => cs.reduce((acc, c) => acc + c.total_bytes, 0)

/** The modules built on library-clean preselect everything that comes back by itself. */
async function libraryClean(module: string): Promise<number | null> {
  const d = await read<{ present: boolean; categories: (Sized & { recovery: string })[] }>(module, 'scan')
  return d.present ? sum(d.categories.filter((c) => c.recovery !== 'permanent')) : null
}

/**
 * What each cleaning module would free with its own default selection.
 * Read-only scans: nothing is deleted from a home screen, the rows lead to
 * the modules, which confirm before they touch anything. `null` means the
 * module has nothing to work on here. Mirrors the defaults in each module's
 * view — change one there, change it here.
 */
const RECLAIM: Record<string, () => Promise<number | null>> = {
  'temp-clean': async () => {
    const d = await read<{ categories: (Sized & { privileged: boolean })[] }>('temp-clean', 'scan')
    return sum(d.categories.filter((c) => !c.privileged && c.id !== 'appcache'))
  },
  'xcode-cache': () => libraryClean('xcode-cache'),
  'macos-slim': () => libraryClean('macos-slim'),
  'pkg-cache': async () => {
    const d = await read<{ unsupported: string | null; cache_bytes: number }>('pkg-cache', 'scan')
    return d.unsupported ? null : d.cache_bytes
  },
  'journald-trim': async () => {
    const d = await read<{ total_bytes: number; readable: boolean; unavailable: string | null }>('journald-trim', 'usage')
    return d.readable && !d.unavailable ? Math.max(0, d.total_bytes - JOURNAL_KEEP) : null
  },
  'browser-hygiene': async () => {
    const d = await read<{ categories: Sized[] }>('browser-hygiene', 'scan')
    return sum(d.categories.filter((c) => c.id !== 'cookies' && c.id !== 'history'))
  },
}

export interface ReclaimRow {
  id: string
  bytes: number | null
  error: string | null
}
export type Reclaim = { kind: 'idle' } | { kind: 'scanning'; done: number } | { kind: 'done'; rows: ReclaimRow[] }

/** The read-only reclaim check over every enabled cleaning module. */
export function useReclaim(app: AppState) {
  const { installedSet, onboarding, linuxProfile } = app
  const os = onboarding?.os
  const [reclaim, setReclaim] = useState<Reclaim>({ kind: 'idle' })
  const numbers = useMemo(() => catalogNumbers(os, linuxProfile), [os, linuxProfile])
  const sources: ModuleDef[] = [...numbers.keys()]
    .filter((id) => id in RECLAIM && installedSet.has(id))
    .map((id) => moduleById(id, linuxProfile)!)

  const running = useRef(false)

  async function check() {
    // A second press while scanning would reset the count under the first run.
    if (running.current) return
    running.current = true
    setReclaim({ kind: 'scanning', done: 0 })
    const rows = await Promise.all(
      sources.map(async ({ id }): Promise<ReclaimRow> => {
        try {
          return { id, bytes: await RECLAIM[id](), error: null }
        } catch (e) {
          return { id, bytes: null, error: String(e) }
        } finally {
          setReclaim((r) => (r.kind === 'scanning' ? { kind: 'scanning', done: r.done + 1 } : r))
        }
      }),
    )
    setReclaim({ kind: 'done', rows: rows.filter((r) => r.error || r.bytes !== null) })
    running.current = false
  }

  const enabled = new Set(sources.map((m) => m.id))
  const found = reclaim.kind === 'done' ? reclaim.rows.filter((r) => enabled.has(r.id)) : []
  return {
    reclaim,
    sources,
    check,
    found,
    total: found.reduce((acc, r) => acc + (r.bytes ?? 0), 0),
    foundOf: (id: string) => found.find((r) => r.id === id),
  }
}

export type ReclaimState = ReturnType<typeof useReclaim>
