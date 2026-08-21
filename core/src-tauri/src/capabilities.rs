//! Capability catalog, read from `access/catalog.json`.
//!
//! The catalog is embedded at compile time, so a malformed or missing file
//! breaks the build rather than the running application. It used to be
//! written out by hand here and again in TypeScript, with a comment asking
//! whoever came next to keep the two in step; they did not stay in step.
//!
//! `CapabilityId` stays an enum because every call site benefits from the
//! compiler rejecting a capability that does not exist. The test at the
//! bottom of this file asserts the enum and the catalog describe exactly
//! the same set, so the safety costs nothing in drift.

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::{Deserialize, Serialize};

const CATALOG_JSON: &str = include_str!("../../../access/catalog.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Elevation {
    None,
    Optional,
    Required,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Deserialize)]
pub struct CapabilityDef {
    pub id: CapabilityId,
    /// Human-facing copy. Rust never displays it — the interface reads the
    /// same catalog for that — but it is parsed here so a capability added
    /// without a description fails the test suite rather than reaching a
    /// consent screen unlabelled.
    #[allow(dead_code)]
    pub name: String,
    #[allow(dead_code)]
    pub desc: String,
    pub elevation: Elevation,
    /// True where the operating system only ever allows a person to grant
    /// this by hand — macOS Full Disk Access being the case that exists.
    #[serde(default, rename = "manualOnly")]
    pub manual_only: bool,
}

/// A privileged operation: which module it belongs to and what it costs.
#[derive(Debug, Clone, Deserialize)]
pub struct OperationDef {
    pub module: String,
    pub capability: CapabilityId,
    /// Which operation in the broker's catalog this ends up calling. Kept
    /// as a cross-reference for anyone auditing the path from a click to a
    /// privileged action; the dispatch itself lives in lib.rs.
    #[allow(dead_code)]
    #[serde(default)]
    pub broker_op: Option<String>,
}

#[derive(Deserialize)]
struct Catalog {
    capabilities: Vec<CapabilityDef>,
    /// Module id -> the capabilities that module is allowed to request.
    modules: HashMap<String, Vec<CapabilityId>>,
    /// Command name -> what performing it requires.
    operations: HashMap<String, OperationDef>,
}

static CATALOG: LazyLock<Catalog> = LazyLock::new(|| {
    serde_json::from_str(CATALOG_JSON).expect("access/catalog.json must parse")
});

pub fn capabilities() -> &'static [CapabilityDef] {
    &CATALOG.capabilities
}

pub fn definition(id: CapabilityId) -> Option<&'static CapabilityDef> {
    CATALOG.capabilities.iter().find(|d| d.id == id)
}

/// What `module` is permitted to ask for. An unknown module declares
/// nothing, which is the safe answer: every request from it is refused.
pub fn declared_by(module: &str) -> &'static [CapabilityId] {
    CATALOG.modules.get(module).map(|v| v.as_slice()).unwrap_or(&[])
}

pub fn operation(name: &str) -> Option<&'static OperationDef> {
    CATALOG.operations.get(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [CapabilityId; 13] = [
        CapabilityId::FsUser,
        CapabilityId::FsSystem,
        CapabilityId::FsScan,
        CapabilityId::Pkg,
        CapabilityId::Svc,
        CapabilityId::AutostartUser,
        CapabilityId::AutostartSystem,
        CapabilityId::Boot,
        CapabilityId::DiskSmart,
        CapabilityId::RestorePoint,
        CapabilityId::Fda,
        CapabilityId::Secrets,
        CapabilityId::Net,
    ];

    /// The whole point of keeping an enum alongside a data file: they must
    /// describe the same set, or the compile-time safety is a fiction.
    #[test]
    fn enum_and_catalog_agree() {
        let mut from_catalog: Vec<CapabilityId> = capabilities().iter().map(|d| d.id).collect();
        let mut from_enum = ALL.to_vec();
        from_catalog.sort();
        from_enum.sort();
        assert_eq!(from_enum, from_catalog, "enum and catalog list different capabilities");
    }

    #[test]
    fn every_capability_is_described() {
        for def in capabilities() {
            assert!(!def.name.trim().is_empty(), "{:?} has no name", def.id);
            assert!(!def.desc.trim().is_empty(), "{:?} has no description", def.id);
        }
    }

    /// An operation nobody is allowed to perform is a latent refusal — the
    /// user grants the capability, and the call still fails.
    #[test]
    fn every_operation_is_declared_by_its_module() {
        for (name, op) in &CATALOG.operations {
            assert!(
                declared_by(&op.module).contains(&op.capability),
                "operation {name} needs {:?} but module {} does not declare it",
                op.capability,
                op.module,
            );
        }
    }

    /// Guards the failure mode that matters most: an unknown module must
    /// come back with nothing rather than with everything.
    #[test]
    fn unknown_module_declares_nothing() {
        assert!(declared_by("nie-ma-takiego-modulu").is_empty());
    }

    /// The catalog covers the modules shipped with POSMA; each of those
    /// also carries its own manifest, because a module has to stand on its
    /// own for anyone reading it in isolation. Two accounts of the same
    /// fact drift unless something checks — that is what this is.
    ///
    /// It reads the manifests off disk rather than embedding them, so
    /// adding a module without listing it here fails immediately.
    #[test]
    fn catalog_matches_every_module_manifest() {
        use std::path::PathBuf;

        #[derive(serde::Deserialize)]
        struct Manifest {
            id: String,
            #[serde(default)]
            capabilities: Vec<CapabilityId>,
        }

        let modules_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../modules")
            .canonicalize()
            .expect("modules directory must exist");

        let mut checked = 0;
        for entry in std::fs::read_dir(&modules_dir).expect("modules directory must be readable") {
            let path = entry.expect("directory entry").path().join("module.json");
            if !path.is_file() {
                continue;
            }

            let raw = std::fs::read_to_string(&path).expect("manifest must be readable");
            let manifest: Manifest =
                serde_json::from_str(&raw).unwrap_or_else(|e| panic!("{}: {e}", path.display()));

            let mut declared = manifest.capabilities.clone();
            let mut catalogued = declared_by(&manifest.id).to_vec();
            declared.sort();
            catalogued.sort();

            assert_eq!(
                declared,
                catalogued,
                "{} declares {:?} in its manifest but {:?} in access/catalog.json",
                manifest.id,
                manifest.capabilities,
                declared_by(&manifest.id),
            );
            checked += 1;
        }

        assert!(checked > 0, "no manifests were found to check");
    }
}
