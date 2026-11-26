import type { AppState } from '../state/appState'
import { t } from '../i18n'
import { applyOrder, catalogNumbers, folderNumber, folders, modulesForOs, riskLabel } from '../data/modules'

/**
 * Mind map: "Pełna lista dostępnych modułów, krytyczne i bardziej zagrażające
 * błędami krytycznymi dla systemu z odpowiednim alertem" + doinstalowanie /
 * odinstalowanie. Custom modules ("Tworzenie modułu") come later.
 */
export function ModuleManager({ app }: { app: AppState }) {
  const { onboarding, installedSet, setModuleInstalled, moduleOrder, linuxProfile } = app
  const os = onboarding?.os ?? 'linux'
  const available = modulesForOs(os, linuxProfile)
  const numbers = catalogNumbers(os, linuxProfile)

  return (
    <div className="view-enter" data-tour="manager">
      {folders.map((folder) => {
        const items = applyOrder(available.filter((m) => m.folder === folder.id), moduleOrder[folder.id])
        if (items.length === 0) return null
        return (
          <section key={folder.id} style={{ '--code': folder.gradient.g1 } as React.CSSProperties}>
            <div className="section-head">
              <h2>
                <span className="section-no">{folderNumber(folder.id)}</span>
                {folder.name}
              </h2>
              <span className="count">
                {t('manager.enabled', { n: items.filter((m) => installedSet.has(m.id)).length, total: items.length })}
              </span>
            </div>
            <div className="cat-list">
              {items.map((m) => {
                const installed = installedSet.has(m.id)
                return (
                  <article key={m.id} className="cat-row" data-on={installed}>
                    <span className="cat-row__no">{numbers.get(m.id)}</span>
                    <div>
                      <h3 className="cat-row__name">{m.name}</h3>
                      <p className="cat-row__desc">{m.desc}</p>
                    </div>
                    <span className="cat-row__meta">
                      <span className={`chip ${m.risk}`}>{riskLabel[m.risk]}</span>
                      {m.os.length === 3 ? (
                        <span className="chip os">{t('manager.os.all')}</span>
                      ) : (
                        m.os.map((o) => (
                          <span key={o} className="chip os">
                            {{ windows: 'Windows', linux: 'Linux', macos: 'macOS' }[o]}
                          </span>
                        ))
                      )}
                    </span>
                    <button
                      className={`toggle${installed ? ' on' : ''}`}
                      aria-pressed={installed}
                      aria-label={t(installed ? 'manager.toggle.off' : 'manager.toggle.on', { name: m.name })}
                      onClick={() => setModuleInstalled(m.id, !installed)}
                    />
                    <span className="code" />
                  </article>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
