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
//! A Windows daemon (named pipe + `GetNamedPipeClientProcessId` for the
//! equivalent peer check) is deliberately left unimplemented rather than
//! guessed at — `run_once` works there today via UAC, and the shape of the
//! peer-authentication step is the one part that must not be written blind.

use crate::broker::{handle_line, Broker};
use std::io::{self, BufRead, Write};

/// One request on stdin, one response on stdout, then exit.
pub fn run_once<B: Broker + ?Sized>(broker: &B) {
    let mut input = String::new();
    let output = match io::stdin().lock().read_line(&mut input) {
        Ok(0) => crate::result::line(&crate::result::err::<()>("no command received on stdin")),
        Ok(_) => handle_line(broker, &input),
        Err(e) => crate::result::line(&crate::result::err::<()>(format!("failed to read stdin: {e}"))),
    };
    println!("{output}");
    io::stdout().flush().ok();
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
}
