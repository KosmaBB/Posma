import { t } from '../i18n'

/**
 * Reusable notice for "this feature needs an external tool that isn't
 * installed" — e.g. smartctl for S.M.A.R.T. reads. The install button is
 * deliberately inert: actually installing a package needs root, same as
 * running some of these tools afterward, and this app does not add
 * per-feature pkexec/sudo shortcuts — both wait for the permission broker
 * described in Access_plan.md. The button stays visible (not hidden) so the
 * user always sees the exact command to run themselves in the meantime.
 */
export function MissingDependency({ tool, installHint }: { tool: string; installHint?: string }) {
  return (
    <span className="missing-dep">
      <span className="chip os">{t('missing.chip')}</span>
      <span className="missing-dep-text">{t('missing.text', { tool })}</span>
      {installHint && (
        <button
          className="btn btn-ghost btn-mini"
          disabled
          title={t('missing.hint')}
        >
          {t('missing.install')} <span className="mono">{installHint}</span>
        </button>
      )}
    </span>
  )
}
