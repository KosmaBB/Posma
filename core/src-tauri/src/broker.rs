//! Talks to the privileged Linux broker, over whichever transport is
//! actually available (Access_plan.md §4 / §6 step 3):
//!
//!  - **daemon socket** (`/run/posma-broker.sock`) if `modules/linux-broker
//!    --daemon` is installed and running (`install-daemon.sh`) — no prompt
//!    at all, this is what "Pełny" mode gets.
//!  - **`pkexec`** per call otherwise — the cold-start path that always
//!    works without any installation, "Wybiórczy" mode's per-action prompt.
//!
//! Same one-line-JSON request/response either way (see
//! `modules/linux-broker/src/main.rs::handle_line`), so callers in lib.rs
//! don't need to know which transport actually served the request.
//!
//! Linux only; Windows/macOS brokers aren't implemented, and callers get
//! an honest error rather than a silent no-op.

use std::path::PathBuf;
use std::process::Stdio;

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixStream;
use tokio::process::Command;

#[cfg(unix)]
const DAEMON_SOCKET_PATH: &str = "/run/posma-broker.sock";

/// Which broker binary serves this OS. All three speak the identical
/// protocol from the shared `broker-common` crate, so everything below
/// this function is OS-agnostic — bringing up macOS/Windows is a matter of
/// their broker implementing more operations, not of new plumbing here.
const fn broker_binary_name() -> &'static str {
    if cfg!(target_os = "linux") {
        "linux-broker"
    } else if cfg!(target_os = "macos") {
        "macos-broker"
    } else {
        "windows-broker"
    }
}

/// The one-shot broker binary is shipped as a Tauri externalBin sidecar,
/// which the build places next to the main executable (same convention
/// `call_sidecar` relies on via `ShellExt::sidecar`) — resolved manually
/// here instead of through `sidecar()` because it needs an elevation
/// prefix, not a direct spawn. The daemon-mode binary is a separate
/// installed copy (see install-daemon.sh) and isn't referenced from here
/// at all — core only ever talks to it over the socket.
fn broker_binary_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe.parent().ok_or("nie udało się ustalić katalogu aplikacji")?;
    Ok(dir.join(broker_binary_name()))
}

/// Distinguishes "couldn't reach the daemon at all" (safe to fall back to
/// pkexec) from "reached it, then something failed" (NOT safe to fall back:
/// the daemon may have already executed the operation, and re-running a
/// destructive op via pkexec would execute it twice).
#[cfg(unix)]
enum DaemonCallError {
    NotReachable,
    AfterConnect(String),
}

#[cfg(unix)]
async fn call_via_daemon(request: &serde_json::Value) -> Result<serde_json::Value, DaemonCallError> {
    let mut stream = UnixStream::connect(DAEMON_SOCKET_PATH)
        .await
        .map_err(|_| DaemonCallError::NotReachable)?;

    let mut payload = serde_json::to_string(request).map_err(|e| DaemonCallError::AfterConnect(e.to_string()))?;
    payload.push('\n');
    stream
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| DaemonCallError::AfterConnect(e.to_string()))?;

    let (read_half, _) = stream.into_split();
    let line = BufReader::new(read_half)
        .lines()
        .next_line()
        .await
        .map_err(|e| DaemonCallError::AfterConnect(e.to_string()))?;

    match line {
        Some(text) if !text.trim().is_empty() => {
            serde_json::from_str(text.trim()).map_err(|e| DaemonCallError::AfterConnect(e.to_string()))
        }
        // A connection the daemon accepted but answered with nothing is the
        // SO_PEERCRED rejection path (it closes without a byte) — treat as a
        // real refusal, not as "daemon missing".
        _ => Err(DaemonCallError::AfterConnect(
            "demon brokera odrzucił połączenie lub nie zwrócił odpowiedzi".into(),
        )),
    }
}

/// How this OS raises one privileged invocation. Linux uses pkexec;
/// macOS/Windows are launched directly and are expected to be started from
/// an already-elevated context (osascript admin prompt / UAC) — both are
/// scaffolded, not verified on real hardware yet.
fn elevation_wrapper() -> Option<&'static str> {
    if cfg!(target_os = "linux") {
        Some("pkexec")
    } else {
        None
    }
}

async fn call_via_pkexec(request: &serde_json::Value) -> Result<serde_json::Value, String> {
    let binary = broker_binary_path()?;
    let mut command = match elevation_wrapper() {
        Some(wrapper) => {
            let mut c = Command::new(wrapper);
            c.arg(&binary);
            c
        }
        None => Command::new(&binary),
    };
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("nie udało się uruchomić brokera: {e}"))?;

    let mut payload = serde_json::to_string(request).map_err(|e| e.to_string())?;
    payload.push('\n');
    child
        .stdin
        .take()
        .ok_or("broker nie ma stdin")?
        .write_all(payload.as_bytes())
        .await
        .map_err(|e| e.to_string())?;

    let stdout = child.stdout.take().ok_or("broker nie ma stdout")?;
    let line = BufReader::new(stdout).lines().next_line().await.map_err(|e| e.to_string())?;

    let status = child.wait().await.map_err(|e| e.to_string())?;

    match line {
        Some(text) if !text.trim().is_empty() => serde_json::from_str(text.trim()).map_err(|e| e.to_string()),
        _ if !status.success() => Err("odmowa autoryzacji lub błąd brokera (pkexec)".into()),
        _ => Err("broker nie zwrócił odpowiedzi".into()),
    }
}

pub async fn call_broker(request: serde_json::Value) -> Result<serde_json::Value, String> {
    // No OS gate: every platform has a broker binary speaking the same
    // protocol. Operations a given OS's broker doesn't implement come back
    // as a normal "nieobsługiwane na tym systemie" result from the shared
    // trait defaults, which is more useful than blanket-refusing here.

    // The daemon is entirely optional infrastructure — if it's not
    // installed/running, connect() fails fast (ConnectionRefused / NotFound)
    // and pkexec picks up the request instead, exactly as if the daemon
    // never existed. But once a connection was established, NO fallback:
    // the daemon may have already executed the (possibly destructive)
    // operation even if reading its answer failed, and running it again
    // via pkexec would execute it twice.
    #[cfg(unix)]
    {
        match call_via_daemon(&request).await {
            Ok(response) => Ok(response),
            Err(DaemonCallError::NotReachable) => call_via_pkexec(&request).await,
            Err(DaemonCallError::AfterConnect(e)) => Err(format!(
                "błąd komunikacji z demonem brokera (operacja mogła zostać wykonana — sprawdź stan zanim powtórzysz): {e}"
            )),
        }
    }
    // Windows has no Unix-socket daemon (its named-pipe equivalent is
    // deliberately unimplemented — see modules/windows-broker), so every
    // call goes through the one-shot elevated path.
    #[cfg(not(unix))]
    {
        call_via_pkexec(&request).await
    }
}
