/**
 * Module registry — the single source of truth for what modules exist,
 * which folder (group) they belong to and which OS supports them.
 * Mirrors POSMAv1 mind map: Folder 1 Dane|Pliki, 2 System, 3 Bezpieczeństwo,
 * 4 Aplikacje, 5 Custom.
 */


export type Os = 'windows' | 'linux' | 'macos'

export type FolderId = 'data' | 'system' | 'security' | 'apps' | 'custom'

export type Gradient = { g1: string; g2: string }

export { capabilitiesFor } from './capabilities'
import { has, t, type Key } from '../i18n'
import { BOOTLOADER_LABEL, DESKTOP_LABEL, EDITED_LOADERS, THEMED_DESKTOPS, label, type LinuxProfile } from './linuxProfile'

export const gradients = {
  teal: { g1: 'var(--g-teal-1)', g2: 'var(--g-teal-2)' },
  violet: { g1: 'var(--g-violet-1)', g2: 'var(--g-violet-2)' },
  blue: { g1: 'var(--g-blue-1)', g2: 'var(--g-blue-2)' },
  amber: { g1: 'var(--g-amber-1)', g2: 'var(--g-amber-2)' },
  red: { g1: 'var(--g-red-1)', g2: 'var(--g-red-2)' },
  green: { g1: 'var(--g-green-1)', g2: 'var(--g-green-2)' },
  indigo: { g1: 'var(--g-indigo-1)', g2: 'var(--g-indigo-2)' },
} satisfies Record<string, Gradient>

export interface ModuleFolder {
  id: FolderId
  name: string
  gradient: Gradient
  icon: string
}

/** A folder named in the language chosen now; a getter, so the name is read while rendering. */
function folder(id: FolderId, gradient: Gradient, icon: string): ModuleFolder {
  return { id, gradient, icon, get name() { return t(`folder.${id}`) } }
}

export const folders: ModuleFolder[] = [
  folder('data', gradients.teal, 'files'),
  folder('system', gradients.blue, 'system'),
  folder('security', gradients.green, 'shield'),
  folder('apps', gradients.red, 'apps'),
  folder('custom', gradients.violet, 'puzzle'),
]

export type ModuleRisk = 'low' | 'medium' | 'critical'

export interface ModuleDef {
  id: string
  name: string
  desc: string
  folder: FolderId
  os: Os[] // which systems support it; all three = cross-platform
  risk: ModuleRisk // mind map: "krytyczne i bardziej zagrażające błędami krytycznymi dla systemu z odpowiednim alertem"
  icon: string
  /** suggested quick action shown on the dashboard when installed */
  quickAction?: string
  /* Capabilities live in access/catalog.json, which the core enforces
     against. A copy here drifted from the manifests; use capabilitiesFor(). */
}

const ALL: Os[] = ['windows', 'linux', 'macos']

/** A module as registered; its name, description and quick action are in the i18n files, under module.<id>. */
type CatalogEntry = Omit<ModuleDef, 'name' | 'desc' | 'quickAction'>

const modules: CatalogEntry[] = [
  // ---- Folder 1: Dane | Pliki ----
  { id: 'temp-clean', folder: 'data', os: ALL, risk: 'low', icon: 'sweep' },
  { id: 'big-files', folder: 'data', os: ALL, risk: 'low', icon: 'search' },
  { id: 'duplicates', folder: 'data', os: ALL, risk: 'low', icon: 'duplicate' },
  { id: 'shredder', folder: 'data', os: ALL, risk: 'critical', icon: 'shredder' },
  { id: 'metadata', folder: 'data', os: ALL, risk: 'low', icon: 'tag' },
  { id: 'xcode-cache', folder: 'data', os: ['macos'], risk: 'low', icon: 'hammer' },
  { id: 'macos-slim', folder: 'data', os: ['macos'], risk: 'low', icon: 'scissors' },
  { id: 'pkg-cache', folder: 'data', os: ['linux'], risk: 'low', icon: 'package' },
  { id: 'journald-trim', folder: 'data', os: ['linux'], risk: 'low', icon: 'logs' },

  // ---- Folder 2: System ----
  { id: 'disk-map', folder: 'system', os: ALL, risk: 'low', icon: 'diskmap' },
  { id: 'autostart', folder: 'system', os: ['linux', 'windows'], risk: 'medium', icon: 'autostart' },
  { id: 'health-monitor', folder: 'system', os: ALL, risk: 'low', icon: 'pulse' },
  { id: 'winsxs', folder: 'system', os: ['windows'], risk: 'critical', icon: 'layers' },
  { id: 'services', folder: 'system', os: ['windows'], risk: 'critical', icon: 'gears' },
  { id: 'bloatware', folder: 'system', os: ['windows'], risk: 'critical', icon: 'trash' },
  { id: 'time-machine', folder: 'system', os: ['macos'], risk: 'medium', icon: 'clock' },
  { id: 'kernel-mgr', folder: 'system', os: ['linux'], risk: 'critical', icon: 'kernel' },
  { id: 'desktop-theme', folder: 'system', os: ['linux'], risk: 'low', icon: 'palette' },
  { id: 'grub-editor', folder: 'system', os: ['linux'], risk: 'critical', icon: 'boot' },

  // ---- Folder 3: Bezpieczeństwo ----
  { id: 'browser-hygiene', folder: 'security', os: ALL, risk: 'medium', icon: 'globe' },
  { id: 'vault', folder: 'security', os: ALL, risk: 'low', icon: 'vault' },

  // ---- Folder 4: Aplikacje ----
  { id: 'winget-ui', folder: 'apps', os: ['windows'], risk: 'low', icon: 'download' },
  { id: 'uninstaller', folder: 'apps', os: ['linux'], risk: 'medium', icon: 'apps' },
]

