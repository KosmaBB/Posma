import { Suspense, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { SettingRow } from '../components/SettingRow'
import { autoScale, resolveDark, type SettingsState, type Theme, type UiScale } from '../state/settings'
import {
  ACCENTS, APPEARANCE_DEFAULTS, CORNERS, DENSITIES, FONTS, GRIDS, LABEL_STYLES, LINES, LOOKS, MOTIONS, NUM_FONTS,
  OVERRIDE_KEYS, PEAKS, WORLDS, contrastRatio, inkOn, lookInfo, type Choice, type Look, type Motion, type World,
} from '../state/looks'
import { WORLD_PREVIEWS } from '../worlds'

const SCALES: { value: UiScale; label: string }[] = [
  { value: 'auto', label: 'Automatyczne' },
  { value: '0.9', label: 'Mniejsze (90%)' },
  { value: '1', label: 'Domyślne (100%)' },
  { value: '1.15', label: 'Większe (115%)' },
  { value: '1.3', label: 'Duże (130%)' },
  { value: '1.5', label: 'Bardzo duże (150%)' },
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
        <span className="look-prev__lbl">Profil procesora</span>
        <span className="look-prev__hero">000</span>
        <svg className="look-prev__chart" viewBox="0 0 100 16" preserveAspectRatio="none">
          <line className="grid" x1="0" y1="8" x2="100" y2="8" />
          <polyline className="peak" points={PEAK_POINTS} />
          <polyline className="mean" points={MEAN_POINTS} />
        </svg>
        <span className="look-prev__btn">Skanuj</span>
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
            <span className="look-card__name">{it.name}{it.id === value && <span className="mono">w użyciu</span>}</span>
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
      <option value="look">{own ? `Jak w wyglądzie (${own})` : 'Jak w świecie'}</option>
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
    <div className="accent-picker" role="group" aria-label="Kolor akcentu">
      <button
        type="button"
        aria-pressed={s.accent === 'look'}
        className="accent-dot accent-dot--look"
        data-world={s.world}
        data-look={s.world === 'katalog' ? s.look : undefined}
        data-theme={dark ? 'dark' : 'light'}
        title={s.world === 'katalog' ? `Z wyglądu (${own})` : 'Ze świata'}
        onClick={() => set('accent', 'look')}
      >
        z wyglądu
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
        title="Własny kolor"
        style={{ '--swatch': s.accentColor, '--on-swatch': inkOn(s.accentColor) } as CSSProperties}
      >
        <input
          type="color"
          aria-label={s.accent === 'custom' ? 'Własny kolor akcentu, wybrany' : 'Własny kolor akcentu'}
          value={s.accentColor}
          // Choosing the colour already stored fires no change; the click alone means "use mine".
          onClick={() => set('accent', 'custom')}
          onChange={(e) => {
            set('accentColor', e.target.value)
            set('accent', 'custom')
          }}
        />
        <span>własny</span>
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
        <h2>Wygląd</h2>
        <span className="count">
          {katalog ? `${world.name} · ${look.name}` : world.name} · {dark ? 'ciemny' : 'jasny'}
        </span>
      </div>
      <CardGrid
        items={WORLDS}
        value={s.world}
        label="Świat aplikacji"
        tour="look"
        wide
        deferPick
        preview={(w) => <WorldPreview world={w} look={s.look} dark={dark} />}
        onPick={(w) => set('world', w)}
      />

      {katalog && (
        <>
          <span className="lbl settings-group">Odmiany Katalogu</span>
          <CardGrid
            items={LOOKS}
            value={s.look}
            label="Odmiana Katalogu"
            preview={(l) => <LookPreview look={l} dark={dark} />}
            onPick={(l) => set('look', l)}
          />
        </>
      )}

      <span className="lbl settings-group">Kolor</span>
      <div className="settings-list">
        <SettingRow name="Tryb" desc="Każdy wygląd ma wersję jasną i ciemną. Systemowy idzie za ustawieniem systemu.">
          <select value={s.theme} aria-label="Tryb" onChange={(e) => set('theme', e.target.value as Theme)}>
            <option value="dark">Ciemny</option>
            <option value="light">Jasny</option>
            <option value="system">Systemowy</option>
          </select>
        </SettingRow>
        <SettingRow
          name="Kolor akcentu"
          desc={
            weakAccent ? (
              <span className="accent-warn">
                Ten kolor słabo odcina się od tła ({accentRatio.toFixed(1)}:1) — zaznaczenia i obramowania mogą zniknąć.
              </span>
            ) : (
              'Kolor przycisków, zaznaczeń i obramowania skupienia. Gotowe kolory mają osobny odcień na jasne i ciemne tło.'
            )
          }
        >
          <AccentPicker settings={settings} dark={dark} />
        </SettingRow>
        <SettingRow name="Kontrast" desc="Wysoki zbliża opisy, podpisy i linie do koloru tekstu.">
          <select value={s.contrast} aria-label="Kontrast" onChange={(e) => set('contrast', e.target.value as typeof s.contrast)}>
            <option value="normal">Normalny</option>
            <option value="high">Wysoki</option>
          </select>
        </SettingRow>
      </div>

      <span className="lbl settings-group">Typografia</span>
      <div className="settings-list">
        <SettingRow name="Krój tekstu" desc="Atkinson Hyperlegible rozróżnia litery, które inne kroje zlewają (Il1, O0).">
          <OverrideSelect label="Krój tekstu" value={s.font} choices={FONTS} own={own?.font} onChange={(v) => set('font', v)} />
        </SettingRow>
        <SettingRow name="Krój liczb" desc="Odczyty, ścieżki i numery katalogowe. Cyfry zawsze mają równą szerokość.">
          <OverrideSelect label="Krój liczb" value={s.numFont} choices={NUM_FONTS} own={own?.numFont} onChange={(v) => set('numFont', v)} />
        </SettingRow>
        <SettingRow name="Etykiety" desc="Podpisy sekcji, przyciski i nazwy folderów.">
          <OverrideSelect label="Etykiety" value={s.labels} choices={LABEL_STYLES} own={own?.labels} onChange={(v) => set('labels', v)} />
        </SettingRow>
      </div>

      <span className="lbl settings-group">Kształt i gęstość</span>
      <div className="settings-list">
        <SettingRow
          name="Skalowanie interfejsu"
          desc={
            s.uiScale === 'auto'
              ? `Automatyczne dobiera skalę do szerokości okna — teraz ${Math.round(autoScale(window.innerWidth) * 100)}%.`
              : 'Ustaw ręcznie, jeśli przy Twojej rozdzielczości tekst jest za mały lub za duży.'
          }
        >
          <select value={s.uiScale} aria-label="Skalowanie interfejsu" onChange={(e) => set('uiScale', e.target.value as UiScale)}>
            {SCALES.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow name="Narożniki" desc="Karty, przyciski, pola i paski.">
          <OverrideSelect label="Narożniki" value={s.corners} choices={CORNERS} own={own?.corners} onChange={(v) => set('corners', v)} />
        </SettingRow>
        <SettingRow name="Linie" desc="Grubość ramek, podziałów i linii wykresu.">
          <OverrideSelect label="Linie" value={s.lines} choices={LINES} own={own?.lines} onChange={(v) => set('lines', v)} />
        </SettingRow>
        <SettingRow name="Gęstość" desc="Odstępy w listach, tabelach i pasku bocznym.">
          <OverrideSelect label="Gęstość" value={s.density} choices={DENSITIES} own={own?.density} onChange={(v) => set('density', v)} />
        </SettingRow>
      </div>

      <span className="lbl settings-group">Ruch i wykresy</span>
      <div className="settings-list">
        <SettingRow name="Ruch" desc="Ograniczony zostawia przenikanie, ale nic się nie przesuwa. Wyłączony gasi każdą animację.">
          <select value={s.motion} aria-label="Ruch" onChange={(e) => set('motion', e.target.value as Motion)}>
            {MOTIONS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </SettingRow>
        <SettingRow name="Siatka wykresu" desc="Poziome linie skali pod profilem procesora.">
          <OverrideSelect label="Siatka wykresu" value={s.chartGrid} choices={GRIDS} own={own?.chartGrid} onChange={(v) => set('chartGrid', v)} />
        </SettingRow>
        <SettingRow name="Linia szczytu" desc="Najbardziej zajęty rdzeń, rysowany obok średniej.">
          <OverrideSelect label="Linia szczytu" value={s.peakLine} choices={PEAKS} own={own?.peakLine} onChange={(v) => set('peakLine', v)} />
        </SettingRow>
      </div>

      <div className="appearance-reset">
        <button
          className="btn btn-ghost"
          disabled={!changed}
          onClick={() => OVERRIDE_KEYS.forEach((k) => set(k, APPEARANCE_DEFAULTS[k]))}
        >
          Przywróć wygląd „{katalog ? look.name : world.name}”
        </button>
        <span className="st-desc">
          {changed
            ? 'Cofa akcent, kontrast, kroje, etykiety, narożniki, linie, gęstość i wykres. Tryb, skala i ruch zostają.'
            : 'Nic nie jest nadpisane — widzisz wygląd taki, jaki jest.'}
        </span>
      </div>
    </>
  )
}
