import { useState } from 'react'
import { t } from '../i18n'
import {
  BOOTLOADER_LABEL,
  DESKTOP_LABEL,
  FAMILY_LABEL,
  label,
  type LinuxProfile,
  type ProfileOverrides,
} from '../data/linuxProfile'

/** One line naming what the system is made of. */
export function profileSummary(p: LinuxProfile): string {
  return [
    p.like.length > 0 ? t('profile.summary.like', { list: p.like.join(', ') }) : null,
    p.family ?? (p.immutable ? t('profile.summary.immutable') : t('profile.summary.no-manager')),
    label(DESKTOP_LABEL, p.desktop),
    label(BOOTLOADER_LABEL, p.bootloader),
  ]
    .filter(Boolean)
    .join(' · ')
}

function Field({ name, desc, children }: { name: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="glass setting-row">
      <div className="st-text">
        <div className="st-name">{name}</div>
        <div className="st-desc">{desc}</div>
      </div>
      {children}
    </div>
  )
}

interface FieldsProps {
  profile: LinuxProfile
  onSave: (overrides: ProfileOverrides) => Promise<void>
}

/**
 * What a user may correct about the system. Each select's first option
 * follows detection; anything else is stored by the core and given to
 * every module from then on.
 */
export function SystemProfileFields({ profile: p, onSave }: FieldsProps) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function change(field: keyof ProfileOverrides, value: string) {
    setError(null)
    setSaving(true)
    try {
      await onSave({ ...p.overrides, [field]: value || null })
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const detected = (map: Record<string, string>, id: string | null, none: string) =>
    t('profile.detected', { value: label(map, id) ?? none })

  // The broker picks the package manager by the same rule, so a family
  // os-release declares is not the user's to change here.
  const familyDesc = p.immutable
    ? (p.family_unavailable ?? '')
    : p.family_declared
      ? t('profile.family.declared', {
          source: p.like.length > 0 ? `ID_LIKE: ${p.like.join(' ')}` : `ID: ${p.id}`,
          family: p.family ?? '',
        })
      : t('profile.family.undeclared')

  return (
    <>
      <Field name={t('profile.family.name')} desc={familyDesc}>
        <select
          aria-label={t('profile.family.name')}
          value={p.overrides.pkg_manager ?? ''}
          disabled={saving || p.family_declared || p.immutable}
          onChange={(e) => change('pkg_manager', e.target.value)}
        >
          <option value="">{detected(FAMILY_LABEL, p.family_detected, t('profile.none'))}</option>
          {p.managers.map((m) => (
            <option key={m} value={m}>{FAMILY_LABEL[m]}</option>
          ))}
        </select>
      </Field>
      <Field name={t('profile.desktop.name')} desc={t('profile.desktop.desc')}>
        <select
          aria-label={t('profile.desktop.name')}
          value={p.overrides.desktop ?? ''}
          disabled={saving}
          onChange={(e) => change('desktop', e.target.value)}
        >
          <option value="">{detected(DESKTOP_LABEL, p.desktop_detected, t('profile.not-detected'))}</option>
          {Object.entries(DESKTOP_LABEL).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </Field>
      <Field name={t('profile.bootloader.name')} desc={t('profile.bootloader.desc')}>
        <select
          aria-label={t('profile.bootloader.name')}
          value={p.overrides.bootloader ?? ''}
          disabled={saving}
          onChange={(e) => change('bootloader', e.target.value)}
        >
          <option value="">{detected(BOOTLOADER_LABEL, p.bootloader_detected, t('profile.not-detected'))}</option>
          {Object.entries(BOOTLOADER_LABEL).map(([id, name]) => (
            <option key={id} value={id}>{name}</option>
          ))}
        </select>
      </Field>
      {error && <div className="form-warning">{error}</div>}
    </>
  )
}
