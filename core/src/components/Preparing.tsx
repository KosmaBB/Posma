import { useEffect, useState } from 'react'

/**
 * The waiting state for work that genuinely takes a while — walking a whole
 * disk, hashing files, asking the package manager what it has.
 *
 * A bare spinner leaves the user guessing whether anything is happening and
 * whether the wait is normal. This says what is being done, why it is slow,
 * and — once it has been running long enough to feel stuck — how long it has
 * actually been going.
 */

/** Elapsed seconds, shown only after the wait stops feeling instant. */
const SHOW_TIMER_AFTER_MS = 4000

export function Preparing({
  title,
  note,
  steps,
}: {
  /** What is happening, in the present tense: "Przygotowuję mapę dysków". */
  title: string
  /** Why it takes time. One sentence, plainly. */
  note?: string
  /** Optional stages, marked off as they complete. */
  steps?: { label: string; done: boolean }[]
}) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const started = performance.now()
    const id = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - started) / 1000))
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  const showTimer = elapsed * 1000 >= SHOW_TIMER_AFTER_MS

  return (
    <div className="glass preparing" role="status" aria-live="polite">
      <div className="preparing__orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <p className="preparing__title">{title}</p>
      {note && <p className="preparing__note">{note}</p>}

      {steps && steps.length > 0 && (
        <ul className="preparing__steps">
          {steps.map((s) => (
            <li key={s.label} data-done={s.done}>
              <span className="preparing__tick" aria-hidden="true">
                {s.done ? '✓' : '·'}
              </span>
              {s.label}
            </li>
          ))}
        </ul>
      )}

      {/* Only appears once the wait is long enough that silence would read
          as a hang. Before that it would just add noise. */}
      <p className="preparing__timer" data-visible={showTimer}>
        {showTimer ? `trwa ${elapsed} s — to normalne przy większych dyskach` : ' '}
      </p>
    </div>
  )
}
