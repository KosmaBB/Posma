//! Run modes, shared by every OS broker binary.
//!
//!  - `run_once`: one JSON line in on stdin, one out on stdout, exit. The
//!    cold-start path — invoked per call through the OS's own elevation
//!    prompt (pkexec / AuthorizationServices / UAC), needs no installation.
//!  - `run_daemon` (Unix): a long-lived root process behind a Unix socket,
//!    so no repeated prompts once installed. Access control is
//!    `SO_PEERCRED`, checked before a single byte of the request is read —
//!    NOT the socket file's permission bits.
//!
//!  - `--pipe <name>` (Windows): the session UAC starts once per run. The
//!    core creates the pipe and serves only the process it started; the
//!    broker answers every request on it until POSMA closes.
//!
//! An installed Windows helper that needs no prompt at all is not written:
//! it would be a server any process could knock on, and the check on who
//! knocks is the part that must not be written without a machine to test it.

use crate::broker::{handle_line, Broker};
use std::io::{self, BufRead, Write};

/// One request on stdin, one response on stdout, then exit. Where the
/// elevation prompt passes no stdin through — macOS's `do shell script` —
/// the request comes as `--request <json>` instead.
pub fn run_once<B: Broker + ?Sized>(broker: &B) {
    let args: Vec<String> = std::env::args().collect();
    #[cfg(windows)]
    if let [_, flag, pipe] = &args[..] {
        if flag == "--pipe" {
            return serve_pipe(broker, pipe);
        }
    }
    let mut input = String::new();
    let read = match &args[..] {
        [_, flag, request] if flag == "--request" => {
            input.push_str(request);
            Ok(input.len())
        }
        _ => io::stdin().lock().read_line(&mut input),
    };
    let output = match read {
        Ok(0) => crate::result::line(&crate::result::err::<()>("no command received on stdin")),
        Ok(_) => {
            let response = handle_line(broker, &input);
            // pkexec names the account it elevated; the other prompts do not.
            let caller = std::env::var("PKEXEC_UID")
                .map(|uid| format!("uid {uid} (pkexec)"))
                .unwrap_or_else(|_| "jednorazowe uruchomienie".into());
            crate::audit::record(&caller, &input, &response);
            response
        }
        Err(e) => crate::result::line(&crate::result::err::<()>(format!("failed to read stdin: {e}"))),
    };
    println!("{output}");
    io::stdout().flush().ok();
}

/// The only name the broker opens: a pipe under POSMA's prefix, never a
/// file — the name is all it is told, and an elevated process told a path
/// would write its answers there.
#[cfg(any(windows, test))]
fn is_session_pipe(name: &str) -> bool {
    name.strip_prefix(r"\\.\pipe\posma-broker-")
        .is_some_and(|id| !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit()))
}

#[cfg(windows)]
fn serve_pipe<B: Broker + ?Sized>(broker: &B, name: &str) {
    if !is_session_pipe(name) {
        eprintln!("{name}: to nie jest potok sesji POSMA — odmowa");
        return;
    }
    // Open, never create: the pipe exists because the core made it.
    let pipe = match std::fs::OpenOptions::new().read(true).write(true).open(name) {
        Ok(pipe) => pipe,
        Err(e) => return eprintln!("nie udało się połączyć z {name}: {e}"),
    };
    let caller = format!("{} (UAC)", std::env::var("USERNAME").unwrap_or_default());
    let (mut reader, mut writer) = (io::BufReader::new(&pipe), &pipe);
    let mut input = String::new();
    while matches!(reader.read_line(&mut input), Ok(n) if n > 0) {
        let response = handle_line(broker, &input);
        crate::audit::record(&caller, &input, &response);
        if writeln!(writer, "{response}").is_err() {
            return;
        }
        input.clear();
    }
}

#[cfg(unix)]
pub use unix_daemon::run_daemon;

#[cfg(unix)]
mod unix_daemon {
    use super::*;
    use std::fs;
    use std::os::unix::io::AsRawFd;
    use std::os::unix::net::{UnixListener, UnixStream};

