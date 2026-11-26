import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { capabilitiesForAll } from '../../data/capabilities'
import type { AccessLevel, OnboardingResult } from '../../state/appState'
import { detectOs } from '../../state/appState'
import type { Os } from '../../data/modules'
import { folders, modulesForOs } from '../../data/modules'
import type { LinuxProfile, ProfileOverrides } from '../../data/linuxProfile'
import { Icon } from '../Icons'
import { SystemProfileFields, profileSummary } from '../SystemProfile'
import { t } from '../../i18n'

const OS_LABEL: Record<Os, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

type Step = 'consent' | 'os' | 'access' | 'modules' | 'tutorial'
const STEPS: Step[] = ['consent', 'os', 'access', 'modules', 'tutorial']

interface OnboardingProps {
  onDone: (result: OnboardingResult) => void
  /** Null until detection answers, and always off Linux. */
  linuxProfile: LinuxProfile | null
  onProfileChange: (overrides: ProfileOverrides) => Promise<void>
}

export function Onboarding({ onDone, linuxProfile, onProfileChange }: OnboardingProps) {
  const [step, setStep] = useState<Step>('consent')
  const [os] = useState<Os>(detectOs)
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [correcting, setCorrecting] = useState(false)

  const stepIndex = STEPS.indexOf(step)
  const available = useMemo(() => modulesForOs(os, linuxProfile), [os, linuxProfile])
  const generalModules = available.filter((m) => m.os.length === 3)
  const osModules = available.filter((m) => m.os.length < 3)

  function togglePick(id: string) {
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function finish(tutorialDone: boolean) {
    const level = accessLevel ?? 'selective'

    // The core decides whether a privileged grant survives a restart, so it
    // has to know which bargain was struck — keeping this only in local
    // storage would put a security decision somewhere freely editable.
    try {
      await invoke('set_access_level', { level })

      // Full access means consent was given here, in bulk, with the list on
      // screen. Asking for it now is what makes installing a module later
      // never prompt again. Selective deliberately asks nothing yet.
      if (level === 'full') {
        for (const cap of capabilitiesForAll(picked)) {
          // One failure must not abandon the rest: a capability with no
          // broker on this platform is expected to refuse.
          try {
            await invoke('request_permission', { capability: cap.id })
          } catch {
            /* recorded as not granted; Settings shows it and offers a fix */
          }
        }
      }
    } catch {
      /* the interface still opens; permissions are re-requested on first use */
    }

    onDone({
      consentAccepted: true,
      os,
      accessLevel: level,
      installedModules: [...picked],
      tutorialDone,
    })
  }

  return (
    <div className="onboarding">
      <div className="onboarding-card">
        <div className="onboarding-progress" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'done' : ''} />
          ))}
        </div>

        {step === 'consent' && (
          <>
            <h1>{t('onboarding.welcome.title')}</h1>
            <p className="lead">{t('onboarding.welcome.lead')}</p>
            <div className="onboarding-actions">
              <span />
              <button className="btn btn-primary" onClick={() => setStep('os')}>{t('onboarding.welcome.agree')}</button>
            </div>
          </>
        )}

        {step === 'os' && (
          <>
            <h2>{t('onboarding.os.title')}</h2>
            <p className="lead">
              {linuxProfile
                ? t('onboarding.os.lead.linux')
                : t('onboarding.os.lead.other')}
            </p>
            <div className="os-row">
              <div className="ico-badge" style={{ '--g1': 'var(--g-blue-1)', '--g2': 'var(--g-blue-2)' } as React.CSSProperties}>
                <Icon name={os} />
              </div>
              <div>
                <div className="os-name">{linuxProfile?.name ?? OS_LABEL[os]}</div>
                <div className="os-sub">
                  {linuxProfile
                    ? `${OS_LABEL[os]} · ${profileSummary(linuxProfile)}`
                    : t('onboarding.os.sub.other', { os: OS_LABEL[os] })}
                </div>
              </div>
            </div>
            {linuxProfile && correcting && (
              <div className="profile-fields">
                <SystemProfileFields profile={linuxProfile} onSave={onProfileChange} />
              </div>
            )}
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('consent')}>{t('onboarding.back')}</button>
              <div className="onboarding-actions-end">
                {linuxProfile && !correcting && (
                  <button className="btn btn-ghost" onClick={() => setCorrecting(true)}>{t('onboarding.os.mismatch')}</button>
                )}
                <button className="btn btn-primary" onClick={() => setStep('access')}>
                  {correcting ? t('onboarding.os.done') : t('onboarding.os.confirm')}
                </button>
              </div>
            </div>
          </>
        )}

        {step === 'access' && (
          <>
            <h2>{t('onboarding.access.title')}</h2>
            <p className="lead">{t('onboarding.access.lead')}</p>
            <div className="choice-cards">
              <button
                className={`choice-card${accessLevel === 'full' ? ' selected' : ''}`}
                onClick={() => setAccessLevel('full')}
              >
                <h3>{t('onboarding.access.full.title')}</h3>
                <p>{t('onboarding.access.full.desc')}</p>
                <span className="fine">{t('onboarding.access.full.fine')}</span>
              </button>
              <button
                className={`choice-card${accessLevel === 'selective' ? ' selected' : ''}`}
                onClick={() => setAccessLevel('selective')}
              >
                <h3>{t('onboarding.access.selective.title')}</h3>
                <p>{t('onboarding.access.selective.desc')}</p>
                <span className="fine">{t('onboarding.access.selective.fine')}</span>
              </button>
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('os')}>{t('onboarding.back')}</button>
              <button className="btn btn-primary" disabled={!accessLevel} onClick={() => setStep('modules')}>
                {t('onboarding.next')}
              </button>
            </div>
          </>
        )}

        {step === 'modules' && (
          <>
            <h2>{t('onboarding.modules.title')}</h2>
            <p className="lead">{t('onboarding.modules.lead')}</p>
            <div className="module-pick-list">
              <div className="module-pick-group">
                <span className="kicker">{t('onboarding.modules.general')}</span>
                {generalModules.map((m) => {
                  const folder = folders.find((f) => f.id === m.folder)!
                  return (
                    <label className="module-pick" key={m.id} style={{ '--g1': folder.gradient.g1 } as React.CSSProperties}>
                      <div className="ico-badge" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
                        <Icon name={m.icon} />
                      </div>
                      <div className="mp-text">
                        <div className="mp-name">{m.name}</div>
                        <div className="mp-desc">{m.desc}</div>
                      </div>
                      <button
                        type="button"
                        className={`toggle${picked.has(m.id) ? ' on' : ''}`}
                        style={{ '--g1': folder.gradient.g1 } as React.CSSProperties}
                        aria-label={t(picked.has(m.id) ? 'onboarding.modules.unselect' : 'onboarding.modules.select', { name: m.name })}
                        onClick={() => togglePick(m.id)}
                      />
                    </label>
                  )
                })}
              </div>
              {osModules.length > 0 && (
                <div className="module-pick-group">
                  <span className="kicker">{t('onboarding.modules.only-os', { os: OS_LABEL[os] })}</span>
                  {osModules.map((m) => {
                    const folder = folders.find((f) => f.id === m.folder)!
                    return (
                      <label className="module-pick" key={m.id} style={{ '--g1': folder.gradient.g1 } as React.CSSProperties}>
                        <div className="ico-badge" style={{ '--g1': folder.gradient.g1, '--g2': folder.gradient.g2 } as React.CSSProperties}>
                          <Icon name={m.icon} />
                        </div>
                        <div className="mp-text">
                          <div className="mp-name">{m.name}</div>
                          <div className="mp-desc">{m.desc}</div>
                        </div>
                        <button
                          type="button"
                          className={`toggle${picked.has(m.id) ? ' on' : ''}`}
                          style={{ '--g1': folder.gradient.g1 } as React.CSSProperties}
                          aria-label={t(picked.has(m.id) ? 'onboarding.modules.unselect' : 'onboarding.modules.select', { name: m.name })}
                          onClick={() => togglePick(m.id)}
                        />
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('access')}>{t('onboarding.back')}</button>
              <button className="btn btn-primary" onClick={() => setStep('tutorial')}>
                {picked.size > 0 ? t('onboarding.modules.install', { n: picked.size }) : t('onboarding.modules.skip')}
              </button>
            </div>
          </>
        )}

        {step === 'tutorial' && (
          <>
            <h2>{t('onboarding.tutorial.title')}</h2>
            <p className="lead">{t('onboarding.tutorial.lead')}</p>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => finish(false)}>
                {t('onboarding.tutorial.later')}
              </button>
              <button className="btn btn-primary" onClick={() => finish(true)}>
                {t('onboarding.tutorial.show')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
