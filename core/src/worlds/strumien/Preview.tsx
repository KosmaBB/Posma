/** The world picker's miniature: one full-screen item, its figure, its rail, the next one peeking. */
const MEAN = '0,30 10,29 20,31 30,27 40,29 50,26 60,28 70,24 80,27 88,22'
const PEAK = '0,24 10,21 20,25 30,16 40,22 50,14 60,20 70,11 80,17 88,9'

export function Preview() {
  return (
    <span className="smp">
      <span className="smp__item">
        <svg className="smp__chart" viewBox="0 0 100 40" preserveAspectRatio="none">
          <polyline className="smp__peak" points={PEAK} />
          <polyline className="smp__mean" points={MEAN} />
        </svg>
        <span className="smp__seg">
          <i data-now="" />
          <i />
          <i />
          <i />
          <i />
          <i />
        </span>
        <span className="smp__fig">3 %</span>
        <span className="smp__rail">
          <i data-on="" />
          <i />
          <i />
        </span>
      </span>
    </span>
  )
}
