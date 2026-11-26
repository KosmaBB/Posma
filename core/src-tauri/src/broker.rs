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
//! On macOS the per-call path is the administrator prompt of
//! `do shell script` rather than pkexec. On Windows UAC asks once per run:
//! the broker it starts stays connected over a pipe until POSMA closes.

use std::path::PathBuf;
#[cfg(unix)]
use std::process::Stdio;

#[cfg(unix)]
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
#[cfg(unix)]
use tokio::net::UnixStream;
#[cfg(unix)]
use tokio::process::Command;

/// Where each broker's daemon listens; macOS has no /run.
#[cfg(unix)]
const DAEMON_SOCKET_PATH: &str = if cfg!(target_os = "macos") { "/var/run/posma-broker.sock" } else { "/run/posma-broker.sock" };

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
    // Tauri places sidecars without the target triple but with Windows' `.exe`.
    Ok(dir.join(format!("posma-{}{}", broker_binary_name(), std::env::consts::EXE_SUFFIX)))
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

/// An AppleScript string literal holding exactly `s`. The only escaping on
/// the macOS path: `quoted form of` turns the literal into one shell word,
/// so the request can carry quotes, `$` or backticks without any of them
/// reaching the root shell as syntax.
#[cfg(unix)]
fn applescript_string(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

/// How this OS raises one privileged invocation, its name for messages,
/// and whether the request then goes on stdin. Linux: pkexec. macOS: the
/// administrator prompt of `do shell script`, which passes no stdin, so the
/// request rides on the broker's command line.
#[cfg(unix)]
fn elevated_command(binary: &std::path::Path, request: &str) -> (Command, &'static str, bool) {
    if cfg!(target_os = "linux") {
        let mut c = Command::new("pkexec");
        c.arg(binary);
        (c, "pkexec", true)
    } else {
        let script = format!(
            "do shell script (quoted form of {}) & \" --request \" & (quoted form of {}) \
             with prompt {} with administrator privileges without altering line endings",
            applescript_string(&binary.to_string_lossy()),
            applescript_string(request),
            applescript_string("POSMA prosi o uprawnienia administratora dla jednej operacji."),
        );
        let mut c = Command::new("/usr/bin/osascript");
        c.arg("-e").arg(script);
        (c, "osascript", false)
    }
}

#[cfg(unix)]
async fn call_elevated(request: &serde_json::Value) -> Result<serde_json::Value, String> {
    let binary = broker_binary_path()?;
    let mut payload = serde_json::to_string(request).map_err(|e| e.to_string())?;
    let (mut command, prompt, on_stdin) = elevated_command(&binary, &payload);
    let mut child = command
        .stdin(if on_stdin { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| match e.kind() {
            // Not every system ships polkit — minimal and server installs
            // often do not — and "No such file" would say nothing useful.
            std::io::ErrorKind::NotFound if prompt == "pkexec" => {
                "brak polecenia pkexec — zainstaluj pakiet polkit, bez niego POSMA nie może poprosić o uprawnienia administratora".into()
            }
            _ => format!("nie udało się uruchomić brokera: {e}"),
        })?;

    if on_stdin {
        payload.push('\n');
        child
            .stdin
            .take()
            .ok_or("broker nie ma stdin")?
            .write_all(payload.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
    }

    let stdout = child.stdout.take().ok_or("broker nie ma stdout")?;
    let line = BufReader::new(stdout).lines().next_line().await.map_err(|e| e.to_string())?;

    // What the prompt itself said, read before waiting so a full pipe cannot
    // stall it. On a session with no polkit agent running — common on bare
    // window managers — this is the only place the reason appears.
    let mut reason = String::new();
    if let Some(mut stderr) = child.stderr.take() {
        let _ = tokio::io::AsyncReadExt::read_to_string(&mut stderr, &mut reason).await;
    }
    let status = child.wait().await.map_err(|e| e.to_string())?;

    match line {
        Some(text) if !text.trim().is_empty() => serde_json::from_str(text.trim()).map_err(|e| e.to_string()),
        _ if !status.success() => Err(match reason.trim() {
            "" => format!("odmowa autoryzacji lub błąd brokera ({prompt})"),
            said => format!("odmowa autoryzacji lub błąd brokera ({prompt}): {said}"),
        }),
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
            Err(DaemonCallError::NotReachable) => call_elevated(&request).await,
            Err(DaemonCallError::AfterConnect(e)) => Err(format!(
                "błąd komunikacji z demonem brokera (operacja mogła zostać wykonana — sprawdź stan zanim powtórzysz): {e}"
            )),
        }
    }
    #[cfg(windows)]
    {
        let payload = serde_json::to_string(&request).map_err(|e| e.to_string())?;
        uac::call(&broker_binary_path()?, &payload).await
    }
}

/// One elevated broker for the whole run, so UAC asks once — at the first
/// operation that needs it — rather than before every action. The core
/// creates the pipe, the broker connects to it as a client, and the core
/// serves only the process UAC started; the broker ends when POSMA does.
#[cfg(windows)]
mod uac {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::AsRawHandle;
    use std::path::Path;
    use std::time::Duration;

    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::windows::named_pipe::{NamedPipeServer, ServerOptions};
    use tokio::sync::Mutex;
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_CANCELLED};
    use windows_sys::Win32::System::Pipes::GetNamedPipeClientProcessId;
    use windows_sys::Win32::System::Threading::GetProcessId;
    use windows_sys::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::SW_HIDE;

    static SESSION: Mutex<Option<BufReader<NamedPipeServer>>> = Mutex::const_new(None);

    fn wide(s: &std::ffi::OsStr) -> Vec<u16> {
        s.encode_wide().chain(Some(0)).collect()
    }

    /// Not a secret: `first_pipe_instance` and the process check keep others
    /// out. It only keeps two runs of POSMA from choosing the same name.
    fn pipe_name() -> String {
        use std::hash::{BuildHasher, RandomState};
        let seed = RandomState::new();
        format!(r"\\.\pipe\posma-broker-{:016x}{:016x}", seed.hash_one(std::process::id()), seed.hash_one(std::time::SystemTime::now()))
    }

    /// Starts `binary` through the UAC prompt, hidden, and returns its
    /// process id. Blocks while the prompt is up.
    fn run_as_admin(binary: &Path, args: &str) -> Result<u32, String> {
        let (verb, file, params) = (wide("runas".as_ref()), wide(binary.as_os_str()), wide(args.as_ref()));
        let mut info = SHELLEXECUTEINFOW {
            cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
            // NO_UI: a missing or broken broker comes back as an error here, not as
            // Explorer's own dialog that blocks this call until someone closes it.
            fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpVerb: verb.as_ptr(),
            lpFile: file.as_ptr(),
            lpParameters: params.as_ptr(),
            nShow: SW_HIDE,
            ..Default::default()
        };
        // SAFETY: `info` is sized as the call expects and its strings outlive it.
        if unsafe { ShellExecuteExW(&mut info) } == 0 {
            let e = std::io::Error::last_os_error();
            return Err(if e.raw_os_error() == Some(ERROR_CANCELLED as i32) {
                "nie udzielono zgody administratora (UAC), więc nic nie zostało zmienione".into()
            } else {
                format!("nie udało się uruchomić brokera jako administrator: {e}")
            });
        }
        if info.hProcess.is_null() {
            return Err("system nie zwrócił procesu brokera".into());
        }
        // SAFETY: SEE_MASK_NOCLOSEPROCESS hands this function the process handle to close.
        let pid = unsafe { GetProcessId(info.hProcess) };
        unsafe { CloseHandle(info.hProcess) };
        Ok(pid)
    }

    async fn open(binary: &Path) -> Result<BufReader<NamedPipeServer>, String> {
        let name = pipe_name();
        // Fails rather than joining a pipe someone else made under this name.
        let server = ServerOptions::new()
            .first_pipe_instance(true)
            .max_instances(1)
            .create(&name)
            .map_err(|e| format!("nie udało się utworzyć potoku brokera: {e}"))?;
        let (binary, args) = (binary.to_path_buf(), format!("--pipe {name}"));
        let pid = tauri::async_runtime::spawn_blocking(move || run_as_admin(&binary, &args)).await.map_err(|e| e.to_string())??;
        tokio::time::timeout(Duration::from_secs(30), server.connect())
            .await
            .map_err(|_| "broker nie połączył się z POSMA w ciągu 30 s".to_string())?
            .map_err(|e| e.to_string())?;
        let mut client = 0u32;
        // SAFETY: the handle belongs to `server`, which is connected.
        let known = unsafe { GetNamedPipeClientProcessId(server.as_raw_handle(), &mut client) } != 0;
        if !known || client != pid {
            return Err("z potokiem brokera połączył się inny proces niż uruchomiony przez UAC — odmowa".into());
        }
        Ok(BufReader::new(server))
    }

    pub async fn call(binary: &Path, request: &str) -> Result<serde_json::Value, String> {
        let mut session = SESSION.lock().await;
        let line = format!("{request}\n");
        let mut pipe = match session.take() {
            Some(pipe) => pipe,
            None => open(binary).await?,
        };
        // A broker that is gone read none of this, so starting a new one is
        // safe. Once the request is written there is no second attempt: it
        // may have run.
        if pipe.get_mut().write_all(line.as_bytes()).await.is_err() {
            pipe = open(binary).await?;
            pipe.get_mut().write_all(line.as_bytes()).await.map_err(|e| e.to_string())?;
        }
        let mut answer = String::new();
        match pipe.read_line(&mut answer).await {
            Ok(n) if n > 0 => {
                *session = Some(pipe);
                serde_json::from_str(answer.trim()).map_err(|e| e.to_string())
            }
            _ => Err("broker przestał odpowiadać (operacja mogła zostać wykonana — sprawdź stan, zanim powtórzysz)".into()),
        }
    }

    /// The whole path on a real Windows: the prompt, the pipe, the check on
    /// who connected, and a second answer from the same session. CI runs
    /// it; on a desktop it shows the UAC prompt once.
    #[cfg(test)]
    #[tokio::test]
    #[ignore]
    async fn one_elevated_session_answers_every_call() {
        let exe = std::env::current_exe().expect("test binary");
        // Cargo has moved test binaries before (deps/, now build/<package>/<hash>/out/), so look upward.
        let broker = exe
            .ancestors()
            .map(|dir| dir.join("windows-broker.exe"))
            .find(|path| path.exists())
            .expect("windows-broker.exe in the target dir: build the workspace first");
        let request = r#"{"op":"capabilities"}"#;
        let missing = broker.with_file_name("no-such-broker.exe");
        assert!(call(&missing, request).await.is_err(), "a missing broker is an error, not a dialog to wait on");
        assert_eq!(call(&broker, request).await.expect("first call")["data"]["os"], "windows");
        assert_eq!(call(&broker, request).await.expect("same session")["ok"], true);
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    /// Whatever a request holds comes out of the literal unchanged: no part
    /// of it may end the literal early and reach the root shell as syntax.
    #[test]
    fn a_request_survives_the_applescript_literal() {
        let request = r#"{"op":"clean_system_paths","paths":["/x\"; rm -rf / #","a\\b","$(id)`id`","zażółć"]}"#;
        let literal = applescript_string(request);
        assert!(literal.starts_with('"') && literal.ends_with('"'));
        let mut read = String::new();
        let mut chars = literal[1..literal.len() - 1].chars();
        while let Some(c) = chars.next() {
            assert_ne!(c, '"', "an unescaped quote would end the literal");
            read.push(if c == '\\' { chars.next().expect("an escape is never last") } else { c });
        }
        assert_eq!(read, request);
    }
}
