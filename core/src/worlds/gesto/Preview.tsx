/**
 * Gęsto in miniature for the world picker: header band, red folder tab,
 * rail and a mosaic of red-tabbed boxes. Shapes only; the picker hides it
 * from assistive technology and names the world beside it.
 */
const CORES = [38, 72, 24, 55, 90, 31, 46, 18, 64, 27, 80, 42]
const RAIL = [70, 55, 62, 48, 58]

export function Preview() {
  return (
    <span className="gp">
      <span className="gp-hd">
        <i className="gp-mark" />
        <i className="gp-search" />
        <i className="gp-pill" />
        <i className="gp-pill" />
        <i className="gp-pill gp-pill--warn" />
      </span>
      <span className="gp-tabs">
        <i />
        <i className="on" />
        <i />
        <i />
        <i />
      </span>
      <span className="gp-body">
        <span className="gp-rail">
          {RAIL.map((w, i) => (
            <i key={i} style={{ width: `${w}%` }} />
          ))}
        </span>
        <span className="gp-mosaic">
          <span className="gp-box gp-box--cpu">
            <b />
            <span className="gp-cores">
              {CORES.map((h, i) => (
                <i key={i} style={{ height: `${h}%` }} className={h >= 90 ? 'hot' : undefined} />
              ))}
            </span>
          </span>
          <span className="gp-box">
            <b />
            <span className="gp-fig" />
            <span className="gp-bar">
              <i style={{ width: '49%' }} />
            </span>
          </span>
          <span className="gp-box gp-box--rec">
            <b />
            <span className="gp-fig gp-fig--hot" />
            <span className="gp-line" />
            <span className="gp-line" />
            <span className="gp-line" />
          </span>
          <span className="gp-box">
            <b />
            <span className="gp-bar">
              <i style={{ width: '53%' }} />
            </span>
            <span className="gp-bar">
              <i className="hot" style={{ width: '92%' }} />
            </span>
          </span>
        </span>
      </span>
    </span>
  )
}
