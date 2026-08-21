/**
 * Capability catalog — a typed view of `access/catalog.json`.
 *
 * Nothing is restated here. The same file is embedded into the Rust core at
 * compile time, so the interface and the thing enforcing permissions cannot
 * describe them differently. This module exists to give that data types and
 * a couple of lookups, not to hold a second copy of it.
 */
import catalog from '../../../access/catalog.json'

export type Elevation = 'none' | 'optional' | 'required'

export interface CapabilityDef {
  id: string
  name: string
  desc: string
  elevation: Elevation
  /** True where the OS only ever lets a person grant this by hand. */
  manualOnly?: boolean
}

export type CapabilityId = string

export const capabilities: CapabilityDef[] = catalog.capabilities as CapabilityDef[]

const byId = new Map(capabilities.map((c) => [c.id, c]))

export function capability(id: CapabilityId): CapabilityDef | undefined {
  return byId.get(id)
}

/**
 * What a module is allowed to request.
 *
 * A module the catalog does not know declares nothing, which is what the
 * core assumes too: every privileged request from it is refused.
 */
export function capabilitiesFor(moduleId: string): CapabilityId[] {
  return (catalog.modules as Record<string, string[]>)[moduleId] ?? []
}

/** Capabilities a set of modules needs between them, each listed once. */
export function capabilitiesForAll(moduleIds: Iterable<string>): CapabilityDef[] {
  const seen = new Set<string>()
  for (const id of moduleIds) for (const c of capabilitiesFor(id)) seen.add(c)
  return capabilities.filter((c) => seen.has(c.id))
}

/** Only the ones that will actually prompt for elevation. */
export function needsElevation(defs: CapabilityDef[]): CapabilityDef[] {
  return defs.filter((d) => d.elevation !== 'none')
}
