import type { ReactNode } from 'react'

interface SettingRowProps {
  name: string
  desc: ReactNode
  children: ReactNode
  danger?: boolean
  /** Names the row for the guided tour. */
  tour?: string
}

/** A label and its explanation, with whatever control it takes on the right. */
export function SettingRow({ name, desc, children, danger, tour }: SettingRowProps) {
  return (
    <div
      className="glass setting-row"
      data-tour={tour}
      style={danger ? { borderColor: 'color-mix(in srgb, var(--critical) 35%, transparent)' } : undefined}
    >
      <div className="st-text">
        <div className="st-name" style={danger ? { color: 'var(--critical)' } : undefined}>{name}</div>
        <div className="st-desc">{desc}</div>
      </div>
      {children}
    </div>
  )
}
