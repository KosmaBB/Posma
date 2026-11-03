import { useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { confirmAction } from '../../components/confirm'
import type { ApiResponse } from '../../data/callModule'

interface ExecResult {
  success: boolean
  output: string
  error: string | null
}

/**
 * The component store (WinSxS) through DISM. Both the check and the cleanup
 * need an administrator, and DISM's own report — in the system's language —
 * is shown as it wrote it. The cleanup makes a restore point first.
 */
export function WinsxsView() {
  const [busy, setBusy] = useState<'analyze' | 'clean' | null>(null)
  const [report, setReport] = useState<ExecResult | null>(null)

  async function run(action: 'analyze' | 'clean') {
    if (
      action === 'clean' &&
      !(await confirmAction(
        'Usunąć zastąpione wersje składników Windows? Najpierw powstanie punkt przywracania. Czyszczenie trwa zwykle kilka do kilkunastu minut, a zainstalowanych aktualizacji nie da się potem odinstalować.',
      ))
    )
      return
    setBusy(action)
    setReport(null)
    try {
      await invoke('request_permission', { capability: 'fs-system' })
      if (action === 'clean') await invoke('request_permission', { capability: 'restore-point' })
      const res = await invoke<ApiResponse<ExecResult>>(action === 'analyze' ? 'analyze_component_store' : 'clean_component_store')
      setReport(res.ok ? res.data : { success: false, output: '', error: res.error })
    } catch (e) {
      setReport({ success: false, output: '', error: String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <div className="glass xc-summary">
        <div>
          <div className="xc-summary-value">Magazyn składników</div>
          <div className="xc-summary-label">
            Stare wersje plików systemowych, które Windows zostawia po aktualizacjach. Najpierw sprawdź, czy czyszczenie jest zalecane.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" onClick={() => run('analyze')} disabled={busy !== null}>
            {busy === 'analyze' ? 'Sprawdzam…' : 'Sprawdź'}
          </button>
          <button className="btn btn-primary" onClick={() => run('clean')} disabled={busy !== null}>
            {busy === 'clean' ? 'Czyszczę…' : 'Wyczyść'}
          </button>
        </div>
      </div>

      {report && (
        <div className="glass xc-result">
          {report.error && <div className="xc-error">{report.error}</div>}
          {report.output && <pre className="mono" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{report.output.trim()}</pre>}
        </div>
      )}
    </>
  )
}
