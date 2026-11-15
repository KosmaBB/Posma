# Writing a theme

A theme in POSMA changes the whole app, not only its colours: the
navigation, the home screen, the folder pages, the frame around each module,
and the way shared pieces such as buttons and lists are drawn. In the code,
and in **Ustawienia → Wygląd → Świat aplikacji**, a theme is called a
**world** (`World`, folder `core/src/worlds/<id>/`). POSMA ships six:
Katalog, Gęsto, Kaseta, Strumień, Książeczka and Monochrom.

Katalog's five *looks* (Katalog, Systemowy, Plakat, Konsola, Kalkulator) are
palette variants of one world, not themes. The person's own overrides —
accent, contrast, fonts, labels, corners, lines, density, motion, chart —
apply on top of whichever world is chosen.

> **Today and at 1.0.** A theme is compiled into the app: you add it to the
> source tree and it ships in a build. Installing and removing themes the way
> modules will be installed and removed is planned, together with module
> distribution at 1.0. Until then this page describes the source-tree route.

## What you write it in

| | |
|---|---|
| Code | TypeScript and React 19, as in the rest of `core/src` |
| Styles | One plain CSS file per theme, more if you split it. No CSS framework, no CSS-in-JS |
| Fonts | npm packages (`@fontsource/*`, `@fontsource-variable/*`) imported in your `index.tsx`. They are bundled and load only when the theme is chosen. Nothing is fetched at runtime — POSMA works offline, so no Google Fonts and no CDN |
| Interface text | Polish, like the rest of the app. Counts go through `plural(n, one, few, many)`; sizes and numbers through the helpers in `state/machine.ts`, which use the Polish decimal comma |
| Code comments and identifiers | English |

## Start from the starter

