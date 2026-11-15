import { useMemo, type CSSProperties } from 'react'
import type { AppState } from '../../state/appState'
import { catalogNumbers, folderNumber, folders, moduleById, riskLabel } from '../../data/modules'
import { ModuleBody } from '../../views/ModuleView'
import { Band, Key } from './parts'

/**
 * A module's cassette, inserted: the j-card's title strip carries number,
 * name, risk and what it does; the module's own interface sits on the lined
 * stock below it, drawn from the shared blocks.
 */
export function ModuleFrame({ app, moduleId }: { app: AppState; moduleId: string }) {
  const { setView, onboarding, linuxProfile } = app
  const numbers = useMemo(() => catalogNumbers(onboarding?.os, linuxProfile), [onboarding?.os, linuxProfile])
  const mod = moduleById(moduleId, linuxProfile)

  if (!mod) {
    return (
      <div className="ks-page">
        <section className="ks-page__stock">
          <Band />
          <div className="ks-page__body empty-state">
            Nie ma takiej kasety na półce.
            <br />
            <button type="button" className="btn btn-primary" onClick={() => setView({ kind: 'dashboard' })}>
              Wróć na pulpit
            </button>
          </div>
        </section>
      </div>
    )
  }

  const folder = folders.find((f) => f.id === mod.folder)!
  const no = numbers.get(mod.id) ?? '—'

  return (
    <div className="ks-moduleview">
      <div className="ks-page ks-page--module" style={{ '--code': folder.gradient.g1 } as CSSProperties}>
        <div className="ks-page__spine" aria-hidden="true">
          <span>
            {mod.name} · {no}
          </span>
        </div>
        <section className="ks-page__stock" data-tour="module">
          <header className="ks-hero" data-tour="module-hero">
            <Band>
              <span className="ks-band__no">{no}</span>
            </Band>
            <div className="ks-hero__body">
              <h1 className="ks-hero__title">
                {mod.name}
                <span> · {no}</span>
              </h1>
              <p className="ks-hero__desc">{mod.desc}</p>
              <dl className="ks-hero__fields">
                <div>
                  <dt className="ks-printed">Folder</dt>
                  <dd>
                    {folderNumber(folder.id)} · {folder.name}
                  </dd>
                </div>
                <div>
                  <dt className="ks-printed">Ryzyko</dt>
                  <dd>
                    <span className={`chip ${mod.risk}`}>{riskLabel[mod.risk]}</span>
                  </dd>
                </div>
              </dl>
            </div>
          </header>
          <ModuleBody app={app} mod={mod} />
        </section>
      </div>
      <div className="ks-deck ks-deck--module">
        <div className="ks-keys">
          <Key icon="eject" label="Na półkę" sub="wróć na pulpit" onClick={() => setView({ kind: 'dashboard' })} />
        </div>
        <p className="ks-pen ks-deck__note">nic nie znika, dopóki nie potwierdzisz w module</p>
      </div>
    </div>
  )
}
