use std::io::{self, BufRead, Write};

use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};

#[derive(Deserialize)]
struct Request {
    cmd: String,
}

#[derive(Serialize)]
struct DiskInfo {
    name: String,
    mount_point: String,
    total_bytes: u64,
    available_bytes: u64,
}

#[derive(Serialize)]
struct SystemInfo {
    cpu_percent: f32,
    ram_used_bytes: u64,
    ram_total_bytes: u64,
    disks: Vec<DiskInfo>,
}

#[derive(Serialize)]
#[serde(untagged)]
enum Response {
    Ok { ok: bool, data: SystemInfo },
    Err { ok: bool, error: String },
}

fn collect_system_info() -> SystemInfo {
    let mut sys = System::new_all();
    sys.refresh_cpu_usage();
    std::thread::sleep(sysinfo::MINIMUM_CPU_UPDATE_INTERVAL);
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let disks = Disks::new_with_refreshed_list()
        .into_iter()
        .map(|disk| DiskInfo {
            name: disk.name().to_string_lossy().into_owned(),
            mount_point: disk.mount_point().to_string_lossy().into_owned(),
            total_bytes: disk.total_space(),
            available_bytes: disk.available_space(),
        })
        .collect();

    SystemInfo {
        cpu_percent: sys.global_cpu_usage(),
        ram_used_bytes: sys.used_memory(),
        ram_total_bytes: sys.total_memory(),
        disks,
    }
}

fn main() {
    let mut line = String::new();
    let response = match io::stdin().lock().read_line(&mut line) {
        Ok(0) => Response::Err {
            ok: false,
            error: "no command received on stdin".to_string(),
        },
        Ok(_) => match serde_json::from_str::<Request>(line.trim()) {
            Ok(req) if req.cmd == "get_info" => Response::Ok {
                ok: true,
                data: collect_system_info(),
            },
            Ok(req) => Response::Err {
                ok: false,
                error: format!("unknown command: {}", req.cmd),
            },
            Err(e) => Response::Err {
                ok: false,
                error: format!("invalid request: {e}"),
            },
        },
        Err(e) => Response::Err {
            ok: false,
            error: format!("failed to read stdin: {e}"),
        },
    };

    let out = serde_json::to_string(&response).expect("response must serialize");
    println!("{out}");
    io::stdout().flush().ok();
}