[`templates/world/`](https://github.com/KosmaBB/Posma/tree/master/templates/world)
is a complete, minimal theme: a top bar, cards on the home screen, folder and
module pages, every view handled, the tour's targets placed, both modes, the
13 px floor and the specificity contract already in place. Copy it and
reshape it rather than starting from an empty file.

```sh
cp -r templates/world core/src/worlds/mytheme
rm core/src/worlds/mytheme/README.md
# rename the CSS scope (on macOS: sed -i '' …)
sed -i 's/starter/mytheme/g' core/src/worlds/mytheme/*.css core/src/worlds/mytheme/*.tsx
```

Then register it — two files, three lines.

`core/src/state/looks.ts`:

```ts
export type World = 'katalog' | 'gesto' | 'kaseta' | 'strumien' | 'ksiazeczka' | 'monochrom' | 'mytheme'

export const WORLDS: WorldInfo[] = [
  // …the existing six…
  { id: 'mytheme', name: 'Mój motyw', desc: 'Jedno zdanie o tym, czym ten świat jest.' },
]
```

`core/src/worlds/index.ts`:

```ts
const LOADERS: Record<Built, () => Promise<WorldModule>> = {
  // …
  mytheme: () => import('./mytheme'),
}
```

Run the app (`npm --prefix core run tauri dev`, see
[Building and development](building.md)), open **Ustawienia → Wygląd** and
pick your card. The world's code, stylesheet and fonts load the first time it
is chosen. The stored setting is validated against `WORLDS`, so an id that is
not registered falls back to Katalog, and a world that throws while rendering
is replaced by Katalog instead of a blank window.

## The files

| File | What it holds |
|---|---|
| `index.tsx` | Imports `world.css` and the fonts; exports `Shell` and `Preview`. Nothing else is read from a world |
| `Shell.tsx` | The whole window: navigation, then one view at a time |
| `Preview.tsx` | The small card in the theme picker. Decoration only: `aria-hidden`, no live data, no interaction |
| `world.css` | Tokens for both modes, then everything this world draws |
| anything else | Split components as you like; `Home.tsx` in the starter is one |

## What the shell receives

```ts
export interface ShellProps {
  app: AppState           // state/appState.ts
  settings: SettingsState // state/settings.ts
}
```

| `app.` | |
|---|---|
| `view`, `setView(view)` | The current view and how to change it |
| `onboarding` | `os` (`'linux' \| 'macos' \| 'windows'`), `accessLevel` (`'full' \| 'selective'`), the first-run choices |
| `installedSet` | Ids of the modules switched on in the manager |
| `moduleOrder`, `setFolderOrder(folder, ids)` | The person's order of modules inside each folder |
| `linuxProfile` | Distribution, family, desktop, package manager — `null` off Linux or before detection |
| `touring`, `startTour()`, `endTour()` | The tour (Samouczek) |

`settings.settings` holds the stored settings (`refreshMs`, `theme`,
`uiScale`, the appearance fields); `settings.set(key, value)` changes one.

Every kind of `View` must lead somewhere:

| `view.kind` | Render |
|---|---|
| `dashboard` | Your home screen |
| `folder` (`folderId`) | The modules of that folder |
| `module` (`moduleId`, optional `param`) | Your frame around `<ModuleBody app={app} mod={mod} />` |
| `settings` | `<Settings app={app} settings={settings} />` |
| `manager` | `<ModuleManager app={app} />` |
| `links` | `<Links />` |

and while `app.touring` is true, render `<Tour app={app} onClose={app.endTour} />`.

## Shared pieces — reuse, don't rebuild

- **`ModuleBody`** (`views/ModuleView.tsx`) is the module's own interface.
  A theme frames it and restyles its blocks; it never reimplements a module.
- **`Settings`, `ModuleManager`, `Links`, `Tour`** are shared too.
- **`useMachine(refreshMs)`** (`state/machine.ts`) polls the live readings:
  `cpu`, `ram`, `temp` (each a reading with `value` and an optional `detail`,
  or `undefined` when the machine gave none), `disks`, `mainDisk`, `crowded`
  (other nearly full volumes), `record` (per-core history), `coreCount`,
  `error`. Container overlays and pseudo mounts are already filtered out.
- **`useReclaim(app)`** runs the read-only "how much could be reclaimed"
  check over the switched-on cleaning modules: `reclaim` (`idle`,
  `scanning`, `done`), `sources`, `check()`, `found`, `total`, `foundOf(id)`.
- **Formatting:** `gb`, `size`, `fill`, `usedPct`, `plural`, `UP_TO_ONE`,
  `systemName(app)`, `DISK_WARN_PCT`.
- **The catalog** (`data/modules.ts`): `folders`, `modulesInFolder`,
  `orderedModules`, `applyOrder`, `catalogNumbers`, `folderNumber`,
  `moduleById`, `riskLabel`; and `APP_PAGES` (`components/shell/Sidebar.tsx`)
  for the manager, settings and links pages.

## Variable names (tokens)

Shared blocks — module interfaces, settings, the manager, the tour card,
dialogs — are drawn with these custom properties. Set them and those blocks
follow your theme. **Any token you leave out falls back to Katalog's value**
from `styles/global.css`.

**Colour** — set in both modes:

| Token | Role |
|---|---|
| `--bg`, `--bg-2`, `--bg-3` | Ground, panel, raised or hover surface |
| `--ink` | Body text |
| `--muted`, `--dim` | Secondary and tertiary text — both still at 4.5:1 |
| `--accent`, `--on-accent` | Accent and the text on it |
| `--border`, `--border-strong` | Lines |
| `--good`, `--warn`, `--critical`, `--on-critical` | States |
| `--panel-bg`, `--side-bg`, `--nav-active-bg`, `--panel-shadow` | Surfaces a theme may separate from the ground |
| `--g-teal-1`, `--g-blue-1`, `--g-green-1`, `--g-red-1`, `--g-violet-1` (and `-2`) | Folder codes: Dane i pliki, System, Bezpieczeństwo, Aplikacje, Własne |
| `color-scheme` | `dark` or `light`, so native controls match |

**Type:**

| Token | Role |
|---|---|
| `--sans`, `--mono` | Text face, number face |
| `--lbl-size`, `--lbl-weight`, `--lbl-stretch`, `--lbl-tracking`, `--lbl-transform`, `--lbl-color` | The descriptive label voice |
| `--btn-size`, `--btn-weight`, `--btn-tracking`, `--btn-transform` | Buttons |
| `--title-size`, `--folder-size` | Titles, folder names |

**Shape, rhythm, charts:**

| Token | Role |
|---|---|
| `--radius`, `--radius-sm`, `--radius-pill`, `--bar-rx` | Corners |
| `--hair`, `--rule` | Line weights |
| `--d` | Density multiplier — write spacing as `calc(16px * var(--d))` |
| `--chart-mean`, `--chart-peak`, `--chart-grid`, `--chart-w`, `--chart-grid-opacity`, `--chart-peak-dash`, `--chart-peak-opacity` | The CPU chart |

### Which setting moves which token

Route your own styles through the same tokens, or the person's setting will
do nothing in your theme.

| Setting (Ustawienia → Wygląd) | Root attribute | Tokens |
|---|---|---|
| Kolor akcentu | inline style | `--accent`, `--on-accent` |
| Kontrast: wysoki | `data-contrast="high"` | `--muted`, `--dim` and the borders move toward `--ink` |
| Krój tekstu, Krój liczb | `data-font`, `data-num-font` | `--sans`, `--mono` |
| Etykiety | `data-labels` | `--lbl-*` |
| Narożniki | `data-corners` | `--radius`, `--radius-sm`, `--radius-pill`, `--bar-rx` |
| Linie | `data-lines` | `--hair`, `--rule`, `--chart-w` |
| Gęstość | `data-density` | `--d` |
| Ruch | `data-motion="reduced"` or `"off"` | — (see Motion) |
| Siatka wykresu, Linia szczytu | `data-chart-grid`, `data-peak` | `--chart-grid-opacity`, `--chart-peak-dash` |

Other attributes on `<html>`: `data-world` (your id), `data-theme`
(`light` or `dark`), `data-fit` and `data-fit-h` (below). `data-look` is set
only in Katalog.

## The specificity contract

```css
/* structure — (0,1,x) */
[data-world='mytheme'] { --sans: …; --radius: 8px; }
[data-world='mytheme'] .my-bar { … }

/* colours — (0,2,0) */
[data-world='mytheme'][data-theme='dark']  { --bg: …; --ink: …; }
[data-world='mytheme'][data-theme='light'] { --bg: …; --ink: …; }
```

The person's overrides (`styles/custom.css`, 0,2,0) then outrank your
structure, high contrast (0,3,0) outranks your colours, and a chosen accent
is set inline on the root, above both. Prefix your own classes (the starter
uses `st-`) so they never meet another world's, and never style outside
`[data-world='<your id>']`.

## Less space: `data-fit`, never `@media`

The window is at least 1600 × 900, and UI scaling (90–150 %) works through
`zoom`, which media queries cannot see: at 150 % a 1600 px window leaves
about 1067 px, while `@media (max-width: …)` still measures 1600. So
`state/settings.ts` puts the space left after scaling on the root as steps:

- `data-fit~='N'` for N in 980, 1100, 1180, 1280, 1340, 1407, 1440, 1700
- `data-fit-h~='760'`

```css
[data-world='mytheme']:where([data-fit~='1280']) .my-home { grid-template-columns: 1fr 1fr; }
```

`:where()` keeps the specificity of the rule inside. Need a step that is not
listed? Add it to `FIT_WIDTHS` or `FIT_HEIGHTS` in `settings.ts` — a step
that exists only in CSS never matches.

## Motion

- CSS: transitions and animations only under
  `@media (prefers-reduced-motion: no-preference)` and when the root has no
  `data-motion` attribute, or give them a reduced form. `data-motion="off"`
  is enforced globally.
- JS: ask `motionReduced()` (`state/looks.ts`) before smooth scrolling or
  animating.

## The tour

The tour walks through the app and points at elements by `data-tour`. Place
these in your views:

| View | `data-tour` |
|---|---|
| dashboard | `cpu`, `machine`, `reclaim` (its children are highlighted), `index`, `folder` (each folder entry in the navigation), `tour` (the button that starts it) |
| folder | `folder-list` |
| module | `module-hero`, and `module` — its **second child** must be the module interface |

Settings and the manager bring their own targets. A step whose target is
missing waits 2.5 s, then shows its card without a highlight.

## The floor

Every theme meets these, in both modes:

- **Contrast:** body, muted and dim text at 4.5:1 against the ground and the
  panel; large text (24 px, or 18.66 px bold) at 3:1; button text at 4.5:1
  against its fill.
- **13 px minimum** for any text. Katalog's labels are 12 px, so set
  `--lbl-size`, `--btn-size` and `--folder-size` to at least 13 px, and copy
  the starter's list of shared blocks that use a literal 12 px.
- **Visible keyboard focus** on everything that can be focused. Inside a row
  that clips its overflow, draw the ring inside (`outline-offset: -2px`).
- **Global keyboard handlers** ignore keys typed into fields
  (`input, select, textarea, [contenteditable]`), stay quiet while
  `app.touring` is true or a `.modal-backdrop` is open, and are removed in
  the effect's cleanup.
- **Real data only.** Show what the machine reported; a missing reading
  stays missing. No invented figures, histories or findings — POSMA keeps no
  history of operations, so a theme cannot show one.
- **Every view and its empty, loading and not-found states.**
- **Nothing destructive outside a module.** The home screen may run
  read-only checks (`useReclaim`); deleting and changing things stays inside
  `ModuleBody`, behind the module's own confirmation.

## Before you open a pull request

- `npm --prefix core run build` passes (type check and production build).
- The theme looks right in light and dark, at 100 %, 130 % and 150 % UI
  scale, with high contrast on, and with each override changed.
- The tour (Samouczek) runs from start to finish.
- A module scan runs inside your frame — Czyszczenie Temp is a safe one,
  since scanning only reads.

Then follow [CONTRIBUTING.md](https://github.com/KosmaBB/Posma/blob/master/CONTRIBUTING.md),
with screenshots of both modes in the pull request. Contributions are
accepted under the project's dual-licence terms.
