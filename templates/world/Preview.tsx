/**
 * The small card in Settings → Wygląd. It is drawn inside
 * <span class="world-prev" data-world="starter" data-theme="…">, so this
 * world's tokens apply in both modes. Decoration only: hidden from assistive
 * tech, no live data, no interaction.
 */
export function Preview() {
  return (
    <span className="stp" aria-hidden="true">
      <span className="stp__bar">
        <i />
        <i />
        <i />
      </span>
      <span className="stp__cards">
        <b>12 %</b>
        <b />
        <b />
      </span>
    </span>
  )
}
