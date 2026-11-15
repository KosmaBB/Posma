import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { detectOs, type AppState } from '../state/appState'
import type { SettingsState } from '../state/settings'
import { confirmAction } from '../components/confirm'
import { SettingRow as Row } from '../components/SettingRow'
import { SystemProfileFields, profileSummary } from '../components/SystemProfile'
import { AppearanceSection } from './Appearance'

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
        name="Pełny dostęp do dysku"
        desc={
          granted
            ? 'Nadany — moduły widzą też katalogi, które macOS chroni (Poczta, Wiadomości, Safari).'
            : 'Bez niego macOS ukrywa przed POSMA Pocztę, Wiadomości i Safari. Nadaje się go tylko w Ustawieniach systemowych: zaznacz tam POSMA, a ten wiersz sam to zauważy.'
        }
      >
        {granted ? (
          <span className="chip low">Nadany</span>
        ) : (
          <button className="btn btn-ghost" onClick={openSettings}>Otwórz Ustawienia</button>
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
      title: 'Wybierz folder, którego skanery mają nigdy nie pokazywać',
    })
    if (typeof dir === 'string') addToBlacklist(dir)
  }

  return (
    <div className="view-enter">
      <div className="section-head"><h2>Aplikacja</h2></div>
      <div className="settings-list">
        <Row
          name="Poziom dostępu" tour="access"
          desc="Pełny zbiera wszystkie zgody z góry i zapamiętuje je. Wybiórczy nadaje uprawnienia na jedno uruchomienie i pyta ponownie po restarcie."
        >
          <select value={accessLevel} onChange={(e) => changeAccessLevel(e.target.value as 'full' | 'selective')}>
            <option value="full">Pełny</option>
            <option value="selective">Wybiórczy</option>
          </select>
        </Row>
        {accessError && <div className="form-warning">{accessError}</div>}

        {detectOs() === 'macos' && <FullDiskAccessRow />}

        {linuxProfile && (
          <>
            <Row
              name={`System: ${linuxProfile.name}`}
              desc={`${profileSummary(linuxProfile)}. Zmiana poniżej trafia do wszystkich modułów.`}
            >
              {null}
            </Row>
            <SystemProfileFields profile={linuxProfile} onSave={saveLinuxProfile} />
          </>
        )}

        <Row
          name="Czarna lista skanerów" tour="blacklist"
          desc="Ścieżki, których skanery nigdy nie wylistują ani nie zaproponują do usunięcia — dyski innego systemu, archiwum zdjęć, dokumenty klienta."
        >
          <button className="btn btn-ghost" onClick={pickBlacklistPath}>Dodaj folder</button>
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
                  Usuń
                </button>
              </div>
            ))}
          </div>
        )}

        <Row
          name="Częstotliwość odświeżania"
          desc="Jak często widoki na żywo pytają o nowe dane. Rzadziej znaczy mniej pracy w tle; płynność wykresów nie zależy od tej wartości."
        >
          <select value={s.refreshMs} onChange={(e) => set('refreshMs', Number(e.target.value))}>
            <option value={1000}>Co sekundę</option>
            <option value={2000}>Co 2 sekundy</option>
            <option value={5000}>Co 5 sekund</option>
            <option value={10000}>Co 10 sekund</option>
          </select>
        </Row>

        <Row
          name="Inteligentne przypominanie"
          desc="Dyskretne powiadomienia o potrzebie czyszczenia (np. dysk > 85%)."
        >
          <select value={s.reminders} onChange={(e) => set('reminders', e.target.value as typeof s.reminders)}>
            <option value="off">Wyłączone</option>
            <option value="normal">Normalne</option>
            <option value="aggressive">Częste</option>
          </select>
        </Row>

        <Row name="Język" desc="Język interfejsu aplikacji.">
          <select value={s.language} onChange={(e) => set('language', e.target.value as typeof s.language)}>
            <option value="pl">Polski</option>
            <option value="en">English</option>
          </select>
        </Row>

      </div>

      <AppearanceSection settings={settings} />

      <div className="section-head"><h2>Dane aplikacji</h2></div>
      <div className="settings-list">
        <Row
          name="Absolutne odinstalowanie aplikacji"
          desc="Usuwa aplikację razem ze wszystkimi modułami, ustawieniami i danymi. Na razie: resetuje stan aplikacji (onboarding od nowa)."
          danger
        >
          <button
            className="btn btn-ghost"
            style={{ borderColor: 'color-mix(in srgb, var(--critical) 50%, transparent)', color: 'var(--critical)' }}
            onClick={async () => {
              if (await confirmAction('Na pewno? To wyczyści stan aplikacji i uruchomi konfigurację od nowa.')) {
                resetOnboarding()
              }
            }}
          >
            Resetuj aplikację
          </button>
        </Row>
      </div>
    </div>
  )
}
