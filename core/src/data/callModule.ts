import { invoke } from '@tauri-apps/api/core'

export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * One request to an unprivileged module, as its `src/main.rs` reads it:
 * `cmd` plus that command's fields, in the module's own snake_case.
 */
export function callModule<T>(module: string, request: { cmd: string } & Record<string, unknown>) {
  return invoke<ApiResponse<T>>('call_module', { module, request })
}
