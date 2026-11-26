import { Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { SettingRow } from '../components/SettingRow'
import { autoScale, resolveDark, type SettingsState, type Theme, type UiScale } from '../state/settings'
import {
  ACCENTS, APPEARANCE_DEFAULTS, CORNERS, DENSITIES, FONTS, GRIDS, LABEL_STYLES, LINES, LOOKS, MOTIONS, NUM_FONTS,
  OVERRIDE_KEYS, PEAKS, WORLDS, contrastRatio, inkOn, lookInfo, type Choice, type Look, type Motion, type World,
} from '../state/looks'
import { WORLD_PREVIEWS } from '../worlds'
import { formatNumber, t } from '../i18n'

const SCALES: { value: UiScale; label: string }[] = [
  { value: 'auto', get label() { return t('appearance.scale.auto') } },
  { value: '0.9', get label() { return t('appearance.scale.0.9') } },
  { value: '1', get label() { return t('appearance.scale.1') } },
  { value: '1.15', get label() { return t('appearance.scale.1.15') } },
  { value: '1.3', get label() { return t('appearance.scale.1.3') } },
  { value: '1.5', get label() { return t('appearance.scale.1.5') } },
  { value: '1.75', get label() { return t('appearance.scale.1.75') } },
  { value: '2', get label() { return t('appearance.scale.2') } },
]

/** Accents darker than this against the ground get a warning: focus rings and marks start to vanish. */
const MIN_ACCENT_CONTRAST = 3

// The miniature's chart: a busy core over a calm mean, in a 100×16 box.
const PEAK_POINTS = '0,12 12,9 22,11 34,4 46,8 58,6 70,10 82,3 100,7'
const MEAN_POINTS = '0,14 12,13 22,13.5 34,11 46,12.5 58,12 70,13 82,10 100,12'

/**
 * A miniature of the dashboard drawn entirely from tokens. It carries its
 * own data-look and data-theme, so the tokens inside are that look's, not
 * the current one's.
 */
function LookPreview({ look, dark }: { look: Look; dark: boolean }) {
  return (
    <span className="look-prev" data-look={look} data-theme={dark ? 'dark' : 'light'} aria-hidden="true">
      <span className="look-prev__side"><i /><i /><i /><i /><i /></span>
      <span className="look-prev__main">
        <span className="look-prev__lbl">{t('appearance.preview.label')}</span>
        <span className="look-prev__hero">000</span>
        <svg className="look-prev__chart" viewBox="0 0 100 16" preserveAspectRatio="none">
          <line className="grid" x1="0" y1="8" x2="100" y2="8" />
          <polyline className="peak" points={PEAK_POINTS} />
          <polyline className="mean" points={MEAN_POINTS} />
        </svg>
        <span className="look-prev__btn">{t('appearance.preview.button')}</span>
      </span>
    </span>
  )
}

/** The card picked from the keyboard, focused again once the new world has drawn its settings. */
let refocus: string | null = null

/**
 * A row of cards as one radio group: arrows move the choice, as in any
 * native one. Holds the worlds and, under Katalog, its looks. Picking a
 * world rebuilds the whole window, so there (`deferPick`) arrows only move
 * focus and Enter or Space picks.
 */
function CardGrid<T extends string>({
  items, value, label, tour, wide, deferPick, preview, onPick,
}: {
  items: { id: T; name: string; desc: string }[]
  value: T
  label: string
  tour?: string
  wide?: boolean
  deferPick?: boolean
  preview: (id: T) => ReactNode
  onPick: (id: T) => void
}) {
  const cards = useRef<(HTMLButtonElement | null)[]>([])
  // A stored id no longer listed still leaves one card reachable by Tab.
  const [focused, setFocused] = useState<T | null>(null)
  const current = focused ?? (items.some((it) => it.id === value) ? value : items[0].id)

  useEffect(() => {
    const i = items.findIndex((it) => it.id === refocus)
    if (i < 0) return
    refocus = null
    cards.current[i]?.focus()
  }, [items])

  function onKey(e: KeyboardEvent, i: number) {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (i + step + items.length) % items.length
    if (deferPick) setFocused(items[next].id)
    else onPick(items[next].id)
    cards.current[next]?.focus()
  }

  return (
    <div className={wide ? 'look-grid look-grid--wide' : 'look-grid'} role="radiogroup" aria-label={label} data-tour={tour}>
      {items.map((it, i) => {
        const on = it.id === current
        return (
          <button
            key={it.id}
            ref={(el) => { cards.current[i] = el }}
            type="button"
            role="radio"
            aria-checked={it.id === value}
            tabIndex={on ? 0 : -1}
            className="look-card"
            onClick={(e) => {
              // detail 0: Enter or Space, not a mouse click.
              if (deferPick && e.detail === 0) refocus = it.id
              setFocused(null)
              onPick(it.id)
            }}
            onKeyDown={(e) => onKey(e, i)}
          >
            {preview(it.id)}
            <span className="look-card__name">{it.name}{it.id === value && <span className="mono">{t('appearance.in-use')}</span>}</span>
            <span className="look-card__desc">{it.desc}</span>
          </button>
        )
      })}
    </div>
  )
}

/** A world's own miniature, drawn inside its own data-world and data-theme. */
function WorldPreview({ world, look, dark }: { world: World; look: Look; dark: boolean }) {
  if (world === 'katalog') return <LookPreview look={look} dark={dark} />
  const Preview = WORLD_PREVIEWS[world]
  return (
    <span className="world-prev" data-world={world} data-theme={dark ? 'dark' : 'light'} aria-hidden="true">
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    </span>
  )
}

/** A select whose first option hands the choice back to the look, naming what the look picks. */
function OverrideSelect<T extends string>({
  value, choices, own, label, onChange,
}: {
  value: T | 'look'
  choices: Choice<T>[]
  /** What the Katalog look picks; another world just says "as in the world". */
  own?: string
  label: string
  onChange: (value: T | 'look') => void
}) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value as T | 'look')}>
      <option value="look">{own ? t('appearance.like-look', { own }) : t('appearance.like-world')}</option>
      {choices.map((c) => (
        <option key={c.value} value={c.value}>{c.label}</option>
      ))}
    </select>
  )
}

