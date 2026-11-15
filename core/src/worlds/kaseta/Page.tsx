import type { ReactNode } from 'react'
import { Band } from './parts'

interface PageProps {
  no: string
  /** Left out where the page draws its own title (the folder view does). */
  title?: string
  /** Written on the j-card's spine. */
  spine: string
  children: ReactNode
}

/** A j-card opened flat: the spine on the left, the stock with its printed band on the right. */
export function Page({ no, title, spine, children }: PageProps) {
  return (
    <div className="ks-page">
      <div className="ks-page__spine" aria-hidden="true">
        <span>
          {spine} · {no}
        </span>
      </div>
      <section className="ks-page__stock">
        <Band>
          <span className="ks-band__no">{no}</span>
        </Band>
        <div className="ks-page__body">
          {title && (
            <h1 className="ks-page__title">
              {title}
              <span> · {no}</span>
            </h1>
          )}
          {children}
        </div>
      </section>
    </div>
  )
}