    /// The real access control on the daemon socket. Only the uid recorded
    /// at install time may talk to a root broker — file permission bits are
    /// deliberately not relied on for this.
    ///
    /// Every Unix answers this question, but not with the same call, and
    /// `#[cfg(unix)]` is not fine-grained enough to tell them apart: it is
    /// true on macOS too, so a Linux-only struct behind it fails to compile
    /// there rather than being skipped.
    #[cfg(target_os = "linux")]
    fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
        let fd = stream.as_raw_fd();
        let mut cred: libc::ucred = unsafe { std::mem::zeroed() };
        let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
        let ret = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_PEERCRED,
                &mut cred as *mut _ as *mut libc::c_void,
                &mut len,
            )
        };
        if ret != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(cred.uid)
    }

    /// macOS and the BSDs have no `SO_PEERCRED`; `getpeereid` is the
    /// documented equivalent and answers the only question asked here.
    #[cfg(not(target_os = "linux"))]
    fn peer_uid(stream: &UnixStream) -> io::Result<u32> {
        let fd = stream.as_raw_fd();
        let mut uid: libc::uid_t = 0;
        let mut gid: libc::gid_t = 0;
        let ret = unsafe { libc::getpeereid(fd, &mut uid, &mut gid) };
        if ret != 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(uid)
    }

    fn handle_client<B: Broker + ?Sized>(broker: &B, stream: UnixStream, owner_uid: u32) {
        match peer_uid(&stream) {
            Ok(uid) if uid == owner_uid => {}
            Ok(uid) => {
                eprintln!("odrzucono połączenie od uid={uid} (oczekiwano {owner_uid})");
                return;
            }
            Err(e) => {
                eprintln!("nie udało się ustalić uid rozmówcy: {e}");
                return;
            }
        }

        let Ok(mut writer) = stream.try_clone() else {
            eprintln!("nie udało się sklonować gniazda");
            return;
        };
        let mut reader = io::BufReader::new(stream);
        let mut input = String::new();
        match reader.read_line(&mut input) {
            Ok(0) | Err(_) => return,
            Ok(_) => {}
        }
        if input.trim().is_empty() {
            return;
        }
        let response = handle_line(broker, &input);
        crate::audit::record(&format!("uid {owner_uid} (demon)"), &input, &response);
        let _ = writeln!(writer, "{response}");
    }

    /// Binds `socket_path` and serves requests until killed. `owner_uid` is
    /// read from `owner_uid_file`; an unreadable or malformed file is fatal
    /// (fail closed — a broker that can't identify its owner must not
    /// accept anyone).
    pub fn run_daemon<B: Broker + ?Sized + Sync>(broker: &B, socket_path: &str, owner_uid_file: &str) {
        let owner_uid: u32 = match fs::read_to_string(owner_uid_file) {
            Ok(s) => match s.trim().parse() {
                Ok(uid) => uid,
                Err(e) => {
                    eprintln!("nieprawidłowa zawartość {owner_uid_file}: {e}");
                    std::process::exit(1);
                }
            },
            Err(e) => {
                eprintln!("nie udało się odczytać {owner_uid_file}: {e}");
                std::process::exit(1);
            }
        };

        // Stale socket from an unclean previous shutdown.
        let _ = fs::remove_file(socket_path);

        let listener = match UnixListener::bind(socket_path) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("nie udało się nasłuchiwać na {socket_path}: {e}");
                std::process::exit(1);
            }
        };
        // Connecting to a socket takes write permission on it, and bind
        // under root's usual umask leaves it writable by root alone: the
        // owner could not reach the daemon installed for them, and every
        // call fell back to pkexec without a word. The file goes to the
        // owner and to nobody else — SO_PEERCRED below still decides who is
        // served, this only lets the right account knock.
        use std::os::unix::fs::PermissionsExt;
        let handed_over = std::os::unix::fs::chown(socket_path, Some(owner_uid), None)
            .and_then(|()| fs::set_permissions(socket_path, fs::Permissions::from_mode(0o600)));
        if let Err(e) = handed_over {
            eprintln!("nie udało się przekazać {socket_path} właścicielowi: {e}");
            std::process::exit(1);
        }
        eprintln!("posma broker: nasłuchuję na {socket_path}, właściciel uid={owner_uid}");

        std::thread::scope(|scope| {
            for incoming in listener.incoming() {
                match incoming {
                    Ok(stream) => {
                        scope.spawn(move || handle_client(broker, stream, owner_uid));
                    }
                    Err(e) => eprintln!("błąd akceptacji połączenia: {e}"),
                }
            }
        });
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::os::unix::fs::PermissionsExt;

        struct Nothing;
        impl Broker for Nothing {
            fn os_name(&self) -> &'static str {
                "test"
            }
        }

        /// A daemon started for an account has to answer that account. It
        /// did not: the socket was left writable by root only, the owner's
        /// connect was refused, and the app quietly used pkexec instead.
        #[test]
        fn the_owner_can_reach_the_daemon() {
            let dir = std::env::temp_dir().join(format!("posma-daemon-test-{}", std::process::id()));
            fs::create_dir_all(&dir).expect("scratch dir");
            let socket = dir.join("broker.sock");
            let uid_file = dir.join("owner-uid");
            fs::write(&uid_file, unsafe { libc::getuid() }.to_string()).expect("uid file");

            let (socket_path, uid_path) = (socket.to_string_lossy().into_owned(), uid_file.to_string_lossy().into_owned());
            // Serves until the test process exits; there is nothing to join.
            std::thread::spawn(move || run_daemon(&Nothing, &socket_path, &uid_path));

            let mut stream = (0..200)
                .find_map(|_| {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                    UnixStream::connect(&socket).ok()
                })
                .expect("owner connects");
            writeln!(stream, r#"{{"op":"capabilities"}}"#).expect("request");
            let mut answer = String::new();
            io::BufReader::new(stream).read_line(&mut answer).expect("response");

            assert!(answer.contains(r#""os":"test""#), "{answer}");
            assert_eq!(fs::metadata(&socket).expect("socket").permissions().mode() & 0o777, 0o600);
            let _ = fs::remove_dir_all(&dir);
        }
    }
}

#[cfg(test)]
mod tests {
    /// The broker is told a name and nothing else, so nothing but a session
    /// pipe may pass — above all no file path it would write answers into.
    #[test]
    fn only_a_session_pipe_is_opened() {
        assert!(super::is_session_pipe(r"\\.\pipe\posma-broker-0a1b2c3d4e5f60718293a4b5c6d7e8f9"));
        for name in [r"\\.\pipe\posma-broker-", r"\\.\pipe\posma-broker-..\\x", r"\\.\pipe\other-0a1b", r"C:\Windows\win.ini", r"\\.\pipe\posma-broker-0a 1b"] {
            assert!(!super::is_session_pipe(name), "{name}");
        }
    }
}
