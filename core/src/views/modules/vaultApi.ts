import { invoke } from '@tauri-apps/api/core'

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: string }

export async function vaultStart(): Promise<void> {
  await invoke('vault_start')
}

export async function vaultStop(): Promise<void> {
  await invoke('vault_stop')
}

/** Every vault action goes through the one long-lived sidecar process — see modules/vault/src/main.rs for the command list. */
export async function vaultCall<T>(payload: Record<string, unknown>): Promise<T> {
  const res = await invoke<ApiResponse<T>>('vault_request', { payload })
  if (!res.ok) throw new Error(res.error)
  return res.data
}
