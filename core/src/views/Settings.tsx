import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import type { AppState } from '../state/appState'
import { autoScale, type SettingsState, type UiScale } from '../state/settings'

/** A label and its explanation, with whatever control it takes on the right. */
function Row({
  name,
  desc,
  children,
  danger,
}: {
  name: string
  desc: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div
      className="glass setting-row"
      style={danger ? { borderColor: 'color-mix(in srgb, var(--critical) 35%, transparent)' } : undefined}
    >
      <div className="st-text">
        <div className="st-name" style={danger ? { color: 'var(--critical)' } : undefined}>{name}</div>
        <div className="st-desc">{desc}</div>
      </div>
      {children}
    </div>
  )
}

const SCALES: { value: UiScale; label: string }[] = [
  { value: 'auto', label: 'Automatyczne' },
  { value: '0.9', label: 'Mniejsze (90%)' },
  { value: '1', label: 'Domyślne (100%)' },
  { value: '1.15', label: 'Większe (115%)' },
  { value: '1.3', label: 'Duże (130%)' },
  { value: '1.5', label: 'Bardzo duże (150%)' },
]

export function Settings({ app, settings }: { app: AppState; settings: SettingsState }) {
  const { onboarding, resetOnboarding } = app
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
      <div className="settings-list">
        <Row
          name="Poziom dostępu"
          desc="Pełny zbiera wszystkie zgody z góry i zapamiętuje je. Wybiórczy nadaje uprawnienia na jedno uruchomienie i pyta ponownie po restarcie."
        >
          <select value={accessLevel} onChange={(e) => changeAccessLevel(e.target.value as 'full' | 'selective')}>
            <option value="full">Pełny</option>
            <option value="selective">Wybiórczy</option>
          </select>
        </Row>
        {accessError && <div className="form-warning">{accessError}</div>}

        <Row
          name="Skalowanie interfejsu"
          desc={
            s.uiScale === 'auto'
              ? `Automatyczne dobiera skalę do szerokości okna — teraz ${Math.round(autoScale(window.innerWidth) * 100)}%.`
              : 'Ustaw ręcznie, jeśli przy Twojej rozdzielczości tekst jest za mały lub za duży.'
          }
        >
          <select value={s.uiScale} onChange={(e) => set('uiScale', e.target.value as UiScale)}>
            {SCALES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </Row>

        <Row
          name="Czarna lista skanerów"
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

        <Row
          name="Absolutne odinstalowanie aplikacji"
          desc="Usuwa aplikację razem ze wszystkimi modułami, ustawieniami i danymi. Na razie: resetuje stan aplikacji (onboarding od nowa)."
          danger
        >
          <button
            className="btn btn-ghost"
            style={{ borderColor: 'color-mix(in srgb, var(--critical) 50%, transparent)', color: 'var(--critical)' }}
            onClick={() => {
              if (window.confirm('Na pewno? To wyczyści stan aplikacji i uruchomi konfigurację od nowa.')) {
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
