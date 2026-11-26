# Pisanie motywu

*[English version →](../writing-a-theme.md)*

Motyw w POSMA zmienia całą aplikację, nie tylko kolory: nawigację, ekran
główny, strony folderów, ramę wokół każdego modułu i sposób rysowania
wspólnych elementów, takich jak przyciski i listy. W kodzie i w
**Ustawienia → Wygląd → Świat aplikacji** motyw nazywa się **światem**
(`World`, folder `core/src/worlds/<id>/`). POSMA ma ich sześć: Katalog,
Gęsto, Kaseta, Strumień, Książeczka i Monochrom.

Pięć *odmian* Katalogu (Katalog, Systemowy, Plakat, Konsola, Kalkulator) to
warianty palety jednego świata, nie osobne motywy. Własne ustawienia osoby
korzystającej z aplikacji — akcent, kontrast, kroje, etykiety, narożniki,
linie, gęstość, ruch, wykres — nakładają się na każdy wybrany świat.

> **Dziś i w 1.0.** Motyw jest wkompilowany w aplikację: dodajesz go do
> drzewa źródeł i trafia do wydania razem z buildem. Instalowanie i usuwanie
> motywów tak, jak będą instalowane i usuwane moduły, jest zaplanowane razem
> z dystrybucją modułów w 1.0. Do tego czasu ta strona opisuje drogę przez
> drzewo źródeł.

## W czym się go pisze

| | |
|---|---|
| Kod | TypeScript i React 19, jak reszta `core/src` |
| Style | Jeden zwykły plik CSS na motyw, więcej, jeśli go podzielisz. Bez frameworka CSS, bez CSS-in-JS |
| Fonty | Paczki npm (`@fontsource/*`, `@fontsource-variable/*`) importowane w `index.tsx`. Są dołączane do aplikacji i wczytują się dopiero po wybraniu motywu. Nic nie jest pobierane w trakcie działania — POSMA działa offline, więc żadnych Google Fonts ani CDN |
| Teksty interfejsu | Klucze w `core/src/i18n/pl.json` i `en.json`, pokazywane przez `t('klucz')` — patrz [Pisanie tłumaczenia](writing-a-translation.md). Dołączone światy są w trakcie przenoszenia i piszą po polsku wprost, z liczebnikami przez `plural(n, jeden, kilka, wiele)`. Rozmiary i liczby idą przez funkcje z `state/machine.ts`, które wciąż używają polskiego przecinka dziesiętnego |
| Komentarze w kodzie i identyfikatory | Po angielsku |

## Zacznij od szablonu

