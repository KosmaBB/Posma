import type { AppState } from '../state/appState'

/**
 * Mind map settings list: Poziom dostępu, Ustawienia wyglądu/motywu,
 * Inteligentne przypominanie, Automatyzacja, Absolutne odinstalowanie,
 * Ustawienia folderów, Język. UI-only for now — values are not yet
 * persisted anywhere except access level (part of onboarding state).
 */
export function Settings({ app }: { app: AppState }) {
  const { onboarding, resetOnboarding } = app

  return (
    <div className="view-enter">
      <div className="settings-list">
        <div className="glass setting-row">
          <div className="st-text">
            <div className="st-name">Poziom dostępu</div>
            <div className="st-desc">Pełny zbiera wszystkie zgody z góry; wybiórczy prosi przy instalacji modułu.</div>
          </div>
          <select defaultValue={onboarding?.accessLevel ?? 'selective'}>
            <option value="full">Pełny</option>
            <option value="selective">Wybiórczy</option>
          </select>
        </div>

        <div className="glass setting-row">
          <div className="st-text">
            <div className="st-name">Wygląd i motyw</div>
            <div className="st-desc">Motyw kolorystyczny aplikacji — kolejne motywy dojdą wraz z systemem motywów.</div>
          </div>
          <select defaultValue="posma-dark">
            <option value="posma-dark">POSMA Dark</option>
          </select>
        </div>

        <div className="glass setting-row">
          <div className="st-text">
            <div className="st-name">Inteligentne przypominanie</div>
            <div className="st-desc">Dyskretne powiadomienia o potrzebie czyszczenia (np. dysk &gt; 85%).</div>
          </div>
          <select defaultValue="normal">
            <option value="off">Wyłączone</option>
            <option value="normal">Normalne</option>
            <option value="aggressive">Częste</option>
          </select>
        </div>

        <div className="glass setting-row">
          <div className="st-text">
            <div className="st-name">Automatyzacja</div>
            <div className="st-desc">Automatyczne uruchamianie wybranych akcji według harmonogramu.</div>
          </div>
          <select defaultValue="off">
            <option value="off">Wyłączona</option>
            <option value="weekly">Co tydzień</option>
            <option value="monthly">Co miesiąc</option>
          </select>
        </div>

        <div className="glass setting-row">
          <div className="st-text">
            <div className="st-name">Ustawienia folderów</div>
            <div className="st-desc">Które grupy modułów są widoczne w nawigacji i w jakiej kolejności.</div>
          </div>
          <button className="btn btn-ghost" disabled>Wkrótce</button>
        </div>

        <div className="glass setting-row">
          <div className="st-text">
            <div className="st-name">Język</div>
            <div className="st-desc">Język interfejsu aplikacji.</div>
          </div>
          <select defaultValue="pl">
            <option value="pl">Polski</option>
            <option value="en">English</option>
          </select>
        </div>

        <div className="glass setting-row" style={{ borderColor: 'color-mix(in srgb, var(--critical) 35%, transparent)' }}>
          <div className="st-text">
            <div className="st-name" style={{ color: 'var(--critical)' }}>Absolutne odinstalowanie aplikacji</div>
            <div className="st-desc">Usuwa aplikację razem ze wszystkimi modułami, ustawieniami i danymi. Na razie: resetuje stan aplikacji (onboarding od nowa).</div>
          </div>
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
        </div>
      </div>
    </div>
  )
}
