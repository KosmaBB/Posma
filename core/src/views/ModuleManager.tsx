import type { AppState } from '../state/appState'
import { useEffect, useRef } from 'react'
import { applyOrder, folders, modulesForOs, riskLabel } from '../data/modules'
import { Icon } from '../components/Icons'

/**
 * Mind map: "Pełna lista dostępnych modułów, krytyczne i bardziej zagrażające
 * błędami krytycznymi dla systemu z odpowiednim alertem" + doinstalowanie /
 * odinstalowanie. Custom modules ("Tworzenie modułu") come later.
 */
export function ModuleManager({ app }: { app: AppState }) {
  const { onboarding, installedSet, setModuleInstalled, moduleOrder, linuxProfile } = app
  const os = onboarding?.os ?? 'linux'
  const available = modulesForOs(os, linuxProfile)

  /**
   * Spotlight position for the card under the pointer.
   *
   * Both halves of this used to happen on every mousemove: reading the
   * card's box forces the browser to settle layout right then, and writing
   * the two custom properties repaints a gradient across the whole card.
   * At the rate a pointer reports, that was over a hundred forced layouts a
   * second. The read is cached per card and the write waits for a frame, so
   * at most one repaint happens per frame no matter how fast the mouse moves.
   */
  const pending = useRef<{ el: HTMLElement; x: number; y: number } | null>(null)
  const frame = useRef(0)
  const boxes = useRef(new WeakMap<HTMLElement, DOMRect>())

  function onCardMouseMove(e: React.MouseEvent<HTMLElement>) {
    const el = e.currentTarget
    let rect = boxes.current.get(el)
    if (!rect) {
      rect = el.getBoundingClientRect()
      boxes.current.set(el, rect)
    }
    pending.current = {
      el,
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
    if (frame.current) return
    frame.current = requestAnimationFrame(() => {
      frame.current = 0
      const p = pending.current
      if (!p) return
      p.el.style.setProperty('--mx', `${p.x}%`)
      p.el.style.setProperty('--my', `${p.y}%`)
    })
  }

  // A cached box is wrong once anything moves; the window changing size is
  // the case that actually happens here.
  useEffect(() => {
    const drop = () => {
      boxes.current = new WeakMap()
    }
    window.addEventListener('resize', drop)
    return () => window.removeEventListener('resize', drop)
  }, [])

  return (
    <div className="view-enter">
      {folders.map((folder) => {
        const items = applyOrder(available.filter((m) => m.folder === folder.id), moduleOrder[folder.id])
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
