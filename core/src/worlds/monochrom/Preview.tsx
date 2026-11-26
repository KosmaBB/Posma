import { t } from '../../i18n'

/** Monochrom in miniature: a claim, the panel that proves it, the rail beside them. */
export function Preview() {
  return (
    <span className="mono-prev">
      <span className="mono-prev__bar">
        <b>posma</b>
        <i /><i /><i /><i />
      </span>
      <span className="mono-prev__claim">
        <b>{t('world.monochrom.preview.claim')}</b>
        <i />
      </span>
      <span className="mono-prev__proof">
        <span className="mono-prev__shot">
          <span><i style={{ width: '48%' }} /></span>
          <span><i style={{ width: '27%' }} /></span>
          <span><i style={{ width: '79%' }} /></span>
          <span className="full"><i style={{ width: '92%' }} /></span>
        </span>
      </span>
      <span className="mono-prev__rail"><i className="on" /><i /><i /><i /></span>
    </span>
  )
}
