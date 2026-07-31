//! Canonical capability catalog — mirrors `core/src/data/capabilities.ts`.
//! See Access_plan.md §2 for the full design. This is the source of truth
//! the (future) permission registry validates module manifests against
//! before any request reaches the privileged broker.
//!
//! Keep this file and the TypeScript copy in sync by hand for now — there
//! are few enough entries that codegen would be premature.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Elevation {
    None,
    Optional,
    Required,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityId {
    FsUser,
    FsSystem,
    FsScan,
    Pkg,
    Svc,
    AutostartUser,
    AutostartSystem,
    Boot,
    DiskSmart,
    RestorePoint,
    Fda,
    Secrets,
    Net,
}

pub struct CapabilityDef {
    pub id: CapabilityId,
    pub elevation: Elevation,
    /// true if this can only ever be granted by the user acting in the OS's
    /// own settings UI (e.g. macOS Full Disk Access) — never automatable.
    pub manual_only: bool,
}

pub const CAPABILITIES: &[CapabilityDef] = &[
    CapabilityDef { id: CapabilityId::FsUser, elevation: Elevation::None, manual_only: false },
    CapabilityDef { id: CapabilityId::FsSystem, elevation: Elevation::Required, manual_only: false },
    CapabilityDef { id: CapabilityId::FsScan, elevation: Elevation::Optional, manual_only: false },
    CapabilityDef { id: CapabilityId::Pkg, elevation: Elevation::Optional, manual_only: false },
    CapabilityDef { id: CapabilityId::Svc, elevation: Elevation::Required, manual_only: false },
    CapabilityDef { id: CapabilityId::AutostartUser, elevation: Elevation::None, manual_only: false },
    CapabilityDef { id: CapabilityId::AutostartSystem, elevation: Elevation::Required, manual_only: false },
    CapabilityDef { id: CapabilityId::Boot, elevation: Elevation::Required, manual_only: false },
    CapabilityDef { id: CapabilityId::DiskSmart, elevation: Elevation::Required, manual_only: false },
    CapabilityDef { id: CapabilityId::RestorePoint, elevation: Elevation::Required, manual_only: false },
    CapabilityDef { id: CapabilityId::Fda, elevation: Elevation::Required, manual_only: true },
    CapabilityDef { id: CapabilityId::Secrets, elevation: Elevation::None, manual_only: false },
    CapabilityDef { id: CapabilityId::Net, elevation: Elevation::None, manual_only: false },
];
