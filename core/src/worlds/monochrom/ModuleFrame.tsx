import type { AppState } from '../../state/appState'
import { catalogNumbers, folders, moduleById, riskLabel } from '../../data/modules'
import { ModuleBody } from '../../views/ModuleView'
import { Pair, PairRail } from './pairs'
import { t } from '../../i18n'

const steps = () => [
  { name: t('world.monochrom.module.step.read'), text: t('world.monochrom.module.step.read.text') },
  { name: t('world.monochrom.module.step.choose'), text: t('world.monochrom.module.step.choose.text') },
  { name: t('world.monochrom.module.step.confirm'), text: t('world.monochrom.module.step.confirm.text') },
]

const rail = () => [
  { id: 'mono-module-top', label: t('world.monochrom.module.rail.module') },
  { id: 'mono-how', label: t('world.monochrom.module.rail.how') },
]

/** A module: its name as the claim, its own interface as the proof under it. */
export function ModuleFrame({ app, moduleId }: { app: AppState; moduleId: string }) {
  const mod = moduleById(moduleId, app.linuxProfile)
  if (!mod) {
    return (
      <div className="mono-pairs">
        <header className="mono-modhead">
          <h1>{t('world.monochrom.module.missing')}</h1>
          <div className="mono-actions">
            <button className="btn btn-ghost" onClick={() => app.setView({ kind: 'dashboard' })}>{t('world.monochrom.back')}</button>
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
          <nav className="mono-crumbs" aria-label={t('world.monochrom.module.path')}>
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
              <h2>{t('world.monochrom.module.claim')}</h2>
              <p>{t('world.monochrom.module.claim-sub', { name: mod.name })}</p>
            </>
          }
          proof={
            <div className="mono-shot">
              <div className="mono-shot__head">
                <h3>{t('world.monochrom.module.how')}</h3>
                <span>{t('world.monochrom.module.risk', { risk: riskLabel[mod.risk].toLowerCase() })}</span>
              </div>
              <dl className="mono-steps">
                {steps().map((s) => (
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
      <PairRail items={rail()} />
    </>
  )
}
