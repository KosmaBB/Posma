import type { CSSProperties, ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Renders into document.body via a portal rather than in place. Every
 * module view is wrapped in .view-enter, whose entry animation uses
 * `animation: ... both` — that keeps `transform: translateY(0)` applied to
 * it permanently (fill-mode, not just during the animation), and any
 * transform on an ancestor makes it the containing block for
 * `position: fixed` descendants. Without the portal, .modal-backdrop's
 * `position: fixed; inset: 0` centers within that ancestor's bounds
 * instead of the real viewport — confirmed live 2026-07-31: the uninstall
 * dialog rendered pinned to the middle of the app list instead of the
 * screen. The portal sidesteps the whole issue by not being a DOM
 * descendant of .view-enter at all.
 */
export function Modal({
  onClose,
  children,
  cardClassName = 'modal-card',
  style,
}: {
  onClose: () => void
  children: ReactNode
  cardClassName?: string
  style?: CSSProperties
}) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      <div className={cardClassName} onClick={(e) => e.stopPropagation()} style={style}>
        {children}
      </div>
    </div>,
    document.body,
  )
}
