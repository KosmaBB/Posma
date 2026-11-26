import { confirm } from '@tauri-apps/plugin-dialog'
import { t } from '../i18n'

/**
 * Asks before something that cannot be undone, and waits for the answer.
 *
 * `window.confirm` must not be used for this. The dialog plugin replaces it
 * with an async function that invokes a `confirm` command the plugin no
 * longer has, so a call returns a promise that rejects. A promise is
 * truthy: `if (!window.confirm(...)) return` let every action straight
 * through, with no dialog shown at all.
 */
export function confirmAction(message: string): Promise<boolean> {
  return confirm(message, { title: 'POSMA', kind: 'warning', okLabel: t('common.yes'), cancelLabel: t('common.cancel') })
}
