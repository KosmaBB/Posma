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

export const folders: ModuleFolder[] = [
  { id: 'data', name: 'Dane i pliki', gradient: gradients.teal, icon: 'files' },
  { id: 'system', name: 'System', gradient: gradients.blue, icon: 'system' },
  { id: 'security', name: 'Bezpieczeństwo', gradient: gradients.green, icon: 'shield' },
  { id: 'apps', name: 'Aplikacje', gradient: gradients.red, icon: 'apps' },
  { id: 'custom', name: 'Custom', gradient: gradients.violet, icon: 'puzzle' },
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

export const modules: ModuleDef[] = [
  // ---- Folder 1: Dane | Pliki ----
  { id: 'temp-clean', name: 'Czyszczenie Temp', desc: 'Skanowanie i kasowanie folderów tymczasowych systemu i aplikacji.', folder: 'data', os: ALL, risk: 'low', icon: 'sweep', quickAction: 'Przeskanuj pliki tymczasowe' },
  { id: 'big-files', name: 'Szukanie dużych plików', desc: 'Przeszukiwanie dysku i segregacja plików od największych do najmniejszych.', folder: 'data', os: ALL, risk: 'low', icon: 'search', quickAction: 'Znajdź największe pliki' },
  { id: 'duplicates', name: 'Szukanie duplikatów', desc: 'Wykrywanie identycznych plików na podstawie sum MD5/SHA-256.', folder: 'data', os: ALL, risk: 'low', icon: 'duplicate', quickAction: 'Wykryj duplikaty' },
  { id: 'shredder', name: 'Niszczarka plików', desc: 'Bezpowrotne kasowanie danych przez wielokrotne nadpisywanie.', folder: 'data', os: ALL, risk: 'critical', icon: 'shredder' },
  { id: 'metadata', name: 'Usuwanie metadanych', desc: 'Czyszczenie ukrytych informacji (GPS, autor) ze zdjęć i dokumentów.', folder: 'data', os: ALL, risk: 'low', icon: 'tag' },
  { id: 'xcode-cache', name: 'Czyszczenie Xcode', desc: 'Usuwanie plików tymczasowych DerivedData środowiska Xcode.', folder: 'data', os: ['macos'], risk: 'low', icon: 'hammer' },
  { id: 'macos-slim', name: 'Odchudzanie macOS', desc: 'Usuwanie załączników cache Mail i Messages bez utraty treści.', folder: 'data', os: ['macos'], risk: 'medium', icon: 'scissors' },
  { id: 'pkg-cache', name: 'Cache pakietów Linux', desc: 'Czyszczenie cache i osieroconych pakietów menedżera systemu (apt, pacman, dnf, zypper) oraz starych rewizji snap.', folder: 'data', os: ['linux'], risk: 'low', icon: 'package', quickAction: 'Wyczyść cache pakietów' },
  { id: 'journald-trim', name: 'Przycinanie logów systemd', desc: 'Czyszczenie logów journalctl do zadanego rozmiaru lub wieku.', folder: 'data', os: ['linux'], risk: 'low', icon: 'logs' },

  // ---- Folder 2: System ----
  { id: 'disk-map', name: 'Mapa dysków', desc: 'Graficzny podgląd zajętości dysku w postaci proporcjonalnych kafelków.', folder: 'system', os: ALL, risk: 'low', icon: 'diskmap', quickAction: 'Pokaż mapę dysku' },
  { id: 'autostart', name: 'Menadżer autostartu', desc: 'Podgląd i wyłączanie programów startujących z systemem.', folder: 'system', os: ['linux', 'windows'], risk: 'medium', icon: 'autostart', quickAction: 'Przejrzyj autostart' },
  { id: 'health-monitor', name: 'Monitor zdrowia', desc: 'CPU/RAM na żywo, czyszczenie cache i odczyt S.M.A.R.T. dysków.', folder: 'system', os: ALL, risk: 'low', icon: 'pulse' },
  { id: 'winsxs', name: 'Czyszczenie WinSxS', desc: 'Integracja z DISM — usuwanie starych wersji plików Windows Update.', folder: 'system', os: ['windows'], risk: 'critical', icon: 'layers' },
  { id: 'services', name: 'Menedżer usług', desc: 'Usługi Windows w gotowych profilach (telemetria, Xbox, drukowanie, mapy) zamiast listy setek pozycji.', folder: 'system', os: ['windows'], risk: 'critical', icon: 'gears' },
  { id: 'bloatware', name: 'Usuwanie Bloatware', desc: 'Usuwanie aplikacji Sklepu z tego konta, z zaznaczonymi fabrycznymi, po punkcie przywracania.', folder: 'system', os: ['windows'], risk: 'critical', icon: 'trash' },
  { id: 'time-machine', name: 'Time Machine', desc: 'Usuwanie lokalnych migawek Time Machine przez tmutil.', folder: 'system', os: ['macos'], risk: 'medium', icon: 'clock' },
  { id: 'kernel-mgr', name: 'Zarządzanie wersjami jądra', desc: 'Przegląd i usuwanie starych jąder z /boot, z blokadą aktywnego.', folder: 'system', os: ['linux'], risk: 'critical', icon: 'kernel' },
  { id: 'desktop-theme', name: 'Personalizacja pulpitu', desc: 'Motywy GTK, ikony, kursory i czcionki interfejsu dla GNOME i KDE Plasma; instalacja motywu lub czcionki z folderu.', folder: 'system', os: ['linux'], risk: 'low', icon: 'palette', quickAction: 'Zmień wygląd' },
  { id: 'grub-editor', name: 'Wizualny edytor GRUB', desc: 'Czas wyboru i domyślny system w GRUB, Limine, systemd-boot lub rEFInd; motywy GRUB.', folder: 'system', os: ['linux'], risk: 'critical', icon: 'boot' },

  // ---- Folder 3: Bezpieczeństwo ----
  { id: 'browser-hygiene', name: 'Higiena przeglądarek', desc: 'Czyszczenie cache, ciasteczek i historii; optymalizacja baz SQLite.', folder: 'security', os: ALL, risk: 'medium', icon: 'globe', quickAction: 'Wyczyść dane przeglądarek' },
  { id: 'vault', name: 'Menadżer haseł (Vault)', desc: 'Lokalna, szyfrowana baza loginów i haseł z audytem bezpieczeństwa.', folder: 'security', os: ALL, risk: 'low', icon: 'vault', quickAction: 'Otwórz Vault' },

  // ---- Folder 4: Aplikacje ----
  { id: 'winget-ui', name: 'Winget', desc: 'Aplikacje z dostępną aktualizacją i ich aktualizacja przez systemowy winget.', folder: 'apps', os: ['windows'], risk: 'low', icon: 'download', quickAction: 'Sprawdź aktualizacje' },
  { id: 'uninstaller', name: 'Uninstaller', desc: 'Lista zainstalowanych aplikacji (menedżer pakietów systemu, flatpak, snap), odinstalowanie i wyszukanie pozostałości config/cache/data po wybranym programie.', folder: 'apps', os: ['linux'], risk: 'medium', icon: 'apps' },
]

export const riskLabel: Record<ModuleRisk, string> = {
  low: 'Bezpieczny',
  medium: 'Ostrożnie',
  critical: 'Krytyczny',
}

/**
 * A module as this particular system needs it described: the theming
 * module named after the desktop it themes, the package modules after the
 * manager they drive, and a module that cannot work here saying why. The
 * modules themselves adapt the same way — the profile reaches them too.
 */
export function adaptModule(m: ModuleDef, p: LinuxProfile | null): ModuleDef {
  if (!p) return m
  const desktop = label(DESKTOP_LABEL, p.desktop)
  switch (m.id) {
    case 'desktop-theme':
      return p.desktop && THEMED_DESKTOPS.includes(p.desktop)
        ? { ...m, name: `Wygląd ${desktop}`, desc: `Motywy, ikony, kursory i czcionki ${desktop}; instalacja motywu lub czcionki z folderu.` }
        : { ...m, desc: `${desktop ?? 'Nie wykryto środowiska graficznego'} — zmiana wyglądu działa w GNOME, KDE Plasma, Cinnamon, MATE, Xfce, Budgie i Pantheon; instalacja motywów i czcionek wszędzie.` }
    case 'grub-editor': {
      const loader = label(BOOTLOADER_LABEL, p.bootloader)
      if (!p.bootloader || p.bootloader === 'grub') return m
      return EDITED_LOADERS.includes(p.bootloader)
        ? { ...m, name: `Edytor ${loader}`, desc: `Domyślny system i czas wyboru w konfiguracji ${loader}, z kopią zapasową przed każdą zmianą.` }
        : { ...m, desc: `Ten system uruchamia się przez ${loader} — edytor obsługuje GRUB, Limine, systemd-boot i rEFInd.` }
    }
    case 'pkg-cache':
      return p.family
        ? { ...m, name: `Cache pakietów ${p.family}`, desc: `Czyszczenie cache i osieroconych pakietów ${p.family} oraz starych rewizji snap.` }
        : { ...m, desc: p.family_unavailable ?? m.desc }
    case 'uninstaller':
      return p.family
        ? { ...m, desc: `Lista zainstalowanych aplikacji (${p.family}, flatpak, snap), odinstalowanie i wyszukanie pozostałości config/cache/data po wybranym programie.` }
        : m
    case 'journald-trim':
      return p.systemd ? m : { ...m, desc: 'Ten system nie działa pod systemd — nie ma dziennika journald do przycięcia.' }
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
