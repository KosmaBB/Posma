/** Kaseta in miniature: a shelf of spines and an unfolded j-card with its two sides. */
export function Preview() {
  return (
    <span className="ksp" aria-hidden="true">
      <span className="ksp__shelf">
        {Array.from({ length: 7 }, (_, i) => (
          <i key={i} />
        ))}
      </span>
      <span className="ksp__card">
        <span className="ksp__cover">
          <span className="ksp__band" />
          <b>Mix</b>
          <svg viewBox="0 0 60 16" preserveAspectRatio="none">
            <path d="M0 12 L8 10 L14 13 L22 6 L30 9 L38 4 L46 10 L52 7 L60 9" />
          </svg>
        </span>
        <span className="ksp__fold">
          {['A', 'B'].map((side) => (
            <span key={side} className="ksp__side">
              <em>{side}</em>
              {Array.from({ length: 5 }, (_, i) => (
                <i key={i} />
              ))}
            </span>
          ))}
        </span>
      </span>
    </span>
  )
}
