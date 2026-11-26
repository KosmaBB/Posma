import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { detectOs, type AppState } from '../state/appState'
import type { SettingsState } from '../state/settings'
import { confirmAction } from '../components/confirm'
import { SettingRow as Row } from '../components/SettingRow'
import { SystemProfileFields, profileSummary } from '../components/SystemProfile'
import { AppearanceSection } from './Appearance'
import { languages, t } from '../i18n'

/**
 * macOS grants Full Disk Access only by hand, in System Settings. This can
 * open the right pane and check the result — never grant it — and it checks
 * again whenever the window comes back to the front, which is when someone
 * returns from flipping the switch.
 */
export function FullDiskAccessRow() {
  const [granted, setGranted] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const check = () => invoke<boolean>('full_disk_access').then(setGranted).catch(() => setGranted(null))
    check()
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [])

  async function openSettings() {
    setError(null)
    try {
      await invoke('open_full_disk_access_settings')
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <>
      <Row
        name={t('settings.disk-access')}
        desc={
          granted
            ? t('settings.disk-access.granted.desc')
            : t('settings.disk-access.missing.desc')
        }
      >
        {granted ? (
          <span className="chip low">{t('settings.disk-access.granted')}</span>
        ) : (
          <button className="btn btn-ghost" onClick={openSettings}>{t('settings.disk-access.open')}</button>
        )}
      </Row>
      {error && <div className="form-warning">{error}</div>}
    </>
  )
}

export function Settings({ app, settings }: { app: AppState; settings: SettingsState }) {
  const { onboarding, resetOnboarding, linuxProfile, saveLinuxProfile } = app
  const { settings: s, set, addToBlacklist, removeFromBlacklist } = settings

  const [accessLevel, setAccessLevel] = useState(onboarding?.accessLevel ?? 'selective')
  const [accessError, setAccessError] = useState<string | null>(null)

  // The core is the authority on this — the interface only ever mirrored it,
  // and the two could disagree after a reset.
  useEffect(() => {
    invoke<'full' | 'selective'>('get_access_level')
      .then(setAccessLevel)
      .catch(() => {})
  }, [])

  async function changeAccessLevel(level: 'full' | 'selective') {
    setAccessError(null)
    try {
      await invoke('set_access_level', { level })
      setAccessLevel(level)
    } catch (e) {
      setAccessError(String(e))
    }
  }

  async function pickBlacklistPath() {
    const dir = await open({
      directory: true,
      multiple: false,
      title: t('settings.blacklist.pick'),
    })
    if (typeof dir === 'string') addToBlacklist(dir)
  }

  return (
    <div className="view-enter">
      <div className="section-head"><h2>{t('settings.section.app')}</h2></div>
      <div className="settings-list">
        <Row
          name={t('settings.access')} tour="access"
          desc={t('settings.access.desc')}
        >
          <select value={accessLevel} onChange={(e) => changeAccessLevel(e.target.value as 'full' | 'selective')}>
            <option value="full">{t('settings.access.full')}</option>
            <option value="selective">{t('settings.access.selective')}</option>
          </select>
        </Row>
        {accessError && <div className="form-warning">{accessError}</div>}

        {detectOs() === 'macos' && <FullDiskAccessRow />}

        {linuxProfile && (
          <>
            <Row
              name={t('settings.system', { name: linuxProfile.name })}
              desc={t('settings.system.desc', { summary: profileSummary(linuxProfile) })}
            >
              {null}
            </Row>
            <SystemProfileFields profile={linuxProfile} onSave={saveLinuxProfile} />
          </>
        )}

        <Row
          name={t('settings.blacklist')} tour="blacklist"
          desc={t('settings.blacklist.desc')}
        >
          <button className="btn btn-ghost" onClick={pickBlacklistPath}>{t('settings.blacklist.add')}</button>
        </Row>

        {s.blacklist.length > 0 && (
          <div className="glass blacklist">
            {s.blacklist.map((path) => (
              <div className="blacklist__row" key={path}>
                <span className="mono blacklist__path">{path}</span>
                <button
                  className="btn btn-ghost btn-mini"
                  onClick={() => removeFromBlacklist(path)}
                >
                  {t('common.remove')}
                </button>
              </div>
            ))}
          </div>
        )}

        <Row
          name={t('settings.refresh')}
          desc={t('settings.refresh.desc')}
        >
          <select value={s.refreshMs} onChange={(e) => set('refreshMs', Number(e.target.value))}>
            {[1000, 2000, 5000, 10000].map((ms) => (
              <option key={ms} value={ms}>{t('settings.refresh.every', { n: ms / 1000 })}</option>
            ))}
          </select>
        </Row>

        <Row
          name={t('settings.reminders')}
          desc={t('settings.reminders.desc')}
        >
          <select value={s.reminders} onChange={(e) => set('reminders', e.target.value as typeof s.reminders)}>
            <option value="off">{t('settings.reminders.off')}</option>
            <option value="normal">{t('settings.reminders.normal')}</option>
            <option value="aggressive">{t('settings.reminders.aggressive')}</option>
          </select>
        </Row>

        <Row name={t('settings.language')} desc={t('settings.language.desc')}>
          <select value={s.language} onChange={(e) => set('language', e.target.value)}>
            {languages().map((l) => <option key={l.code} value={l.code}>{l.name}</option>)}
          </select>
        </Row>

      </div>

      <AppearanceSection settings={settings} />

      <div className="section-head"><h2>{t('settings.section.data')}</h2></div>
      <div className="settings-list">
        <Row
          name={t('settings.reset')}
          desc={t('settings.reset.desc')}
          danger
        >
          <button
            className="btn btn-ghost"
            style={{ borderColor: 'color-mix(in srgb, var(--critical) 50%, transparent)', color: 'var(--critical)' }}
            onClick={async () => {
              if (await confirmAction(t('settings.reset.confirm'))) {
                resetOnboarding()
              }
            }}
          >
            {t('settings.reset.button')}
          </button>
        </Row>
      </div>
    </div>
  )
}
