import type { ReactElement } from 'react'

type IconProps = { className?: string }

const base = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, viewBox: '0 0 24 24' }

export const icons: Record<string, (props: IconProps) => ReactElement> = {
  files: (p) => (
    <svg {...base} {...p}><path d="M13 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V9z" /><path d="M13 3v6h6.5" /></svg>
  ),
  system: (p) => (
    <svg {...base} {...p}><rect x="3" y="4" width="18" height="12" rx="1.5" /><path d="M9 20h6M12 16v4" /></svg>
  ),
  shield: (p) => (
    <svg {...base} {...p}><path d="M12 3l7 3v6c0 5-3 8-7 9-4-1-7-4-7-9V6z" /></svg>
  ),
  apps: (p) => (
    <svg {...base} {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6v6H9z" /></svg>
  ),
  puzzle: (p) => (
    <svg {...base} {...p}><path d="M10 4a2 2 0 1 1 4 0v1h4v4h1a2 2 0 1 1 0 4h-1v4h-4v1a2 2 0 1 1-4 0v-1H6v-4H5a2 2 0 1 1 0-4h1V5h4z" /></svg>
  ),
  sweep: (p) => (
    <svg {...base} {...p}><path d="M4 20l6-6M14 4l6 6-9 9-6-2 2-6z" /></svg>
  ),
  search: (p) => (
    <svg {...base} {...p}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></svg>
  ),
  duplicate: (p) => (
    <svg {...base} {...p}><rect x="4" y="7" width="11" height="13" rx="2" /><path d="M9 7V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-2" /></svg>
  ),
  shredder: (p) => (
    <svg {...base} {...p}><path d="M5 8h14M9 8V5h6v3M7 8l1 12h8l1-12" /></svg>
  ),
  tag: (p) => (
    <svg {...base} {...p}><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.2" /></svg>
  ),
  hammer: (p) => (
    <svg {...base} {...p}><path d="M14 5l5 5-2 2-5-5zM12 7L4 15l3 3 8-8" /></svg>
  ),
  scissors: (p) => (
    <svg {...base} {...p}><circle cx="6" cy="6" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.2 7.6L20 19M8.2 16.4L20 5" /></svg>
  ),
  package: (p) => (
    <svg {...base} {...p}><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12L4 7.5M12 12v9" /></svg>
  ),
  logs: (p) => (
    <svg {...base} {...p}><path d="M5 5h14M5 9h14M5 13h9M5 17h6" /></svg>
  ),
  diskmap: (p) => (
    <svg {...base} {...p}><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="5" /><rect x="13" y="10" width="8" height="4" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="16" width="8" height="5" /></svg>
  ),
  autostart: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="13" r="7" /><path d="M12 9v4M9.5 5.5l1 2M14.5 5.5l-1 2" /></svg>
  ),
  pulse: (p) => (
    <svg {...base} {...p}><path d="M3 12h4l2-6 4 12 2-6h6" /></svg>
  ),
  layers: (p) => (
    <svg {...base} {...p}><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></svg>
  ),
  gears: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M12 4v2.5M12 17.5V20M20 12h-2.5M6.5 12H4M17.7 6.3l-1.8 1.8M8.1 15.9l-1.8 1.8M17.7 17.7l-1.8-1.8M8.1 8.1L6.3 6.3" /></svg>
  ),
  trash: (p) => (
    <svg {...base} {...p}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" /></svg>
  ),
  clock: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></svg>
  ),
  kernel: (p) => (
    <svg {...base} {...p}><rect x="7" y="7" width="10" height="10" rx="2" /><path d="M10 3v2.5M14 3v2.5M10 18.5V21M14 18.5V21M3 10h2.5M3 14h2.5M18.5 10H21M18.5 14H21" /></svg>
  ),
  boot: (p) => (
    <svg {...base} {...p}><path d="M5 4h14v10H5z" /><path d="M8 18h8M12 14v4M8 8h4" /></svg>
  ),
  globe: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.3-3.8-8.5s1.2-6.1 3.8-8.5z" /></svg>
  ),
  vault: (p) => (
    <svg {...base} {...p}><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="12" cy="12" r="4" /><path d="M12 10v2l1.4 1.4" /></svg>
  ),
  download: (p) => (
    <svg {...base} {...p}><path d="M12 3v13M7 12l5 5 5-5M5 21h14" /></svg>
  ),
  dashboard: (p) => (
    <svg {...base} {...p}><rect x="3" y="3" width="8" height="10" rx="1.5" /><rect x="13" y="3" width="8" height="6" rx="1.5" /><rect x="13" y="11" width="8" height="10" rx="1.5" /><rect x="3" y="15" width="8" height="6" rx="1.5" /></svg>
  ),
  settings: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.3-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.06-.4.1-.8.1-1.2z" /></svg>
  ),
  manager: (p) => (
    <svg {...base} {...p}><rect x="3" y="5" width="18" height="4" rx="1.5" /><rect x="3" y="11" width="18" height="4" rx="1.5" /><rect x="3" y="17" width="12" height="4" rx="1.5" /><path d="M19 19h2" /></svg>
  ),
  links: (p) => (
    <svg {...base} {...p}><path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.5-5.5l-1.7 1.7" /><path d="M14 10a4 4 0 0 0-6-.5l-3 3a4 4 0 0 0 5.5 5.5l1.7-1.7" /></svg>
  ),
  chevron: (p) => (
    <svg {...base} {...p}><path d="M9 6l6 6-6 6" /></svg>
  ),
  windows: (p) => (
    <svg {...base} {...p}><rect x="3" y="4" width="8" height="8" /><rect x="13" y="4" width="8" height="8" /><rect x="3" y="14" width="8" height="6" /><rect x="13" y="14" width="8" height="6" /></svg>
  ),
  linux: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="9" r="3.4" /><path d="M8 20c.5-4 2-6 4-6s3.5 2 4 6" /></svg>
  ),
  macos: (p) => (
    <svg {...base} {...p}><path d="M16.5 12.2c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.1 2.5-1.8 3.1-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.3-1.2 3.1-2.5.7-1 1-1.9 1.6-3.1-2.1-.8-2.2-3-2.2-3.6z" /></svg>
  ),
  github: (p) => (
    <svg {...base} {...p}><path d="M12 3a9 9 0 0 0-2.85 17.55c.45.08.62-.2.62-.44v-1.7c-2.5.55-3.03-1.06-3.03-1.06-.41-1.04-1-1.32-1-1.32-.82-.56.06-.55.06-.55.9.06 1.38.93 1.38.93.8 1.38 2.11.98 2.63.75.08-.58.31-.98.57-1.2-2-.23-4.1-1-4.1-4.45 0-.98.35-1.79.93-2.42-.1-.23-.4-1.15.08-2.4 0 0 .76-.24 2.48.92a8.6 8.6 0 0 1 4.5 0c1.72-1.16 2.48-.92 2.48-.92.49 1.25.18 2.17.09 2.4.58.63.93 1.44.93 2.42 0 3.47-2.1 4.22-4.11 4.44.32.28.61.83.61 1.67v2.47c0 .24.16.53.62.44A9 9 0 0 0 12 3z" /></svg>
  ),
  docs: (p) => (
    <svg {...base} {...p}><path d="M5 4h9l5 5v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" /><path d="M14 4v5h5M8 13h8M8 17h5" /></svg>
  ),
  heart: (p) => (
    <svg {...base} {...p}><path d="M12 20s-7-4.5-9-9c-1.2-2.7.5-6 3.7-6 2 0 3.3 1 4.3 2.6C12 6 13.3 5 15.3 5c3.2 0 4.9 3.3 3.7 6-2 4.5-7 9-7 9z" /></svg>
  ),
  web: (p) => (
    <svg {...base} {...p}><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.6 2.4 3.8 5.3 3.8 8.5s-1.2 6.1-3.8 8.5c-2.6-2.4-3.8-5.3-3.8-8.5s1.2-6.1 3.8-8.5z" /></svg>
  ),
  check: (p) => (
    <svg {...base} {...p}><path d="M5 12l5 5 9-10" /></svg>
  ),
  alert: (p) => (
    <svg {...base} {...p}><path d="M12 4l9 15H3z" /><path d="M12 10v4M12 17.2v.3" /></svg>
  ),
  folder: (p) => (
    <svg {...base} {...p}><path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h4l2 2.5h7A1.5 1.5 0 0 1 20 9v8.5A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5z" /></svg>
  ),
  file: (p) => (
    <svg {...base} {...p}><path d="M6 3.5h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1z" /><path d="M14 3.5v4h4" /></svg>
  ),
}

export function Icon({ name, className }: { name: string; className?: string }) {
  const Cmp = icons[name] ?? icons.apps
  return <Cmp className={className} />
}
