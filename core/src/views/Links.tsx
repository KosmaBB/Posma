import { Icon } from '../components/Icons'
import { t } from '../i18n'

const LINKS = [
  { name: 'GitHub', get desc() { return t('links.github.desc') }, icon: 'github', g1: 'var(--g-violet-1)', g2: 'var(--g-violet-2)', href: '#' },
  { get name() { return t('links.docs.name') }, get desc() { return t('links.docs.desc') }, icon: 'docs', g1: 'var(--g-blue-1)', g2: 'var(--g-blue-2)', href: '#' },
  { get name() { return t('links.support.name') }, get desc() { return t('links.support.desc') }, icon: 'heart', g1: 'var(--g-red-1)', g2: 'var(--g-red-2)', href: '#' },
  { get name() { return t('links.site.name') }, get desc() { return t('links.site.desc') }, icon: 'web', g1: 'var(--g-teal-1)', g2: 'var(--g-teal-2)', href: '#' },
]

export function Links() {
  return (
    <div className="view-enter">
      <div className="links-grid">
        {LINKS.map((l) => (
          <a
            key={l.icon}
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
