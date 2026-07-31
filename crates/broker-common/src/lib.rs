//! Shared foundation for POSMA's privileged brokers (Access_plan.md §4).
//!
//! One crate holds the closed cross-OS operation catalog, the response
//! shapes, the safety guards, the request dispatch and the run modes — so
//! a per-OS broker binary is only the part that's genuinely OS-specific:
//! which operations it can honour and how it carries them out.
//!
//! The design goal is that adding an OS or an operation is *additive*:
//! every catalogued operation already exists as a defaulted trait method
//! answering honestly that it isn't supported here, so a new broker
//! compiles and behaves correctly before a single operation is written,
//! and each one lands by overriding one method.

pub mod broker;
pub mod guards;
pub mod ops;
pub mod result;
pub mod serve;

pub use broker::{handle_line, run_capture, run_verify, write_system_file_guarded, Broker};
pub use ops::{PkgSource, Request, TrimMode};
pub use result::{BootEntries, CapabilityReport, CleanResult, ExecResult, Response, TextResult};
pub use serve::run_once;

#[cfg(unix)]
pub use serve::run_daemon;
