/**
 * What kind of Linux this is — detected by the system-info module from
 * os-release, the session and the boot loader, and corrected by the user
 * at onboarding or in settings. The core hands corrections to every module
 * it starts, so this is what the modules act on, not only what is shown.
 */
import { invoke } from '@tauri-apps/api/core'
import { t } from '../i18n'

export type PkgManager = 'apt' | 'pacman' | 'dnf' | 'zypper'

/** `null` follows detection. */
export interface ProfileOverrides {
  pkg_manager: PkgManager | null
  desktop: string | null
  bootloader: string | null
}

/** Each value as the modules see it, beside what detection alone found. */
export interface LinuxProfile {
  name: string
  id: string | null
  /** os-release ID_LIKE: the distributions this one says it descends from. */
  like: string[]
  family: PkgManager | null
  family_detected: PkgManager | null
  /** os-release names the family and its tool is installed — it cannot be changed. */
  family_declared: boolean
  family_unavailable: string | null
  /** Package managers actually installed — the only ones worth offering. */
  managers: PkgManager[]
  immutable: boolean
  desktop: string | null
  desktop_detected: string | null
  bootloader: string | null
  bootloader_detected: string | null
  systemd: boolean
  overrides: ProfileOverrides
}

export const FAMILY_LABEL: Record<PkgManager, string> = {
  apt: 'Debian / Ubuntu (apt)',
  pacman: 'Arch (pacman)',
  dnf: 'Fedora / RHEL (dnf)',
  zypper: 'openSUSE (zypper)',
}

export const DESKTOP_LABEL: Record<string, string> = {
  gnome: 'GNOME',
  plasma: 'KDE Plasma',
  cinnamon: 'Cinnamon',
  mate: 'MATE',
  xfce: 'Xfce',
  budgie: 'Budgie',
  pantheon: 'Pantheon',
  lxqt: 'LXQt',
  cosmic: 'COSMIC',
  get other() {
    return t('profile.desktop.other')
  },
}

export const BOOTLOADER_LABEL: Record<string, string> = {
  grub: 'GRUB',
  'systemd-boot': 'systemd-boot',
  limine: 'Limine',
  refind: 'rEFInd',
  get other() {
    return t('profile.bootloader.other')
  },
}

/** Loaders the boot editor sets in place, through the broker; GRUB has its own. */
export const EDITED_LOADERS = ['limine', 'systemd-boot', 'refind']

/** Desktops the desktop-theme module has settings for. */
export const THEMED_DESKTOPS = ['gnome', 'plasma', 'cinnamon', 'mate', 'xfce', 'budgie', 'pantheon']

export function label(map: Record<string, string>, id: string | null): string | null {
  return id ? (map[id] ?? id) : null
}

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

export async function loadLinuxProfile(): Promise<LinuxProfile> {
  const res = await invoke<ApiResponse<LinuxProfile>>('get_system_profile')
  if (!res.ok) throw new Error(res.error)
  return res.data
}

export async function saveLinuxProfile(overrides: ProfileOverrides): Promise<LinuxProfile> {
  const res = await invoke<ApiResponse<LinuxProfile>>('set_system_profile', { overrides })
  if (!res.ok) throw new Error(res.error)
  return res.data
}