function AccentPicker({ settings, dark }: { settings: SettingsState; dark: boolean }) {
  const { settings: s, set } = settings
  const own = lookInfo(s.look).own.accent
  return (
    <div className="accent-picker" role="group" aria-label={t('appearance.accent')}>
      <button
        type="button"
        aria-pressed={s.accent === 'look'}
        className="accent-dot accent-dot--look"
        data-world={s.world}
        data-look={s.world === 'katalog' ? s.look : undefined}
        data-theme={dark ? 'dark' : 'light'}
        title={s.world === 'katalog' ? t('appearance.accent.from-look', { own }) : t('appearance.accent.from-world')}
        onClick={() => set('accent', 'look')}
      >
        {t('appearance.accent.look')}
      </button>
      {ACCENTS.map((a) => (
        <button
          key={a.id}
          type="button"
          aria-pressed={s.accent === a.id}
          aria-label={a.name}
          title={a.name}
          className="accent-dot"
          style={{ '--swatch': dark ? a.dark : a.light } as CSSProperties}
          onClick={() => set('accent', a.id)}
        />
      ))}
      <label
        className="accent-dot accent-dot--custom"
        data-checked={s.accent === 'custom'}
        title={t('appearance.accent.custom')}
        style={{ '--swatch': s.accentColor, '--on-swatch': inkOn(s.accentColor) } as CSSProperties}
      >
        <input
          type="color"
          aria-label={s.accent === 'custom' ? t('appearance.accent.custom.selected') : t('appearance.accent.custom.label')}
          value={s.accentColor}
          // Choosing the colour already stored fires no change; the click alone means "use mine".
          onClick={() => set('accent', 'custom')}
          onChange={(e) => {
            set('accentColor', e.target.value)
            set('accent', 'custom')
          }}
        />
        <span>{t('appearance.accent.custom.short')}</span>
      </label>
    </div>
  )
}

