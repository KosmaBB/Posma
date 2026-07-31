import type { AppState } from '../state/appState'
import { folders, modulesForOs, riskLabel } from '../data/modules'
import { Icon } from '../components/Icons'

/**
 * Mind map: "Pełna lista dostępnych modułów, krytyczne i bardziej zagrażające
 * błędami krytycznymi dla systemu z odpowiednim alertem" + doinstalowanie /
 * odinstalowanie. Custom modules ("Tworzenie modułu") come later.
 */
export function ModuleManager({ app }: { app: AppState }) {
  const { onboarding, installedSet, setModuleInstalled } = app
  const os = onboarding?.os ?? 'linux'
  const available = modulesForOs(os)

  function onCardMouseMove(e: React.MouseEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`)
    e.currentTarget.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`)
  }

  return (
    <div className="view-enter">
      {folders.map((folder) => {
        const items = available.filter((m) => m.folder === folder.id)
        if (items.length === 0) return null
        return (
          <div key={folder.id}>
            <div className="section-head">
              <h2>{folder.name}</h2>
              <span className="count">
                {items.filter((m) => installedSet.has(m.id)).length} / {items.length} zainstalowane
              </span>
            </div>
            <div className="module-grid" style={{ marginBottom: 10 }}>
              {items.map((m) => {
                const installed = installedSet.has(m.id)
                return (
                  <article
                    key={m.id}
                    className="glass module-card"
                    style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}
                    onMouseMove={onCardMouseMove}
                  >
                    <div className="mc-top">
                      <div className="ico-badge" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
                        <Icon name={m.icon} />
                      </div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div className="mc-name">{m.name}</div>
                      </div>
                      <button
                        className={`toggle${installed ? ' on' : ''}`}
                        style={{ '--g1': folder.gradient.g1 } as React.CSSProperties}
                        aria-label={`${installed ? 'Odinstaluj' : 'Zainstaluj'} ${m.name}`}
                        onClick={() => setModuleInstalled(m.id, !installed)}
                      />
                    </div>
                    <p className="mc-desc">{m.desc}</p>
                    <div className="mc-foot">
                      <span className={`chip ${m.risk}`}>
                        {m.risk === 'critical' ? '⚠ ' : ''}
                        {riskLabel[m.risk]}
                      </span>
                      {m.os.length === 3 ? (
                        <span className="chip os">wszystkie systemy</span>
                      ) : (
                        m.os.map((o) => (
                          <span key={o} className="chip os">
                            {{ windows: 'Windows', linux: 'Linux', macos: 'macOS' }[o]}
                          </span>
                        ))
                      )}
                      <span className="spacer" />
                    </div>
                  </article>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
