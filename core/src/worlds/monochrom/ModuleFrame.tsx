import type { AppState } from '../../state/appState'
import { catalogNumbers, folders, moduleById, riskLabel } from '../../data/modules'
import { ModuleBody } from '../../views/ModuleView'
import { Pair, PairRail } from './pairs'

const STEPS = [
  { name: 'Odczyt', text: 'Moduł zaczyna od odczytu: pokazuje, co znalazł, i niczego nie zmienia.' },
  { name: 'Wybór', text: 'Ty decydujesz, których pozycji dotyczy zmiana.' },
  { name: 'Potwierdzenie', text: 'Zmiana zachodzi dopiero po Twoim potwierdzeniu. Im wyższe ryzyko, tym więcej pytań.' },
]

const RAIL = [
  { id: 'mono-module-top', label: 'Moduł' },
  { id: 'mono-how', label: 'Jak działa' },
]

/** A module: its name as the claim, its own interface as the proof under it. */
export function ModuleFrame({ app, moduleId }: { app: AppState; moduleId: string }) {
  const mod = moduleById(moduleId, app.linuxProfile)
  if (!mod) {
    return (
      <div className="mono-pairs">
        <header className="mono-modhead">
          <h1>Nie znaleziono modułu.</h1>
          <div className="mono-actions">
            <button className="btn btn-ghost" onClick={() => app.setView({ kind: 'dashboard' })}>Wróć do przeglądu</button>
          </div>
        </header>
      </div>
    )
  }
  const folder = folders.find((f) => f.id === mod.folder)!
  const no = catalogNumbers(app.onboarding?.os, app.linuxProfile).get(mod.id) ?? '—'

  return (
    <>
      <div className="mono-pairs mono-module" data-tour="module">
        <header className="mono-modhead" id="mono-module-top" data-tour="module-hero">
          <nav className="mono-crumbs" aria-label="Ścieżka">
            <button className="mono-link" onClick={() => app.setView({ kind: 'folder', folderId: folder.id })}>{folder.name}</button>
            <span aria-hidden="true">/</span>
            <b>{no} {mod.name}</b>
            <span className={`mono-risk mono-risk--${mod.risk}`}>{riskLabel[mod.risk]}</span>
          </nav>
          <h1>{mod.name}</h1>
          <p>{mod.desc}</p>
        </header>
        <figure className="mono-proof mono-proof--body">
          <ModuleBody app={app} mod={mod} />
        </figure>
        <Pair
          id="mono-how"
          flip
          claim={
            <>
              <h2>Nic nie znika bez potwierdzenia.</h2>
              <p>Tak pracuje każdy moduł, także {mod.name}.</p>
            </>
          }
          proof={
            <div className="mono-shot">
              <div className="mono-shot__head">
                <h3>Jak pracuje moduł</h3>
                <span>ryzyko: {riskLabel[mod.risk].toLowerCase()}</span>
              </div>
              <dl className="mono-steps">
                {STEPS.map((s) => (
                  <div key={s.name}>
                    <dt>{s.name}</dt>
                    <dd>{s.text}</dd>
                  </div>
                ))}
              </dl>
            </div>
          }
        />
      </div>
      <PairRail items={RAIL} />
    </>
  )
}
