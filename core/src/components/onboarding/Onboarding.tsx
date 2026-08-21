import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { capabilitiesForAll } from '../../data/capabilities'
import type { AccessLevel, OnboardingResult } from '../../state/appState'
import { detectOs } from '../../state/appState'
import type { Os } from '../../data/modules'
import { folders, modulesForOs } from '../../data/modules'
import { Icon } from '../Icons'

const OS_LABEL: Record<Os, string> = { windows: 'Windows', linux: 'Linux', macos: 'macOS' }

const MESH_BLOBS = [
  { bx: 0.18, by: 0.22, r: 0.42, sx: 0.00012, sy: 0.00016, phase: 0, c: '#a83dff' },
  { bx: 0.82, by: 0.18, r: 0.4, sx: 0.00015, sy: 0.00011, phase: 2, c: '#ff3d9e' },
  { bx: 0.5, by: 0.55, r: 0.46, sx: 0.00011, sy: 0.00018, phase: 4, c: '#3d8bff' },
  { bx: 0.78, by: 0.78, r: 0.38, sx: 0.00017, sy: 0.00013, phase: 1, c: '#34e6c8' },
]

function OnboardingMesh() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    function size() {
      canvas!.width = window.innerWidth * 1.2
      canvas!.height = window.innerHeight * 1.2
    }
    size()
    window.addEventListener('resize', size)
    let raf = 0
    function draw(t: number) {
      const w = canvas!.width
      const h = canvas!.height
      ctx!.clearRect(0, 0, w, h)
      ctx!.globalCompositeOperation = 'lighter'
      MESH_BLOBS.forEach((b) => {
        const time = reduce ? 0 : t
        const cx = (b.bx + Math.sin(time * b.sx + b.phase) * 0.12) * w
        const cy = (b.by + Math.cos(time * b.sy + b.phase) * 0.12) * h
        const r = Math.max(w, h) * b.r
        const grad = ctx!.createRadialGradient(cx, cy, 0, cx, cy, r)
        grad.addColorStop(0, b.c + '77')
        grad.addColorStop(1, b.c + '00')
        ctx!.fillStyle = grad
        ctx!.beginPath()
        ctx!.arc(cx, cy, r, 0, Math.PI * 2)
        ctx!.fill()
      })
      ctx!.globalCompositeOperation = 'source-over'
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      window.removeEventListener('resize', size)
      cancelAnimationFrame(raf)
    }
  }, [])
  return <canvas className="onboarding-mesh" ref={ref} />
}

type Step = 'consent' | 'os' | 'access' | 'modules' | 'tutorial'
const STEPS: Step[] = ['consent', 'os', 'access', 'modules', 'tutorial']

