/**
 * Canonical capability catalog — see Access_plan.md §2 for the full design.
 * This is the single source of truth for what a module is allowed to ask
 * for. Every module declares a subset of these IDs (in `module.json` and
 * mirrored in `modules.ts`); the core will later validate requests against
 * this declaration before forwarding anything to the privileged broker.
 *
 * Kept as plain data (no per-OS branching here) — OS-specific nuance for a
 * given module is expressed via that module's own `os` field in
 * `modules.ts`, not by branching the catalog itself.
 */

export type Elevation = 'none' | 'optional' | 'required'

export interface CapabilityDef {
  id: string
  name: string
  desc: string
  elevation: Elevation
  /** true if granting this can only happen via manual user action (e.g. macOS FDA) — never fully automatable */
  manualOnly?: boolean
}

export const capabilities = [
  {
    id: 'fs-user',
    name: 'Pliki użytkownika',
    desc: 'Odczyt i zapis w Twoich plikach — temp, cache, kosz, dokumenty które sam wskażesz.',
    elevation: 'none',
  },
  {
    id: 'fs-system',
    name: 'Pliki systemowe',
    desc: 'Odczyt i zapis poza katalogiem użytkownika — logi systemowe, systemowy temp, systemowy cache.',
    elevation: 'required',
  },
  {
    id: 'fs-scan',
    name: 'Skan całego dysku',
    desc: 'Przeszukiwanie całego dysku w poszukiwaniu dużych plików/duplikatów. Bez podniesienia pomija pliki innych użytkowników zamiast się wywalać.',
    elevation: 'optional',
  },
  {
    id: 'pkg',
    name: 'Menedżer pakietów',
    desc: 'apt/pacman/flatpak/snap (Linux), winget (Windows), brew (macOS).',
    elevation: 'optional',
  },
  {
    id: 'svc',
    name: 'Usługi i daemony',
    desc: 'Włączanie/wyłączanie usług systemowych (systemd, usługi Windows, launchd).',
    elevation: 'required',
  },
  {
    id: 'autostart-user',
    name: 'Autostart użytkownika',
    desc: 'Wpisy autostartu należące do Twojego konta.',
    elevation: 'none',
  },
  {
    id: 'autostart-system',
    name: 'Autostart systemowy',
    desc: 'Wpisy autostartu widoczne dla wszystkich użytkowników systemu.',
    elevation: 'required',
  },
  {
    id: 'boot',
    name: 'Bootloader / jądro',
    desc: 'GRUB, partycja /boot, zarządzanie wersjami jądra. Zawsze z automatycznym backupem przed zmianą.',
    elevation: 'required',
  },
  {
    id: 'disk-smart',
    name: 'Zdrowie dysku (S.M.A.R.T.)',
    desc: 'Odczyt surowych parametrów dysku.',
    elevation: 'required',
  },
  {
    id: 'restore-point',
    name: 'Punkt przywracania',
    desc: 'Tworzenie punktu przywracania systemu Windows przed ryzykowną operacją.',
    elevation: 'required',
  },
  {
    id: 'fda',
    name: 'Pełny dostęp do dysku (macOS)',
    desc: 'Wymagany m.in. dla Mail/Messages/Time Machine. Nie da się nadać programowo — poprowadzimy Cię do odpowiedniego ustawienia systemowego.',
    elevation: 'required',
    manualOnly: true,
  },
  {
    id: 'secrets',
    name: 'Magazyn sekretów',
    desc: 'Szyfrowana baza Vault — klucz główny niedostępny dla innych modułów.',
    elevation: 'none',
  },
  {
    id: 'net',
    name: 'Sieć',
    desc: 'Połączenia wychodzące, np. audyt wycieków haseł. Zawsze deklarowane jawnie.',
    elevation: 'none',
  },
] as const satisfies readonly CapabilityDef[]

export type CapabilityId = (typeof capabilities)[number]['id']

const byId = new Map(capabilities.map((c) => [c.id, c]))

export function getCapability(id: CapabilityId): CapabilityDef {
  const cap = byId.get(id)
  if (!cap) throw new Error(`Unknown capability id: ${id}`)
  return cap
}