/**
 * Ustawienia → Wygląd: the five looks, then every override grouped as the
 * user asked for them — colour, typography, shape and density, motion and charts.
 */
export function AppearanceSection({ settings }: { settings: SettingsState }) {
  const { settings: s, set } = settings
  const dark = resolveDark(s.theme)
  const look = lookInfo(s.look)
  const world = WORLDS.find((w) => w.id === s.world) ?? WORLDS[0]
  const katalog = s.world === 'katalog'
  // The looks' own picks describe Katalog only.
  const own = katalog ? look.own : undefined
  const changed = OVERRIDE_KEYS.some((k) => s[k] !== APPEARANCE_DEFAULTS[k])

  // Read after the root has taken the new attributes: child effects run
  // before the settings hook's own, so this waits a frame.
  const [accentRatio, setAccentRatio] = useState<number | null>(null)
  useEffect(() => {
    if (s.accent === 'look') {
      setAccentRatio(null)
      return
    }
    const frame = requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement)
      setAccentRatio(contrastRatio(style.getPropertyValue('--accent'), style.getPropertyValue('--bg')))
    })
    return () => cancelAnimationFrame(frame)
  }, [s.accent, s.accentColor, s.look, s.world, s.theme])
  const weakAccent = accentRatio !== null && accentRatio < MIN_ACCENT_CONTRAST

  return (
    <>
      <div className="section-head">
        <h2>{t('appearance.title')}</h2>
        <span className="count">
          {katalog && look.name !== world.name ? `${world.name} · ${look.name}` : world.name} ·{dark ? t('appearance.mode.dark.short') : t('appearance.mode.light.short')}
        </span>
      </div>
      <CardGrid
        items={WORLDS}
        value={s.world}
        label={t('appearance.worlds')}
        tour="look"
        wide
        deferPick
        preview={(w) => <WorldPreview world={w} look={s.look} dark={dark} />}
        onPick={(w) => set('world', w)}
      />

      {katalog && (
        <>
          <span className="lbl settings-group">{t('appearance.looks')}</span>
          <CardGrid
            items={LOOKS}
            value={s.look}
            label={t('appearance.look')}
            preview={(l) => <LookPreview look={l} dark={dark} />}
            onPick={(l) => set('look', l)}
          />
        </>
      )}

      <span className="lbl settings-group">{t('appearance.group.color')}</span>
      <div className="settings-list">
        <SettingRow name={t('appearance.mode')} desc={t('appearance.mode.desc')}>
          <select value={s.theme} aria-label={t('appearance.mode')} onChange={(e) => set('theme', e.target.value as Theme)}>
            <option value="dark">{t('appearance.mode.dark')}</option>
            <option value="light">{t('appearance.mode.light')}</option>
            <option value="system">{t('appearance.mode.system')}</option>
          </select>
        </SettingRow>
        <SettingRow
          name={t('appearance.accent')}
          desc={
            weakAccent ? (
              <span className="accent-warn">
                {t('appearance.accent.weak', { ratio: formatNumber(accentRatio, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
              </span>
            ) : (
              t('appearance.accent.desc')
            )
          }
        >
          <AccentPicker settings={settings} dark={dark} />
        </SettingRow>
        <SettingRow name={t('appearance.contrast')} desc={t('appearance.contrast.desc')}>
          <select value={s.contrast} aria-label={t('appearance.contrast')} onChange={(e) => set('contrast', e.target.value as typeof s.contrast)}>
            <option value="normal">{t('appearance.contrast.normal')}</option>
            <option value="high">{t('appearance.contrast.high')}</option>
          </select>
        </SettingRow>
      </div>

      <span className="lbl settings-group">{t('appearance.group.type')}</span>
      <div className="settings-list">
        <SettingRow name={t('appearance.font')} desc={t('appearance.font.desc')}>
          <OverrideSelect label={t('appearance.font')} value={s.font} choices={FONTS} own={own?.font} onChange={(v) => set('font', v)} />
        </SettingRow>
        <SettingRow name={t('appearance.numfont')} desc={t('appearance.numfont.desc')}>
          <OverrideSelect label={t('appearance.numfont')} value={s.numFont} choices={NUM_FONTS} own={own?.numFont} onChange={(v) => set('numFont', v)} />
        </SettingRow>
        <SettingRow name={t('appearance.labels')} desc={t('appearance.labels.desc')}>
          <OverrideSelect label={t('appearance.labels')} value={s.labels} choices={LABEL_STYLES} own={own?.labels} onChange={(v) => set('labels', v)} />
        </SettingRow>
      </div>

      <span className="lbl settings-group">{t('appearance.group.shape')}</span>
      <div className="settings-list">
        <SettingRow
          name={t('appearance.scale')}
          desc={
            s.uiScale === 'auto'
              ? t('appearance.scale.desc.auto', { pct: Math.round(autoScale(window.innerWidth, window.innerHeight) * 100) })
              : t('appearance.scale.desc.manual')
          }
        >
          <select value={s.uiScale} aria-label={t('appearance.scale')} onChange={(e) => set('uiScale', e.target.value as UiScale)}>
            {SCALES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow name={t('appearance.corners')} desc={t('appearance.corners.desc')}>
          <OverrideSelect label={t('appearance.corners')} value={s.corners} choices={CORNERS} own={own?.corners} onChange={(v) => set('corners', v)} />
        </SettingRow>
        <SettingRow name={t('appearance.lines')} desc={t('appearance.lines.desc')}>
          <OverrideSelect label={t('appearance.lines')} value={s.lines} choices={LINES} own={own?.lines} onChange={(v) => set('lines', v)} />
        </SettingRow>
        <SettingRow name={t('appearance.density')} desc={t('appearance.density.desc')}>
          <OverrideSelect label={t('appearance.density')} value={s.density} choices={DENSITIES} own={own?.density} onChange={(v) => set('density', v)} />
        </SettingRow>
      </div>

      <span className="lbl settings-group">{t('appearance.group.motion')}</span>
      <div className="settings-list">
        <SettingRow name={t('appearance.motion')} desc={t('appearance.motion.desc')}>
          <select value={s.motion} aria-label={t('appearance.motion')} onChange={(e) => set('motion', e.target.value as Motion)}>
            {MOTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow name={t('appearance.grid')} desc={t('appearance.grid.desc')}>
          <OverrideSelect label={t('appearance.grid')} value={s.chartGrid} choices={GRIDS} own={own?.chartGrid} onChange={(v) => set('chartGrid', v)} />
        </SettingRow>
        <SettingRow name={t('appearance.peak')} desc={t('appearance.peak.desc')}>
          <OverrideSelect label={t('appearance.peak')} value={s.peakLine} choices={PEAKS} own={own?.peakLine} onChange={(v) => set('peakLine', v)} />
        </SettingRow>
      </div>

      <div className="appearance-reset">
        <button
          className="btn btn-ghost"
          disabled={!changed}
          onClick={() => OVERRIDE_KEYS.forEach((k) => set(k, APPEARANCE_DEFAULTS[k]))}
        >
          {t('appearance.reset', { name: katalog ? look.name : world.name })}
        </button>
        <span className="st-desc">
          {changed
            ? t('appearance.reset.desc')
            : t('appearance.reset.none')}
        </span>
      </div>
    </>
  )
}
