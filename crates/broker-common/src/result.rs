//! Response shapes shared by every broker on every OS. The wire format is
//! identical to what the unprivileged sidecars already speak (`{"ok":true,
//! "data":...}` / `{"ok":false,"error":"..."}`), so `core`'s frontend
//! handling doesn't branch on whether an answer came from a sidecar or a
//! broker.

use serde::Serialize;

/// Result of an operation that shells out to one system command.
#[derive(Debug, Serialize)]
pub struct ExecResult {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
}

impl ExecResult {
    pub fn ok(output: String) -> Self {
        Self { success: true, output, error: None }
    }

    pub fn failed(error: impl Into<String>) -> Self {
        Self { success: false, output: String::new(), error: Some(error.into()) }
    }

    /// The honest answer for a catalogued operation this OS's broker
    /// doesn't implement — deliberately a normal result rather than a
    /// protocol error, so the UI can say "not available here" plainly.
    pub fn not_supported(op: &str) -> Self {
        Self::failed(format!("{op}: operacja nieobsługiwana na tym systemie"))
    }
}

/// Result of an operation that removes files and reports what it freed.
#[derive(Debug, Serialize, Default)]
pub struct CleanResult {
    pub freed_bytes: u64,
    pub removed: u64,
    pub errors: Vec<String>,
}

impl CleanResult {
    pub fn not_supported(op: &str) -> Self {
        Self { errors: vec![format!("{op}: operacja nieobsługiwana na tym systemie")], ..Default::default() }
    }
}

#[derive(Debug, Serialize)]
pub struct TextResult {
    pub content: String,
}

#[derive(Debug, Serialize, Default)]
pub struct BootEntries {
    pub entries: Vec<String>,
}

/// What this broker can actually do, so the frontend can grey out the rest.
#[derive(Debug, Serialize)]
pub struct CapabilityReport {
    pub os: &'static str,
    pub implemented: Vec<&'static str>,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum Response<T: Serialize> {
    Ok { ok: bool, data: T },
    Err { ok: bool, error: String },
}

pub fn ok<T: Serialize>(data: T) -> Response<T> {
    Response::Ok { ok: true, data }
}

pub fn err<T: Serialize>(error: impl Into<String>) -> Response<T> {
    Response::Err { ok: false, error: error.into() }
}

/// Serializes any response to the single line the protocol expects.
pub fn line<T: Serialize>(response: &Response<T>) -> String {
    serde_json::to_string(response).unwrap_or_else(|e| {
        format!(r#"{{"ok":false,"error":"nie udało się zserializować odpowiedzi: {e}"}}"#)
    })
}