export function Onboarding({ onDone }: { onDone: (result: OnboardingResult) => void }) {
  const [step, setStep] = useState<Step>('consent')
  const [os] = useState<Os>(detectOs)
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())

  const stepIndex = STEPS.indexOf(step)
  const available = useMemo(() => modulesForOs(os), [os])
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
      <OnboardingMesh />
      <div className="onboarding-card">
        <div className="onboarding-progress" aria-hidden>
          {STEPS.map((s, i) => (
            <span key={s} className={i <= stepIndex ? 'done' : ''} />
          ))}
        </div>

        {step === 'consent' && (
          <>
            <h1>Witaj w POSMA</h1>
            <p className="lead">
              POSMA to modularny opiekun systemu — czyszczenie, monitoring, autostart, bezpieczeństwo. Zanim
              zaczniemy, potrzebujemy Twojej zgody na działanie aplikacji i wykonywanie operacji na tym komputerze.
              Wszystkie ryzykowne akcje zawsze wymagają osobnego potwierdzenia.
            </p>
            <div className="onboarding-actions">
              <span />
              <button className="btn btn-primary" onClick={() => setStep('os')}>Zgadzam się, zaczynamy</button>
            </div>
          </>
        )}

        {step === 'os' && (
          <>
            <h2>Potwierdź swój system</h2>
            <p className="lead">Wykryliśmy system operacyjny — od tego zależy, które moduły będą dostępne.</p>
            <div className="os-row">
              <div className="ico-badge" style={{ '--g1': 'var(--g-blue-1)', '--g2': 'var(--g-blue-2)' } as React.CSSProperties}>
                <Icon name={os} />
              </div>
              <div>
                <div className="os-name">{OS_LABEL[os]}</div>
                <div className="os-sub">Moduły ogólne + moduły dostępne tylko dla {OS_LABEL[os]}</div>
              </div>
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('consent')}>Wstecz</button>
              <button className="btn btn-primary" onClick={() => setStep('access')}>To mój system</button>
            </div>
          </>
        )}

        {step === 'access' && (
          <>
            <h2>Poziom dostępu</h2>
            <p className="lead">Możesz to później zmienić w ustawieniach.</p>
            <div className="choice-cards">
              <button
                className={`choice-card${accessLevel === 'full' ? ' selected' : ''}`}
                onClick={() => setAccessLevel('full')}
              >
                <h3>Pełny</h3>
                <p>
                  Aplikacja od razu zbiera dostęp do każdej możliwej funkcji — niezależnie od tego, czy moduł jest
                  zainstalowany.
                </p>
                <span className="fine">Cel: minimum restartów i zgód. Efekt: brak restartów przy doinstalowywaniu modułów.</span>
              </button>
              <button
                className={`choice-card${accessLevel === 'selective' ? ' selected' : ''}`}
                onClick={() => setAccessLevel('selective')}
              >
                <h3>Wybiórczy</h3>
                <p>Aplikacja prosi o dostęp potrzebny tylko do modułów, które faktycznie wybierzesz.</p>
                <span className="fine">Efekt: możliwy restart aplikacji/systemu przy doinstalowywaniu kolejnych modułów.</span>
              </button>
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('os')}>Wstecz</button>
              <button className="btn btn-primary" disabled={!accessLevel} onClick={() => setStep('modules')}>
                Dalej
              </button>
            </div>
          </>
        )}

        {step === 'modules' && (
          <>
            <h2>Wybierz moduły</h2>
            <p className="lead">
              Zainstalujemy tylko to, co zaznaczysz — resztę możesz doinstalować później w zarządzaniu modułami.
            </p>
            <div className="module-pick-list">
              <div className="module-pick-group">
                <span className="kicker">Ogólne</span>
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
                        aria-label={`${picked.has(m.id) ? 'Odznacz' : 'Zaznacz'} ${m.name}`}
                        onClick={() => togglePick(m.id)}
                      />
                    </label>
                  )
                })}
              </div>
              {osModules.length > 0 && (
                <div className="module-pick-group">
                  <span className="kicker">Tylko {OS_LABEL[os]}</span>
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
                          aria-label={`${picked.has(m.id) ? 'Odznacz' : 'Zaznacz'} ${m.name}`}
                          onClick={() => togglePick(m.id)}
                        />
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => setStep('access')}>Wstecz</button>
              <button className="btn btn-primary" onClick={() => setStep('tutorial')}>
                {picked.size > 0 ? `Zainstaluj ${picked.size} ${picked.size === 1 ? 'moduł' : 'moduły'}` : 'Pomiń na razie'}
              </button>
            </div>
          </>
        )}

        {step === 'tutorial' && (
          <>
            <h2>Prawie gotowe</h2>
            <p className="lead">
              Chcesz krótkie oprowadzenie po funkcjach i modułach? Zajmie mniej niż minutę i pokaże, gdzie co jest.
            </p>
            <div className="onboarding-actions">
              <button className="btn btn-ghost" onClick={() => finish(false)}>
                Pomiń tutorial (niezalecane)
              </button>
              <button className="btn btn-primary" onClick={() => finish(true)}>
                Pokaż mi aplikację
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
