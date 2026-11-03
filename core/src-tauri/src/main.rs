// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF renderer needs a working GBM EGL display, and when
    // it cannot get one it aborts the whole process: "Could not create GBM
    // EGL display: EGL_NOT_INITIALIZED. Aborting...". That happens with
    // NVIDIA's driver — always, after a driver update before the reboot —
    // and in VMs. A maintenance window gains nothing from zero-copy buffers,
    // so it takes the path that always starts. Set before anything spawns a
    // thread; an explicit value, including 0 to opt back in, is left alone.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    core_lib::run()
}
