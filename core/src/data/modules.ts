/**
 * Module registry — the single source of truth for what modules exist,
 * which folder (group) they belong to and which OS supports them.
 * Mirrors POSMAv1 mind map: Folder 1 Dane|Pliki, 2 System, 3 Bezpieczeństwo,
 * 4 Aplikacje, 5 Custom.
 */

import type { CapabilityId } from './capabilities'

export type Os = 'windows' | 'linux' | 'macos'

export type FolderId = 'data' | 'system' | 'security' | 'apps' | 'custom'

export type Gradient = { g1: string; g2: string }

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
  /** capabilities this module may request — see Access_plan.md §3 for the full matrix this mirrors */
  capabilities: CapabilityId[]
}

const ALL: Os[] = ['windows', 'linux', 'macos']

export const modules: ModuleDef[] = [
  // ---- Folder 1: Dane | Pliki ----
  { id: 'temp-clean', name: 'Czyszczenie Temp', desc: 'Skanowanie i kasowanie folderów tymczasowych systemu i aplikacji.', folder: 'data', os: ALL, risk: 'low', icon: 'sweep', quickAction: 'Przeskanuj pliki tymczasowe', capabilities: ['fs-user', 'fs-system', 'fda'] },
  { id: 'big-files', name: 'Szukanie dużych plików', desc: 'Przeszukiwanie dysku i segregacja plików od największych do najmniejszych.', folder: 'data', os: ALL, risk: 'low', icon: 'search', quickAction: 'Znajdź największe pliki', capabilities: ['fs-user', 'fs-scan', 'fda'] },
  { id: 'duplicates', name: 'Szukanie duplikatów', desc: 'Wykrywanie identycznych plików na podstawie sum MD5/SHA-256.', folder: 'data', os: ALL, risk: 'low', icon: 'duplicate', quickAction: 'Wykryj duplikaty', capabilities: ['fs-user', 'fs-scan', 'fda'] },
  { id: 'shredder', name: 'Niszczarka plików', desc: 'Bezpowrotne kasowanie danych przez wielokrotne nadpisywanie.', folder: 'data', os: ALL, risk: 'critical', icon: 'shredder', capabilities: ['fs-user'] },
  { id: 'metadata', name: 'Usuwanie metadanych', desc: 'Czyszczenie ukrytych informacji (GPS, autor) ze zdjęć i dokumentów.', folder: 'data', os: ALL, risk: 'low', icon: 'tag', capabilities: ['fs-user'] },
  { id: 'xcode-cache', name: 'Czyszczenie Xcode', desc: 'Usuwanie plików tymczasowych DerivedData środowiska Xcode.', folder: 'data', os: ['macos'], risk: 'low', icon: 'hammer', capabilities: ['fs-user'] },
  { id: 'macos-slim', name: 'Odchudzanie macOS', desc: 'Usuwanie załączników cache Mail i Messages bez utraty treści.', folder: 'data', os: ['macos'], risk: 'medium', icon: 'scissors', capabilities: ['fs-user', 'fda'] },
  { id: 'pkg-cache', name: 'Cache pakietów Linux', desc: 'Czyszczenie cache i osieroconych pakietów apt, pacman, flatpak i snap.', folder: 'data', os: ['linux'], risk: 'low', icon: 'package', quickAction: 'Wyczyść cache pakietów', capabilities: ['fs-system', 'pkg'] },
  { id: 'journald-trim', name: 'Przycinanie logów systemd', desc: 'Czyszczenie logów journalctl do zadanego rozmiaru lub wieku.', folder: 'data', os: ['linux'], risk: 'low', icon: 'logs', capabilities: ['fs-system'] },

  // ---- Folder 2: System ----
  { id: 'disk-map', name: 'Mapa dysków', desc: 'Graficzny podgląd zajętości dysku w postaci proporcjonalnych kafelków.', folder: 'system', os: ALL, risk: 'low', icon: 'diskmap', quickAction: 'Pokaż mapę dysku', capabilities: ['fs-user', 'fs-scan'] },
  { id: 'autostart', name: 'Menadżer autostartu', desc: 'Podgląd i wyłączanie programów startujących z systemem.', folder: 'system', os: ['linux'], risk: 'medium', icon: 'autostart', quickAction: 'Przejrzyj autostart', capabilities: ['autostart-user', 'autostart-system'] },
  { id: 'health-monitor', name: 'Monitor zdrowia', desc: 'CPU/RAM na żywo, czyszczenie cache i odczyt S.M.A.R.T. dysków.', folder: 'system', os: ALL, risk: 'low', icon: 'pulse', capabilities: ['disk-smart'] },
  { id: 'winsxs', name: 'Czyszczenie WinSxS', desc: 'Integracja z DISM — usuwanie starych wersji plików Windows Update.', folder: 'system', os: ['windows'], risk: 'critical', icon: 'layers', capabilities: ['fs-system', 'restore-point'] },
  { id: 'services', name: 'Menedżer usług', desc: 'Zarządzanie usługami przez gotowe profile (telemetria, gry).', folder: 'system', os: ['windows'], risk: 'critical', icon: 'gears', capabilities: ['svc', 'restore-point'] },
  { id: 'bloatware', name: 'Usuwanie Bloatware', desc: 'Odinstalowywanie fabrycznych aplikacji UWP przez PowerShell.', folder: 'system', os: ['windows'], risk: 'critical', icon: 'trash', capabilities: ['fs-system', 'restore-point'] },
  { id: 'time-machine', name: 'Time Machine', desc: 'Usuwanie lokalnych migawek Time Machine przez tmutil.', folder: 'system', os: ['macos'], risk: 'medium', icon: 'clock', capabilities: ['fs-system', 'fda'] },
  { id: 'kernel-mgr', name: 'Zarządzanie wersjami jądra', desc: 'Przegląd i usuwanie starych jąder z /boot, z blokadą aktywnego.', folder: 'system', os: ['linux'], risk: 'critical', icon: 'kernel', capabilities: ['boot', 'pkg'] },
  { id: 'desktop-theme', name: 'Personalizacja pulpitu', desc: 'Motywy GTK, ikony, kursory i czcionki interfejsu dla GNOME i KDE Plasma; instalacja motywu lub czcionki z folderu.', folder: 'system', os: ['linux'], risk: 'low', icon: 'palette', quickAction: 'Zmień wygląd', capabilities: ['fs-user'] },
  { id: 'grub-editor', name: 'Wizualny edytor GRUB', desc: 'Modyfikacja /etc/default/grub — czas wyboru, domyślny system, tło.', folder: 'system', os: ['linux'], risk: 'critical', icon: 'boot', capabilities: ['boot'] },

  // ---- Folder 3: Bezpieczeństwo ----
  { id: 'browser-hygiene', name: 'Higiena przeglądarek', desc: 'Czyszczenie cache, ciasteczek i historii; optymalizacja baz SQLite.', folder: 'security', os: ALL, risk: 'medium', icon: 'globe', quickAction: 'Wyczyść dane przeglądarek', capabilities: ['fs-user', 'fda'] },
  { id: 'vault', name: 'Menadżer haseł (Vault)', desc: 'Lokalna, szyfrowana baza loginów i haseł z audytem bezpieczeństwa.', folder: 'security', os: ALL, risk: 'low', icon: 'vault', quickAction: 'Otwórz Vault', capabilities: ['secrets', 'net'] },

  // ---- Folder 4: Aplikacje ----
  { id: 'winget-ui', name: 'Winget', desc: 'Lista programów i zbiorcza aktualizacja przez systemowy winget.', folder: 'apps', os: ['windows'], risk: 'low', icon: 'download', quickAction: 'Sprawdź aktualizacje', capabilities: ['pkg'] },
  { id: 'uninstaller', name: 'Uninstaller', desc: 'Lista zainstalowanych aplikacji (apt/flatpak/snap), odinstalowanie i wyszukanie pozostałości config/cache/data po wybranym programie.', folder: 'apps', os: ['linux'], risk: 'medium', icon: 'apps', capabilities: ['fs-user', 'pkg'] },
]

export const riskLabel: Record<ModuleRisk, string> = {
  low: 'Bezpieczny',
  medium: 'Ostrożnie',
  critical: 'Krytyczny',
}

export function modulesForOs(os: Os): ModuleDef[] {
  return modules.filter((m) => m.os.includes(os))
}

export function modulesInFolder(folder: FolderId, os?: Os): ModuleDef[] {
  return modules.filter((m) => m.folder === folder && (!os || m.os.includes(os)))
}
