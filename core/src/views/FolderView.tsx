import type { AppState } from '../state/appState'
import { folders, modulesInFolder, riskLabel } from '../data/modules'
import { Icon } from '../components/Icons'

/**
 * Everything in one folder, installed or not.
 *
 * This is deliberately not what the sidebar does. The sidebar is a jump
 * list: installed modules only, names only. This is the browsing surface —
 * it shows what the folder *could* hold, what each module does and what it
 * would be allowed to touch, and lets a module be switched on without a
 * detour through the manager.
 *
 * That also fixes a real gap: a module shipped in an update was invisible
 * until the user happened to open the module manager.
 */
export function FolderView({ app, folderId }: { app: AppState; folderId: string }) {
  const { installedSet, setModuleInstalled, setView, onboarding } = app
  const folder = folders.find((f) => f.id === folderId)

  if (!folder) {
    return (
      <div className="glass empty-state">
        Nie ma takiego folderu.
        <br />
        <button className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>
          Wróć na pulpit
        </button>
      </div>
    )
  }

  const items = modulesInFolder(folder.id, onboarding?.os)
  const installed = items.filter((m) => installedSet.has(m.id))

  const gradientVars = {
    '--g1': folder.gradient.g1,
    '--g2': folder.gradient.g2,
  } as React.CSSProperties

  return (
    <div className="view-enter">
      <button className="crumb" onClick={() => setView({ kind: 'dashboard' })}>
        ← Pulpit
      </button>

      <header className="folder-head glass" style={gradientVars}>
        <span className="folder-head__ico" style={gradientVars}>
          <Icon name={folder.icon} />
        </span>
        <div>
          <h1 className="folder-head__name">{folder.name}</h1>
          <p className="folder-head__count">
            {installed.length} z {items.length}{' '}
            {items.length === 1 ? 'modułu włączony' : 'modułów włączonych'}
          </p>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="glass empty-state">
          W tym folderze nie ma jeszcze modułów dla Twojego systemu.
        </div>
      ) : (
        <div className="module-grid">
          {items.map((m) => {
            const on = installedSet.has(m.id)
            return (
              <article key={m.id} className="glass folder-card" data-on={on}>
                <div className="folder-card__top">
                  <span className="ico-badge" style={gradientVars}>
                    <Icon name={m.icon} />
                  </span>
                  <span className={`chip ${m.risk}`}>
                    {m.risk === 'critical' ? '⚠ ' : ''}
                    {riskLabel[m.risk]}
                  </span>
                </div>

                <h2 className="folder-card__name">{m.name}</h2>
                <p className="folder-card__desc">{m.desc}</p>

                <div className="folder-card__foot">
                  {on ? (
                    <button
                      className="btn btn-primary btn-mini"
                      onClick={() => setView({ kind: 'module', moduleId: m.id })}
                    >
                      {m.quickAction ?? 'Otwórz'}
                    </button>
                  ) : (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={() => setModuleInstalled(m.id, true)}
                    >
                      Włącz moduł
                    </button>
                  )}

                  {on && (
                    <button
                      className="btn btn-ghost btn-mini"
                      onClick={() => setModuleInstalled(m.id, false)}
                      title="Ukryj ten moduł — pliki zostają na dysku"
                    >
                      Wyłącz
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}
