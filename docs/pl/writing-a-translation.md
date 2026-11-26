# Pisanie tłumaczenia

*[English version →](../writing-a-translation.md)*

POSMA trzyma teksty interfejsu w jednym pliku JSON na każdy język, w
`core/src/i18n/`. `pl.json` to oryginał i ma wszystkie klucze. `en.json` też
jest kompletny i to jego tekst POSMA pokazuje wszędzie tam, gdzie inny język
jeszcze go nie ma. Nowy język to jeden plik więcej w tym folderze: bez kodu,
bez rejestrowania.

> **Dziś i w 1.0.** Tłumaczenie jest wkompilowane w aplikację: plik w
> `core/src/i18n/` trafia do najbliższej wersji. Cały interfejs czyta te
> pliki, liczby też (1,5 GB po polsku, 1.5 GB po angielsku). Bez zmian
> zostają dwie rzeczy: nazwy światów i odmian (Katalog, Gęsto, Strumień…),
> bo to nazwy, oraz komunikaty, które moduły piszą same (błędy skanowania),
> nadal po polsku. Instalowanie tłumaczeń społeczności z poziomu aplikacji
> jest planowane razem z hubem społeczności.

## Zacznij od wzoru

```sh
cp templates/translation/template.json core/src/i18n/de.json
```

Nazwa pliku to kod języka: `de.json`, `fr.json`, `es.json`, `pt-BR.json` dla
odmiany regionalnej. Wzór ma wszystkie klucze z angielskim tekstem, więc
aplikacja działa, gdy tylko plik się pojawi. Tłumacz wartości po kolei; to,
do czego jeszcze nie doszedłeś, dalej czyta się po angielsku.

Język wybierasz w **Ustawienia → Język**. System, który już jest w tym
języku, dostaje go sam przy pierwszym uruchomieniu.

## Format

```json
{
  "language.name": "Deutsch",
  "nav.dashboard": "Übersicht",
  "settings.system": "System: {name}",
  "settings.refresh.every": { "one": "Jede Sekunde", "other": "Alle {n} Sekunden" }
}
```

- **Klucz, po lewej, zostaje bez zmian.** Twój jest tylko tekst po prawej.
  Klucze są pogrupowane według tego, do czego należą: `nav.*` nawigacja,
  `folder.*` foldery modułów, `risk.*` znaczniki ryzyka, `module.<id>.name`,
  `.desc` i `.action` poszczególne moduły, `settings.*` strona Ustawień.
- **`language.name`** to nazwa twojego języka w twoim języku. Tę nazwę
  pokazuje wybór języka.
- **`{name}`, `{n}` i podobne wypełnia POSMA**: nazwą systemu, liczbą,
  ścieżką. Zachowaj każde, zapisane dokładnie jak w angielskim, i przenieś
  tam, gdzie wymaga tego gramatyka.
- **Liczebniki mają formy.** Tam, gdzie po angielsku zamiast tekstu jest
  obiekt, podaj po jednym wpisie na każdą formę liczby mnogiej w twoim
  języku. Formy to
  [kategorie CLDR](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html):
  angielski i niemiecki mają `one` i `other`; polski, czeski i rosyjski także
  `few` i `many`; arabski wszystkie sześć (`zero`, `one`, `two`, `few`,
  `many`, `other`); japoński i chiński tylko `other` albo zwykły tekst.
  `other` jest zawsze wymagane. `{n}` to sama liczba.
- **Brakująca linia pokazuje tekst angielski.** Tak zostawia się coś na
  później. Pusty `""` nigdy nie jest dobry: sprawdzanie go odrzuca.

## Styl

- Zwracaj się do człowieka tak jak reszta aplikacji: wprost, krótko, w
  drugiej osobie, bez wykrzykników.
- Nazwy programów i produktów zostają bez zmian: POSMA, Vault, Winget, GRUB,
  systemd, S.M.A.R.T., Time Machine, apt, pacman, flatpak.
- Znaczniki ryzyka to ostrzeżenia i siedzą w małej plakietce: *Bezpieczny*,
  *Ostrożnie* i *Krytyczny* muszą zostać krótkie.
- Nazwy modułów pojawiają się na wąskich listach i kafelkach. Celuj w
  długość zbliżoną do angielskiej.
- Tłumacz z angielskiego. Gdy nie wiesz, co zdanie znaczy, oryginałem jest
  plik polski.

## Sprawdź

```sh
node scripts/check-translations.mjs core/src/i18n/de.json
```

Zgłasza plik, który nie jest poprawnym JSON-em, klucz, którego POSMA nie ma
(literówka albo usunięty klucz), brakujące lub nadmiarowe `{pole}`, formy
liczby mnogiej, które nie istnieją albo nie mają `other`, i pusty tekst.
Wypisuje też klucze, które nie są jeszcze przetłumaczone. CI uruchamia to
sprawdzanie dla każdego pliku w `core/src/i18n/`.

Żeby zobaczyć efekt w aplikacji, uruchom ją tak, jak opisuje
[Budowanie i praca z kodem](building.md), i wybierz swój język w
Ustawieniach.

## Wyślij

Otwórz pull request z tym jednym plikiem. Nic więcej nie trzeba zmieniać.
Jeśli tekst przeczytała druga osoba znająca język, napisz to w opisie.

## Aktualizowanie

Nowe wersje dodają klucze. Uruchom sprawdzanie: klucze, których jeszcze nie
przetłumaczyłeś, pojawią się na jego liście i dopóki ich nie dodasz, POSMA
pokazuje je po angielsku. Usunięty klucz zostanie zgłoszony jako taki,
którego POSMA nie ma; usuń tę linię.

## Dla programistów: dodawanie tekstu

- Tekst interfejsu nigdy nie trafia do kodu. Dodaj klucz do `pl.json` i
  `en.json`, a potem pokaż go przez `t()`:

  ```ts
  import { t } from '../i18n'

  t('settings.access')                     // zwykły tekst
  t('settings.system', { name: p.name })   // z polem do wypełnienia
  t('settings.refresh.every', { n: 5 })    // formy liczby mnogiej, wybierane przez n
  ```

- Tabela poza komponentem, taka jak `riskLabel`, odczytuje język w chwili
  utworzenia, chyba że każdy wpis jest getterem:
  `get low() { return t('risk.low') }`.
- Liczby formatuj przez `formatNumber(n, opcje)` z tego samego modułu, nigdy
  ze stałym locale w rodzaju `'pl-PL'`, żeby separator dziesiętny szedł za
  językiem.
- Klucze nazywaj `obszar.rzecz`, z wariantem jako trzecią częścią
  (`module.pkg-cache.name.family`), małymi literami.
- Po zmianie `en.json` odbuduj wzór:
  `node scripts/check-translations.mjs --write-template`. CI nie przechodzi,
  dopóki wzór jest nieaktualny.
