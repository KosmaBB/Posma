import { Icon } from '../components/Icons'

const LINKS = [
  { name: 'GitHub', desc: 'Repozytorium projektu', icon: 'github', g1: 'var(--g-violet-1)', g2: 'var(--g-violet-2)', href: '#' },
  { name: 'Dokumentacja', desc: 'Instrukcje i opis modułów', icon: 'docs', g1: 'var(--g-blue-1)', g2: 'var(--g-blue-2)', href: '#' },
  { name: 'Wsparcie', desc: 'Zgłoś błąd albo pomysł', icon: 'heart', g1: 'var(--g-red-1)', g2: 'var(--g-red-2)', href: '#' },
  { name: 'Strona projektu', desc: 'posma — Personal OS Maintenance App', icon: 'web', g1: 'var(--g-teal-1)', g2: 'var(--g-teal-2)', href: '#' },
]

export function Links() {
  return (
    <div className="view-enter">
      <div className="links-grid">
        {LINKS.map((l) => (
          <a
            key={l.name}
            className="glass link-card"
            href={l.href}
            style={{ '--g1': l.g1, '--g2': l.g2 } as React.CSSProperties}
          >
            <div className="ico-badge" style={{ '--g1': l.g1, '--g2': l.g2 } as React.CSSProperties}>
              <Icon name={l.icon} />
            </div>
            <div>
              <div className="lk-name">{l.name}</div>
              <div className="lk-desc">{l.desc}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  )
}