[`templates/world/`](https://github.com/KosmaBB/Posma/tree/master/templates/world)
to kompletny, minimalny motyw: górny pasek, karty na ekranie głównym, strony
folderu i modułu, obsłużony każdy widok, rozstawione cele samouczka, oba
tryby, minimum 13 px i zasady specyficzności na miejscu. Skopiuj go i
przerabiaj, zamiast zaczynać od pustego pliku.

```sh
cp -r templates/world core/src/worlds/mytheme
rm core/src/worlds/mytheme/README*.md
# zmień zakres CSS (na macOS: sed -i '' …)
sed -i 's/starter/mytheme/g' core/src/worlds/mytheme/*.css core/src/worlds/mytheme/*.tsx
```

Potem go zarejestruj — dwa pliki, trzy linie.

`core/src/state/looks.ts`:

```ts
export type World = 'katalog' | 'gesto' | 'kaseta' | 'strumien' | 'ksiazeczka' | 'monochrom' | 'mytheme'

export const WORLDS: WorldInfo[] = [
  // …istniejące sześć…
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

Uruchom aplikację (`npm --prefix core run tauri dev`, patrz
[Budowanie i praca z kodem](building.md)), otwórz **Ustawienia → Wygląd** i
wybierz swoją kartę. Kod świata, arkusz stylów i fonty wczytują się przy
pierwszym wyborze. Zapisane ustawienie jest sprawdzane z `WORLDS`, więc
niezarejestrowany identyfikator wraca do Katalogu, a świat, który wyrzuci
błąd przy renderowaniu, zostaje zastąpiony Katalogiem zamiast pustego okna.

## Pliki

| Plik | Co zawiera |
|---|---|
| `index.tsx` | Importuje `world.css` i fonty; eksportuje `Shell` i `Preview`. Nic więcej nie jest ze świata czytane |
| `Shell.tsx` | Całe okno: nawigacja, potem jeden widok naraz |
| `Preview.tsx` | Mała karta w wyborze motywu. Tylko dekoracja: `aria-hidden`, bez danych na żywo, bez interakcji |
| `world.css` | Tokeny dla obu trybów, potem wszystko, co ten świat rysuje |
| cokolwiek innego | Dziel komponenty, jak chcesz; `Home.tsx` w szablonie jest jednym z nich |

## Co dostaje powłoka

```ts
export interface ShellProps {
  app: AppState           // state/appState.ts
  settings: SettingsState // state/settings.ts
}
```

| `app.` | |
|---|---|
| `view`, `setView(view)` | Bieżący widok i sposób jego zmiany |
| `onboarding` | `os` (`'linux' \| 'macos' \| 'windows'`), `accessLevel` (`'full' \| 'selective'`), wybory z pierwszego uruchomienia |
| `installedSet` | Identyfikatory modułów włączonych w menedżerze |
| `moduleOrder`, `setFolderOrder(folder, ids)` | Kolejność modułów w każdym folderze ustawiona przez osobę |
| `linuxProfile` | Dystrybucja, rodzina, pulpit, menedżer pakietów — `null` poza Linuksem albo przed wykryciem |
| `touring`, `startTour()`, `endTour()` | Samouczek |

`settings.settings` przechowuje zapisane ustawienia (`refreshMs`, `theme`,
`uiScale`, pola wyglądu); `settings.set(key, value)` zmienia jedno z nich.

Każdy rodzaj `View` musi gdzieś prowadzić:

| `view.kind` | Renderuj |
|---|---|
| `dashboard` | Swój ekran główny |
| `folder` (`folderId`) | Moduły tego folderu |
| `module` (`moduleId`, opcjonalnie `param`) | Swoją ramę wokół `<ModuleBody app={app} mod={mod} />` |
| `settings` | `<Settings app={app} settings={settings} />` |
| `manager` | `<ModuleManager app={app} />` |
| `links` | `<Links />` |

a dopóki `app.touring` jest prawdą, renderuj
`<Tour app={app} onClose={app.endTour} />`.

## Wspólne elementy — używaj, nie buduj od nowa

- **`ModuleBody`** (`views/ModuleView.tsx`) to własny interfejs modułu.
  Motyw go oprawia i zmienia styl jego bloków; nigdy nie implementuje
  modułu od nowa.
- **`Settings`, `ModuleManager`, `Links`, `Tour`** też są wspólne.
- **`useMachine(refreshMs)`** (`state/machine.ts`) odpytuje odczyty na
  żywo: `cpu`, `ram`, `temp` (każdy to odczyt z `value` i opcjonalnym
  `detail` albo `undefined`, gdy maszyna nic nie podała), `disks`,
  `mainDisk`, `crowded` (inne prawie pełne woluminy), `record` (historia na
  rdzeń), `coreCount`, `error`. Nakładki kontenerów i pseudo-punkty
  montowania są już odfiltrowane.
- **`useReclaim(app)`** uruchamia sprawdzenie tylko do odczytu, ile da się
  odzyskać, na włączonych modułach czyszczących: `reclaim` (`idle`,
  `scanning`, `done`), `sources`, `check()`, `found`, `total`, `foundOf(id)`.
- **Formatowanie:** `gb`, `size`, `fill`, `usedPct`, `plural`, `UP_TO_ONE`,
  `systemName(app)`, `DISK_WARN_PCT`.
- **Katalog** (`data/modules.ts`): `folders`, `modulesInFolder`,
  `orderedModules`, `applyOrder`, `catalogNumbers`, `folderNumber`,
  `moduleById`, `riskLabel`; oraz `APP_PAGES`
  (`components/shell/Sidebar.tsx`) dla stron menedżera, ustawień i linków.

## Nazwy zmiennych (tokeny)

Wspólne bloki — interfejsy modułów, ustawienia, menedżer, karta samouczka,
okna dialogowe — są rysowane tymi zmiennymi CSS. Ustaw je, a te bloki pójdą
za Twoim motywem. **Każdy token, którego nie ustawisz, przyjmie wartość
Katalogu** z `styles/global.css`.

**Kolor** — ustaw w obu trybach:

| Token | Rola |
|---|---|
| `--bg`, `--bg-2`, `--bg-3` | Tło, panel, powierzchnia uniesiona albo pod kursorem |
| `--ink` | Tekst główny |
| `--muted`, `--dim` | Tekst drugo- i trzeciorzędny — oba wciąż 4,5:1 |
| `--accent`, `--on-accent` | Akcent i tekst na nim |
| `--border`, `--border-strong` | Linie |
| `--good`, `--warn`, `--critical`, `--on-critical` | Stany |
| `--panel-bg`, `--side-bg`, `--nav-active-bg`, `--panel-shadow` | Powierzchnie, które motyw może odróżnić od tła |
| `--g-teal-1`, `--g-blue-1`, `--g-green-1`, `--g-red-1`, `--g-violet-1` (i `-2`) | Kolory folderów: Dane i pliki, System, Bezpieczeństwo, Aplikacje, Własne |
| `color-scheme` | `dark` albo `light`, żeby natywne kontrolki pasowały |

**Typografia:**

| Token | Rola |
|---|---|
| `--sans`, `--mono` | Krój tekstu, krój liczb |
| `--lbl-size`, `--lbl-weight`, `--lbl-stretch`, `--lbl-tracking`, `--lbl-transform`, `--lbl-color` | Głos etykiet opisowych |
| `--btn-size`, `--btn-weight`, `--btn-tracking`, `--btn-transform` | Przyciski |
| `--title-size`, `--folder-size` | Tytuły, nazwy folderów |

**Kształt, rytm, wykresy:**

| Token | Rola |
|---|---|
| `--radius`, `--radius-sm`, `--radius-pill`, `--bar-rx` | Narożniki |
| `--hair`, `--rule` | Grubość linii |
| `--d` | Mnożnik gęstości — odstępy pisz jako `calc(16px * var(--d))` |
| `--chart-mean`, `--chart-peak`, `--chart-grid`, `--chart-w`, `--chart-grid-opacity`, `--chart-peak-dash`, `--chart-peak-opacity` | Wykres procesora |

### Które ustawienie rusza który token

Prowadź własne style przez te same tokeny, inaczej ustawienie osoby nic w
Twoim motywie nie zmieni.

| Ustawienie (Ustawienia → Wygląd) | Atrybut na korzeniu | Tokeny |
|---|---|---|
| Kolor akcentu | styl inline | `--accent`, `--on-accent` |
| Kontrast: wysoki | `data-contrast="high"` | `--muted`, `--dim` i linie zbliżają się do `--ink` |
| Krój tekstu, Krój liczb | `data-font`, `data-num-font` | `--sans`, `--mono` |
| Etykiety | `data-labels` | `--lbl-*` |
| Narożniki | `data-corners` | `--radius`, `--radius-sm`, `--radius-pill`, `--bar-rx` |
| Linie | `data-lines` | `--hair`, `--rule`, `--chart-w` |
| Gęstość | `data-density` | `--d` |
| Ruch | `data-motion="reduced"` albo `"off"` | — (patrz Ruch) |
| Siatka wykresu, Linia szczytu | `data-chart-grid`, `data-peak` | `--chart-grid-opacity`, `--chart-peak-dash` |

Inne atrybuty na `<html>`: `data-world` (Twój identyfikator), `data-theme`
(`light` albo `dark`), `data-fit`, `data-fit-h` i `data-wide` (niżej). `data-look` jest
ustawiany tylko w Katalogu.

## Zasady specyficzności

```css
/* struktura — (0,1,x) */
[data-world='mytheme'] { --sans: …; --radius: 8px; }
[data-world='mytheme'] .my-bar { … }

/* kolory — (0,2,0) */
[data-world='mytheme'][data-theme='dark']  { --bg: …; --ink: …; }
[data-world='mytheme'][data-theme='light'] { --bg: …; --ink: …; }
```

Ustawienia osoby (`styles/custom.css`, 0,2,0) wygrywają wtedy z Twoją
strukturą, wysoki kontrast (0,3,0) wygrywa z Twoimi kolorami, a wybrany
akcent jest ustawiany inline na korzeniu, ponad oboma. Poprzedzaj własne
klasy prefiksem (szablon używa `st-`), żeby nigdy nie spotkały klas innego
świata, i nigdy nie styluj niczego poza `[data-world='<Twój identyfikator>']`.

## Mniej miejsca: `data-fit`, nigdy `@media`

Okno ma co najmniej 1600 × 900, a skalowanie interfejsu (90–300 %) działa
przez `zoom`, którego zapytania media nie widzą: przy 150 % okno o
szerokości 1600 px zostawia około 1067 px, a `@media (max-width: …)` wciąż
mierzy 1600. Dlatego `state/settings.ts` wystawia na korzeniu miejsce
pozostałe po skalowaniu jako progi:

- `data-fit~='N'` dla N z listy 980, 1100, 1180, 1280, 1340, 1407, 1440, 1700
- `data-fit-h~='760'`

```css
[data-world='mytheme']:where([data-fit~='1280']) .my-home { grid-template-columns: 1fr 1fr; }
```

`:where()` zachowuje specyficzność reguły w środku. Potrzebujesz progu,
którego nie ma na liście? Dodaj go do `FIT_WIDTHS` albo `FIT_HEIGHTS` w
`settings.ts` — próg, który istnieje tylko w CSS, nigdy nie zadziała.

## Więcej miejsca: `data-wide`

W drugą stronę, dla dużych ekranów: `data-wide~='N'` dla N z listy 1900,
2400, 3200, dopóki po skalowaniu zostaje co najmniej N px. Automatyczne
skalowanie rośnie razem z oknem i zostawia około 1700 × 950: ekran 1440p
albo 4K pokazuje ten sam układ, tylko większy. Patrzy na oba wymiary okna,
więc ekran 21:9 albo 32:9 zachowuje wysokość, a jego dodatkowa szerokość
trafia do tych progów — tak samo jak mała skala wybrana ręcznie na dużym
ekranie. Progi są na to, co zmieści dodatkowa szerokość: więcej kolumn,
szerszy wykres, dwie połowy czegoś obok siebie. Strony wypełniają okno: daj
liście więcej kolumn zamiast sztywnego `max-width`, żeby nie było ani pustego
pasa, ani jednego wiersza przez 4000 px.

```css
[data-world='mytheme']:where([data-wide~='2400']) .my-home { grid-template-columns: repeat(4, 1fr); }
```

Nowe progi dopisujesz do `WIDE_WIDTHS` w `settings.ts`.

## Ruch

- CSS: przejścia i animacje tylko w
  `@media (prefers-reduced-motion: no-preference)` i wtedy, gdy korzeń nie
  ma atrybutu `data-motion` — albo daj im formę ograniczoną.
  `data-motion="off"` jest egzekwowane globalnie.
- JS: zapytaj `motionReduced()` (`state/looks.ts`), zanim płynnie
  przewiniesz albo coś zanimujesz.

## Samouczek

Samouczek prowadzi przez aplikację i wskazuje elementy po `data-tour`.
Umieść w swoich widokach:

| Widok | `data-tour` |
|---|---|
| dashboard | `cpu`, `machine`, `reclaim` (podświetlane są jego dzieci), `index`, `folder` (każdy wpis folderu w nawigacji), `tour` (przycisk, który go uruchamia) |
| folder | `folder-list` |
| module | `module-hero` oraz `module` — jego **drugie dziecko** musi być interfejsem modułu |

Ustawienia i menedżer mają własne cele. Krok, którego cel nie istnieje,
czeka 2,5 s, a potem pokazuje kartę bez podświetlenia.

## Minimum

Każdy motyw spełnia to w obu trybach:

- **Kontrast:** tekst główny, drugo- i trzeciorzędny 4,5:1 względem tła i
  panelu; duży tekst (24 px albo 18,66 px pogrubiony) 3:1; tekst przycisku
  4,5:1 względem jego wypełnienia.
- **Minimum 13 px** dla każdego tekstu. Etykiety Katalogu mają 12 px, więc
  ustaw `--lbl-size`, `--btn-size` i `--folder-size` na co najmniej 13 px i
  skopiuj z szablonu listę wspólnych bloków, które mają wpisane 12 px.
- **Widoczny fokus klawiatury** na wszystkim, co może go dostać. W wierszu,
  który przycina przepełnienie, rysuj obwódkę do środka
  (`outline-offset: -2px`).
- **Globalne skróty klawiszowe** ignorują klawisze wpisywane w pola
  (`input, select, textarea, [contenteditable]`), milczą, gdy
  `app.touring` jest prawdą albo otwarte jest `.modal-backdrop`, i są
  zdejmowane przy sprzątaniu efektu.
- **Tylko prawdziwe dane.** Pokazuj to, co zgłosiła maszyna; brakujący
  odczyt zostaje brakujący. Żadnych wymyślonych liczb, historii ani
  znalezisk — POSMA nie prowadzi historii operacji, więc motyw nie może jej
  pokazać.
- **Każdy widok i jego stan pusty, ładowania i nieznalezienia.**
- **Nic niszczącego poza modułem.** Ekran główny może uruchamiać
  sprawdzenia tylko do odczytu (`useReclaim`); usuwanie i zmienianie
  zostaje w `ModuleBody`, za potwierdzeniem samego modułu.

## Zanim otworzysz pull request

- `npm --prefix core run build` przechodzi (sprawdzenie typów i build
  produkcyjny).
- Motyw wygląda dobrze w trybie jasnym i ciemnym, przy skali interfejsu
  100 %, 130 % i 150 %, z wysokim kontrastem i ze zmienionym każdym
  ustawieniem.
- Samouczek przechodzi od początku do końca.
- Skan modułu działa w Twojej ramie — Czyszczenie Temp jest bezpieczne, bo
  skanowanie tylko czyta.

Potem postępuj według
[CONTRIBUTING.pl.md](https://github.com/KosmaBB/Posma/blob/master/CONTRIBUTING.pl.md),
ze zrzutami obu trybów w pull requeście. Wkład jest przyjmowany na
warunkach podwójnej licencji projektu.
