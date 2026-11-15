import { moduleById } from '../../data/modules'
import type { AppState, View } from '../../state/appState'

export interface TourStep {
  /** Where the step sits in the sleeve: side and chapter, shown on the card. */
  chapter: string
  view: View
  /** CSS selector; every match is framed together, so a step can hold a group of rows. */
  target: string
  title: string
  text: string
}

const at = (name: string) => `[data-tour="${name}"]`

/**
 * The module the module chapter opens: the temp cleaner when it is on,
 * otherwise the first installed module this system has. Null when nothing
 * is installed, and the chapter is left out rather than shown on an empty page.
 */
function sampleModule(app: AppState): string | null {
  const ids = app.onboarding?.installedModules ?? []
  if (ids.includes('temp-clean')) return 'temp-clean'
  return ids.find((id) => moduleById(id, app.linuxProfile)) ?? null
}

export function tourSteps(app: AppState): TourStep[] {
  const dashboard: View = { kind: 'dashboard' }
  // Some steps describe Katalog's own controls; every other world gets wording true for all of them.
  const katalog = (document.documentElement.dataset.world ?? 'katalog') === 'katalog'
  const moduleId = sampleModule(app)
  const moduleSteps: TourStep[] = moduleId
    ? [
        {
          chapter: 'Strona A · T03 Moduł',
          view: { kind: 'module', moduleId },
          target: at('module-hero'),
          title: 'Moduł',
          text: 'Nagłówek mówi, co moduł robi i jak bardzo jest ryzykowny: Bezpieczny, Ostrożnie albo Krytyczny. Im wyższe ryzyko, tym więcej pytań przed zmianą.',
        },
        {
          chapter: 'Strona A · T03 Moduł',
          view: { kind: 'module', moduleId },
          target: `${at('module')} > :nth-child(2)`,
          title: 'Skan, przegląd, potwierdzenie',
          text: 'Moduł najpierw tylko czyta. Dostajesz listę z rozmiarami, sam wybierasz pozycje, a nic nie znika, dopóki tego nie potwierdzisz.',
        },
      ]
    : []

  return [
    {
      chapter: 'Strona A · T01 Pulpit',
      view: dashboard,
      target: at('cpu'),
      title: 'Przyrząd procesora',
      text: katalog
        ? 'Linia to średnia całego procesora, przerywana — najbardziej zajęty rdzeń. Słupki to każdy rdzeń teraz. Kliknij słupek, a ten rdzeń zostanie na wykresie na stałe.'
        : 'Obciążenie procesora na żywo: średnia ze wszystkich rdzeni i najbardziej zajęty rdzeń. Odczyt odświeża się sam.',
    },
    {
      chapter: 'Strona A · T01 Pulpit',
      view: dashboard,
      target: at('machine'),
      title: 'Ta maszyna',
      text: katalog
        ? 'System, dyski, pamięć i temperatura w jednej tabeli. Wartość w kolorze ostrzeżenia to rzecz, którą warto się zająć — skrót do właściwego modułu stoi tuż pod nią.'
        : 'System, dyski, pamięć i temperatura. Wartość oznaczona jako ostrzeżenie to rzecz, którą warto się zająć.',
    },
    {
      chapter: 'Strona A · T01 Pulpit',
      view: dashboard,
      // The block shrinks inside its scrolling column; its children are the real extent.
      target: `${at('reclaim')} > *`,
      title: 'Ile da się odzyskać',
      text: 'Jeden przycisk pyta wszystkie włączone moduły, ile miejsca zwolnią. To tylko odczyt: usuwasz zawsze w module, po jego potwierdzeniu.',
    },
    {
      chapter: 'Strona A · T01 Pulpit',
      view: dashboard,
      target: at('index'),
      title: 'Indeks',
      text: katalog
        ? 'Główne akcje włączonych modułów w jednej liście, z numerem katalogowym i odczytem obok. Kolorowy pasek mówi, z którego folderu pochodzą.'
        : 'Główne akcje włączonych modułów zebrane w jednym miejscu. Każda prowadzi do swojego modułu.',
    },
    {
      chapter: 'Strona A · T02 Katalog',
      view: dashboard,
      target: at('folder'),
      title: 'Numery katalogowe',
      text: 'Setki to foldery: 100 dane i pliki, 200 system, 300 bezpieczeństwo, 400 aplikacje, 500 własne. Każdy moduł ma swój numer, a 900 to sama aplikacja.',
    },
    {
      chapter: 'Strona A · T02 Katalog',
      view: { kind: 'folder', folderId: 'data' },
      target: at('folder-list'),
      title: 'Folder',
      text: katalog
        ? 'Każdy wiersz to moduł: numer, opis, poziom ryzyka i jedna główna akcja. Kolejność zmieniasz, przeciągając wiersz, a pasek boczny ją przejmie.'
        : 'Moduły tego folderu: numer, opis, poziom ryzyka i jedna główna akcja.',
    },
    ...moduleSteps,
    {
      chapter: 'Strona A · T04 Bezpieczeństwo',
      view: { kind: 'folder', folderId: 'security' },
      target: at('folder-list'),
      title: 'Bezpieczeństwo',
      text: 'Higiena przeglądarek czyści cache, ciasteczka i historię. Vault to lokalna, szyfrowana baza haseł z audytem bezpieczeństwa.',
    },
    {
      chapter: 'Strona B · T05 Moduły',
      view: { kind: 'manager' },
      target: `${at('manager')} > section:first-of-type .cat-row:nth-child(-n+3)`,
      title: 'Zarządzanie modułami',
      text: katalog
        ? 'Włącz tylko to, czego potrzebujesz. Wyłączony moduł znika z paska bocznego i z indeksu, a jego numer w katalogu zostaje.'
        : 'Włącz tylko to, czego potrzebujesz. Wyłączony moduł znika z nawigacji i z pulpitu, a jego numer w katalogu zostaje.',
    },
    {
      chapter: 'Strona B · T06 Ustawienia',
      view: { kind: 'settings' },
      target: at('access'),
      title: 'Poziom dostępu',
      text: 'Pełny zbiera wszystkie zgody z góry i je zapamiętuje. Wybiórczy nadaje uprawnienia na jedno uruchomienie i pyta ponownie po restarcie.',
    },
    {
      chapter: 'Strona B · T06 Ustawienia',
      view: { kind: 'settings' },
      target: at('blacklist'),
      title: 'Czarna lista',
      text: 'Ścieżki, których żaden skaner nie wylistuje ani nie zaproponuje do usunięcia: dysk innego systemu, archiwum zdjęć, dokumenty klienta.',
    },
    {
      chapter: 'Strona B · T06 Ustawienia',
      view: { kind: 'settings' },
      target: at('look'),
      title: 'Wygląd',
      text: 'Sześć światów, każdy z własną nawigacją i pulpitem, jasny i ciemny; Katalog ma jeszcze pięć odmian. Niżej nadpiszesz akcent, kontrast, krój, etykiety, narożniki, gęstość, ruch i wykres — jeden przycisk wraca do ustawień świata.',
    },
    {
      chapter: 'Strona B · T07 Powrót',
      view: dashboard,
      target: at('tour'),
      title: 'Samouczek zostaje tutaj',
      text: 'Wrócisz do niego w każdej chwili pod 904. To koniec oprowadzenia.',
    },
  ]
}
