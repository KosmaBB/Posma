/** The world picker's miniature: the passbook spread, its tabs, a dot-matrix figure and the ledger's ruled lines. */
export function Preview() {
  return (
    <span className="kz-prev">
      <span className="kz-prev__tabs">
        <i /><i /><i /><i /><i />
      </span>
      <span className="kz-prev__book">
        <span className="kz-prev__page">
          <span className="kz-prev__lbl" />
          <span className="kz-prev__big">0001</span>
          <span className="kz-prev__rule" />
          <span className="kz-prev__rule" />
        </span>
        <span className="kz-prev__page kz-prev__page--r">
          <span className="kz-prev__line" />
          <span className="kz-prev__line" />
          <span className="kz-prev__line kz-prev__line--dash" />
          <span className="kz-prev__line kz-prev__line--dash" />
          <span className="kz-prev__stamp" />
        </span>
      </span>
    </span>
  )
}