export const riskLabel: Record<ModuleRisk, string> = {
  get low() { return t('risk.low') },
  get medium() { return t('risk.medium') },
  get critical() { return t('risk.critical') },
}

function withTexts(m: CatalogEntry): ModuleDef {
  const action = `module.${m.id}.action`
  return {
    ...m,
    name: t(`module.${m.id}.name` as Key),
    desc: t(`module.${m.id}.desc` as Key),
    quickAction: has(action) ? t(action) : undefined,
  }
}

/**
 * A module as this particular system needs it described: the theming
 * module named after the desktop it themes, the package modules after the
 * manager they drive, and a module that cannot work here saying why. The
 * modules themselves adapt the same way — the profile reaches them too.
 */
export function adaptModule(entry: CatalogEntry, p: LinuxProfile | null): ModuleDef {
  const m = withTexts(entry)
  if (!p) return m
  const desktop = label(DESKTOP_LABEL, p.desktop)
  switch (m.id) {
    case 'desktop-theme':
      return p.desktop && THEMED_DESKTOPS.includes(p.desktop)
        ? { ...m, name: t('module.desktop-theme.name.desktop', { desktop: String(desktop) }), desc: t('module.desktop-theme.desc.desktop', { desktop: String(desktop) }) }
        : { ...m, desc: t('module.desktop-theme.desc.unsupported', { desktop: desktop ?? t('module.desktop-theme.no-desktop') }) }
    case 'grub-editor': {
      if (!p.bootloader || p.bootloader === 'grub') return m
      const loader = label(BOOTLOADER_LABEL, p.bootloader) ?? p.bootloader
      return EDITED_LOADERS.includes(p.bootloader)
        ? { ...m, name: t('module.grub-editor.name.loader', { loader }), desc: t('module.grub-editor.desc.loader', { loader }) }
        : { ...m, desc: t('module.grub-editor.desc.unsupported', { loader }) }
    }
    case 'pkg-cache':
      return p.family
        ? { ...m, name: t('module.pkg-cache.name.family', { family: p.family }), desc: t('module.pkg-cache.desc.family', { family: p.family }) }
        : { ...m, desc: p.family_unavailable ?? m.desc }
    case 'uninstaller':
      return p.family ? { ...m, desc: t('module.uninstaller.desc.family', { family: p.family }) } : m
    case 'journald-trim':
      return p.systemd ? m : { ...m, desc: t('module.journald-trim.desc.no-systemd') }
    default:
      return m
  }
}

export function modulesForOs(os: Os, profile: LinuxProfile | null = null): ModuleDef[] {
  return modules.filter((m) => m.os.includes(os)).map((m) => adaptModule(m, profile))
}

export function modulesInFolder(folder: FolderId, os?: Os, profile: LinuxProfile | null = null): ModuleDef[] {
  return modules.filter((m) => m.folder === folder && (!os || m.os.includes(os))).map((m) => adaptModule(m, profile))
}

/**
 * Catalog number per module: its folder's hundred plus its place in the
 * registry. Registry order rather than the user's arrangement, so a number
 * stays put when cards are dragged around.
 */
export function catalogNumbers(os?: Os, profile: LinuxProfile | null = null): Map<string, string> {
  const out = new Map<string, string>()
  folders.forEach((f, fi) =>
    modulesInFolder(f.id, os, profile).forEach((m, i) => out.set(m.id, String((fi + 1) * 100 + i + 1))),
  )
  return out
}

export function folderNumber(id: FolderId): string {
  return String((folders.findIndex((f) => f.id === id) + 1) * 100)
}

export function moduleById(id: string, profile: LinuxProfile | null): ModuleDef | undefined {
  const m = modules.find((mod) => mod.id === id)
  return m && adaptModule(m, profile)
}

/**
 * Applies a stored order to a catalog list.
 *
 * Ids the stored order does not mention keep their catalog position at the
 * end, so a module added in an update appears rather than vanishing because
 * nobody had dragged it yet. Ids that no longer exist are ignored.
 */
export function applyOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items
  const rank = new Map(order.map((id, i) => [id, i]))
  return [...items].sort((a, b) => {
    const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER
    const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER
    if (ra !== rb) return ra - rb
    return items.indexOf(a) - items.indexOf(b)
  })
}

/**
 * Every module for this system, in the order the user arranged it. Folders
 * keep catalog order; inside each, the order comes from the folder view.
 * Every surface reads this one list.
 */
export function orderedModules(
  os: Os | undefined,
  order: Record<string, string[]>,
  profile: LinuxProfile | null = null,
): ModuleDef[] {
  return folders.flatMap((f) => applyOrder(modulesInFolder(f.id, os, profile), order[f.id]))
}
