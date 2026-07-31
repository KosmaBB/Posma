# POSMA

**P**ersonal **O**perating **S**ystem **M**aintenance **A**pp

*[English version of this document →](README.md)* · *[Dokumentacja →](docs/)*

Aplikacja do konserwacji systemu na Windows, macOS i Linux, której całe
źródło jest jawne — łącznie z każdą linijką, która sięga do systemu z
uprawnieniami administratora. Zbudowana na Tauri (rdzeń w Rust, interfejs w
React).

Założenie jest proste: utrzymanie komputera w formie powinno być *wygodne*, a
Ty powinieneś móc *sprawdzić*, co narzędzie, które to robi, faktycznie robi.
Większość programów do konserwacji każe wybrać jedno albo drugie.

> **Status: w budowie.** Linux jest kompletny względem zaplanowanego katalogu
> modułów; macOS i Windows mają przygotowane szkielety, ale nie są jeszcze
> zweryfikowane na prawdziwym sprzęcie. Instalatory powstaną później — na
> razie jest to repozytorium źródeł.
>
> Celowo brak zrzutów ekranu: interfejs wciąż się kształtuje, a pokazanie
> wersji, która nie będzie odpowiadać temu, co trafi do wydania, byłoby
> gorsze niż niepokazanie niczego. Pojawią się, gdy UI będzie reprezentatywne.

---

## Po co jest POSMA

**Jedna aplikacja, każdy popularny system.** Ten sam interfejs i te same
przyzwyczajenia na Windowsie, macOS-ie i Linuksie, zamiast innego narzędzia i
innego sposobu myślenia na każdej maszynie. Tam, gdzie jakiejś funkcji
naprawdę nie da się zrobić na danym systemie, POSMA mówi to wprost, zamiast
udawać.

**Żadnego bloatware'u — to Ty decydujesz, co zawiera.** POSMA to niewielki
rdzeń plus katalog modułów, a każdy moduł jest osobnym programem, który rdzeń
uruchamia dopiero wtedy, gdy z niego korzystasz — nie flagą w konfiguracji,
nie wyszarzoną pozycją w menu.

Cel, któremu ta architektura służy:

- Nie potrzebujesz menedżera haseł? Nie instaluj go. Wtedy go nie ma — nie
  jest ukryty, nie jest wyłączony, po prostu *nie istnieje*.
- Zmieniłeś zdanie? Instalujesz w kilka sekund, w dowolnym momencie.
- Usunięcie modułu unicestwia **każdy jego bit** — programu, a jeśli chcesz,
  także jego ustawienia i dane. Żadnych pozostałości, żadnych uśpionych
  usług, nic nie zostaje po cichu.

Nikt nie powinien być zmuszany do instalowania funkcji, których nie chce. To
ograniczenie projektowe, nie preferencja — dlatego moduły są osobnymi
programami, a nie kodem wkompilowanym w jedną binarkę.

> **Stan przed 1.0:** rozdzielenie jest prawdziwe — każdy moduł to
> osobny plik wykonywalny, a uprzywilejowane operacje, o które może prosić,
> są zadeklarowane per moduł. Natomiast sam przepływ *instalacji i usuwania*
> w aplikacji nie jest jeszcze skończony: menedżer modułów na razie zapisuje
> Twój wybór i ukrywa to, co wyłączyłeś, zamiast dodawać i kasować pliki na
> dysku. Prawdziwa instalacja i usuwanie z dysku pojawią się w wersji
> **1.0**, ponieważ wymagają serwerów, z których pliki modułów będą
> pobierane — patrz [Plany](#plany).

## Moduły

| Folder | Moduły |
|---|---|
| **Dane i pliki** | czyszczenie temp · duże pliki · duplikaty (treść + wersje) · niszczarka · usuwanie metadanych · cache pakietów |
| **System** | mapa dysku · menedżer autostartu · monitor zdrowia (CPU/RAM/S.M.A.R.T.) · zarządzanie wersjami jądra · wizualny edytor GRUB |
| **Bezpieczeństwo** | higiena przeglądarek · szyfrowany menedżer haseł (Argon2id + AES-256-GCM) |
| **Aplikacje** | uninstaller z wykrywaniem pozostałości (apt / snap / flatpak) |

## Dlaczego uprzywilejowaną część da się zweryfikować

Jawność źródła ma sens tylko wtedy, gdy kod krytyczny dla bezpieczeństwa jest
na tyle mały i łatwy w odczycie, że realnie da się go przejrzeć. Dlatego:

- **Moduły nigdy nie mają uprawnień.** Działają jako Ty. Kiedy któryś
  potrzebuje czegoś uprzywilejowanego, prosi rdzeń, a rdzeń prosi **brokera**.
- **Broker ma zamknięty katalog operacji** — nigdzie nie ma wywołania „wykonaj
  to polecenie jako root". Nowe możliwości dodaje się jako przejrzane
  operacje, nie przez rozszerzanie istniejących.
- **Broker sam waliduje każde żądanie**, nie ufając temu, co sprawdziła już
  strona nieuprzywilejowana, i **odmawia**, gdy nie potrafi ustalić, czy coś
  jest bezpieczne. Przy usuwaniu jądra proces roota samodzielnie ustala,
  które jądro jest uruchomione i które najnowsze, odmawia dla obu, a jeśli
  nie potrafi tego ustalić — odmawia w ogóle.
- **Zmiany destrukcyjne są odwracalne:** modyfikacje konfiguracji systemowej
  przechodzą przez kopię zapasową → rotację → zapis atomowy → weryfikację →
  automatyczne cofnięcie, jeśli weryfikacja się nie powiedzie.
- **Sposób podnoszenia uprawnień wybierasz Ty:** pytanie przy każdej akcji
  albo zainstalowany pomocnik działający bez pytań, gdzie dostęp przyznawany
  jest na podstawie zweryfikowanego identyfikatora użytkownika, a nie
  uprawnień pliku.

Pełny projekt: [`Access_plan.md`](Access_plan.md). Wspólna implementacja:
[`crates/broker-common`](crates/broker-common).

## Plany

Każdy moduł i każda funkcja są testowane na żywym systemie, z którego korzystam
codziennie. Nie tworzymy maszyn wirtualnych, które mogłyby różnić się budową od
realnej instalacji — chcemy pełnej zgodności z systemami operacyjnymi w takiej
postaci, w jakiej ludzie faktycznie z nich korzystają. Zapewniamy, że każda
funkcja jest w pełni przetestowana przed wypuszczeniem.

To też wyznacza kolejność poniżej: każdy system jest kończony na sprzęcie, na
którym da się go realnie testować, zanim zacznie się następny.

### Stan obecny — Linux ✅

Wszystkie moduły zaplanowane dla Linuksa są zbudowane i działają na
prawdziwych danych systemowych: czyszczenie temp, duże pliki, duplikaty,
niszczarka, metadane, cache pakietów, przycinanie logów systemd, mapa dysku,
autostart, monitor zdrowia, menedżer jądra, edytor GRUB, higiena
przeglądarek, sejf, uninstaller. Broker z zamkniętym katalogiem operacji jest
tutaj kompletny, w obu trybach — pytania przy akcji i zainstalowanego
pomocnika.

### Następny — macOS

Drugi system, który da się testować na żywo, więc idzie jako kolejny.

- Weryfikacja przygotowanego brokera macOS na prawdziwym sprzęcie —
  Homebrew, `launchctl`, przycinanie logów, migawki Time Machine i SMART są
  napisane, ale nigdy nie uruchomione na Macu.
- Moduły wyłącznie dla macOS: czyszczenie DerivedData Xcode, odchudzanie
  cache Mail i Messages, lokalne migawki Time Machine.
- Prowadzony kreator Full Disk Access — macOS celowo pozwala nadać to
  wyłącznie ręcznie w Ustawieniach systemowych, więc POSMA może otworzyć
  właściwy panel i potwierdzić wynik, ale nigdy nie nada tego po cichu.

### Potem — Windows

Budowany przy najmniejszym dostępie do sprzętu, więc celowo najostrożniej.

- Pomocnik na named pipe z prawidłowym uwierzytelnianiem dzwoniącego. Po
  stronie Unixa używamy zweryfikowanego identyfikatora użytkownika;
  windowsowy odpowiednik to dokładnie ten rodzaj kodu krytycznego dla
  bezpieczeństwa, którego nie powinno się pisać na ślepo — dlatego celowo
  wciąż go nie ma, zamiast być zgadniętym.
- Moduły wyłącznie dla Windows: czyszczenie WinSxS/DISM, profile usług,
  usuwanie bloatware, interfejs dla winget.
- Automatyczny punkt przywracania przed każdą operacją krytyczną.

### 1.0 — dystrybucja modułów

Prawdziwa instalacja i usuwanie potrzebują miejsca, *z którego* moduły są
pobierane, więc jedno i drugie pojawia się razem w wydaniu 1.0:

- **Serwery dystrybucyjne**, do których POSMA wysyła prośbę o pliki modułów.
- **Prawdziwa instalacja i usuwanie modułów** — menedżer zaczyna faktycznie
  dodawać i kasować pliki na dysku, z wyborem między usunięciem samego
  modułu a modułu razem z jego ustawieniami i danymi. To zamienia opisaną
  wyżej modułowość z architektury w funkcję.
- **Weryfikacja modułów** dla wszystkiego, co jest serwowane — patrz
  [Bezpieczeństwo modułów](#bezpieczeństwo-modułów).

### Długoterminowo

- **Moduły, wtyczki i tłumaczenia społeczności** — miejsce, w którym inni
  mogą rozbudowywać POSMA, przy tym samym standardzie weryfikacji dla
  wszystkiego, co idzie oficjalnym kanałem.
- Polski i angielski są językami bazowymi; celem jest, żeby tłumaczenia
  społeczności były pełnoprawne, a nie doklejone.

### Po 1.0 — Master Control (wersja firmowa, koncepcja)

W każdym biurze jest ktoś, kto utrzymuje komputery przy życiu, a stan tej
pracy jest kiepski: przygotowanie stanowiska dla nowego pracownika to zwykle
Clonezilla i pół godziny patrzenia na pasek postępu, a cokolwiek bardziej
złożonego to linijki basha albo nieporęczne narzędzie sprzed dekady do jednej rzeczy.
Intune i Jamf istnieją, ale ceną i skalą celują w organizacje znacznie
większe niż te, które faktycznie mają ten problem.

Master Control to plan, żeby to rozwiązać: jedna konsola, działająca na
dowolnej maszynie w sieci z uruchomionym POSMA — konserwacja całej floty,
przygotowywanie stanowisk, rejestr haseł do kont firmowych oraz harmonogramy
i polityki konkretnych akcji.

To właśnie tutaj licencja komercyjna zaczyna zarabiać na siebie i to jest
naturalne miejsce na płatny wariant.

**Nie jest zaczęte i celowo jest ostatnie.** Zamiana POSMA w coś, co
przyjmuje polecenia przez sieć, odwraca cały model zagrożeń projektu — dziś
żaden komponent nie nasłuchuje na gnieździe innym niż lokalne, a przejęta
konsola oznaczałaby przejętą flotę. Trzy ograniczenia są ustalone już teraz,
zanim cokolwiek zostanie zaprojektowane:

1. **Domyślnie wyłączone, zawsze.** Instalacja POSMA nigdy nie czyni maszyny
   sterowalną zdalnie. Dołączenie do floty to świadoma, jawna czynność po
   obu stronach.
2. **Zamknięty katalog operacji nadal obowiązuje** — Master Control nigdy nie
   dostanie furtki „wykonaj to polecenie". Zdalne sterowanie, które potrafi
   wywołać wyłącznie przejrzane operacje, to zupełnie inne (i dużo mniejsze)
   ryzyko niż zdalna powłoka — i to jest właśnie sedno.
3. **Lokalna weryfikacja identyfikatora użytkownika nie rozciąga się na
   sieć.** Dostęp zdalny wymaga własnego, wzajemnie uwierzytelnionego
   dołączania, a każda uprzywilejowana akcja wykonana zdalnie trafia do
   dziennika audytu.

Wspólny firmowy rejestr haseł to również inny problem niż obecny lokalny
sejf — sekrety współdzielone, dostęp per osoba, odbieranie uprawnień i audyt
to nie są rzeczy, które dokleja się do projektu jednoosobowego.

### Prace wspólne, niezależne od systemu

- **Interfejs uprawnień** — widok Ustawienia → Dostępy z listą każdego
  uprawnienia, tym co go potrzebuje, jego stanem i akcją naprawy; plus
  onboarding podpięty do realnej instalacji pomocnika zamiast zapisywania
  preferencji.
- **Moduły własne** — instalacja modułu napisanego przez Ciebie lub kogoś
  innego, z ekranem zgody pokazującym dokładnie, o jakie uprzywilejowane
  możliwości prosi.
- **Instalatory** — `.exe`, `.deb`/`.rpm`/AppImage i `.dmg`, żeby korzystanie
  z POSMA nie wymagało środowiska programistycznego.
- **Personalizacja pulpitu** jako osobny moduł (GNOME, KDE Plasma), z tym
  samym podejściem „jedno kliknięcie", które edytor GRUB stosuje do motywów
  rozruchu.
- **Egzekwowanie manifestu** — rdzeń nie sprawdza jeszcze w momencie
  wywołania, czy moduł proszący o operację uprzywilejowaną faktycznie
  zadeklarował potrzebne uprawnienie; dziś weryfikowane jest tylko to, że
  użytkownik je nadał. Patrz [docs/security-model.md](docs/security-model.md).
- Drobniejsze: obsługa `pacman`/`dnf`, czyszczenie nieużywanych środowisk
  flatpak, trwałe zapisywanie ustawień, samouczek po pierwszym uruchomieniu.

## Struktura

```
core/            Aplikacja Tauri — backend w Rust (src-tauri) + interfejs React (src)
crates/
  broker-common/ Wspólny katalog operacji uprzywilejowanych, zabezpieczenia, dyspozytor
modules/         Po jednym crate na moduł, plus brokery per system
scripts/         sync-sidecars.sh — buduje moduły i wgrywa je do aplikacji
```
## Budowanie ze źródeł

Użytkownik końcowy dostanie instalator; ta sekcja jest dla programistów i dla
tych, którzy wolą sami zbudować to, co zaudytowali.

Wymagane: [Rust](https://rustup.rs), Node.js 20+ oraz
[zależności systemowe Tauri](https://tauri.app/start/prerequisites/) dla
Twojego systemu.

```bash
npm --prefix core install
bash scripts/sync-sidecars.sh   # zbuduj moduły i skopiuj je do aplikacji
npm --prefix core run tauri dev
```

**Uruchom `sync-sidecars.sh` przed pierwszym budowaniem.** Skompilowane
binarki modułów celowo nie są commitowane, a aplikacja je dołącza, więc
świeży klon nie zbuduje się, dopóki nie powstaną. Pominięcie tego kroku daje
błąd, który wygląda jak uszkodzone repozytorium:

```
resource path `binaries/system-info-x86_64-unknown-linux-gnu` doesn't exist
```

To oczekiwany stan przed pierwszą synchronizacją, a nie zepsuty klon — samo
`cargo build --workspace` tego nie rozwiąże.

Skrypt trzeba uruchomić ponownie także po każdej zmianie w module: aplikacja
korzysta ze skopiowanych binarek, więc zmiany nie są widoczne, dopóki nie
zostaną zsynchronizowane.

## Bezpieczeństwo modułów

Moduły to jedyne miejsce, w którym POSMA mogłaby realnie zostać obrócona
przeciwko osobie, która ją uruchomiła, więc wszystko dystrybuowane
oficjalnym kanałem (patrz [1.0 — dystrybucja modułów](#10--dystrybucja-modułów))
podlega stałemu standardowi:

- **Zero zewnętrznych skryptów.** Moduł nie pobiera, nie generuje i nie
  wykonuje kodu skądkolwiek indziej. To, co jest dostarczone, jest tym, co
  się uruchamia.
- **Żadnego pobierania zewnętrznych plików, skryptów ani kodu w trakcie
  działania.** Moduł, który potrzebuje danych, przynosi je ze sobą albo pyta
  o nie system — nie sięga na zewnątrz po treści wykonywalne.
- **Każdy moduł jest sprawdzany, zanim trafi na serwer**, łącznie z
  zadeklarowanymi uprawnieniami, i sprawdzany ponownie przy każdej
  aktualizacji.
- **Uprawnienia nie wychodzą poza katalog.** Moduł nie może wymyślić nowej
  uprzywilejowanej akcji — może wyłącznie prosić o operacje, które już
  istnieją w zamkniętym katalogu brokera, a ten sam jest przejrzanym kodem.

**To zobowiązanie do staranności, nie gwarancja nieomylności.** Weryfikacja
może czegoś nie wychwycić i prawo do pomyłki jest tu wyraźnie zastrzeżone. W
szczególności:

> **Odpowiadasz za swoje dane i za to, co decydujesz się uruchomić.** Rób
> kopie zapasowe. POSMA wykonuje operacje destrukcyjne na Twoje polecenie —
> kasuje pliki, usuwa pakiety, edytuje konfigurację rozruchu — i choć jest
> zbudowana tak, by najpierw pokazać podgląd i zawodzić bezpiecznie, skutki
> potwierdzenia akcji są Twoje.
>
> **Moduły zewnętrzne i instalowane samodzielnie są wyłącznie na Twoje
> ryzyko.** Cokolwiek zainstalujesz spoza oficjalnej dystrybucji, nie zostało
> sprawdzone przez autora, może zrobić wszystko, na co pozwoli mu system, i
> nie wiąże się z żadną gwarancją.

To uzupełnia — i w niczym nie zawęża — wyłączenie odpowiedzialności zawarte w
[licencji](LICENSE.md).

## Autor i własność

POSMA jest tworzona, posiadana i rozwijana przez **Kosmę (KosmaBB)**,
jedynego autora i jedynego właściciela praw autorskich.

Wszelkie prawa do projektu, jego nazwy i jego źródła są zastrzeżone przez
autora. Wkład społeczności jest mile widziany na warunkach opisanych w sekcji
[Współpraca](#współpraca), a licencje komercyjne ustalane są bezpośrednio z
autorem — patrz [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

## Strona

Planowany adres: **posma.com** / **posma.pl**

Żadna z domen nie działa jeszcze — `.com` to spory wydatek, a `.pl` jest
obecnie zarejestrowana na kogoś innego, więc ich pozyskanie jest w toku. Do
tego czasu to repozytorium jest jedynym oficjalnym źródłem POSMA. Każdą inną
stronę dystrybuującą coś pod nazwą POSMA należy traktować jako niepowiązaną.

Na stronie znajdą się pliki do pobrania, katalog modułów własnych,
dokumentacja i odnośnik z powrotem tutaj.

## Licencja

Źródło POSMA jest publikowane w całości i objęte podwójną licencją, na
modelu spopularyzowanym przez WinRAR:

- **Bezpłatnie** dla osób prywatnych, nauki, edukacji, organizacji
  charytatywnych i instytucji publicznych — na warunkach
  [PolyForm Noncommercial 1.0.0](LICENSE.md).
- **Odpłatnie** dla firm i zastosowań komercyjnych — patrz
  [COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md).

**Darmowe licencje komercyjne przyznawane są uznaniowo przez autora.** Firmy
oraz podmioty publiczne i państwowe mogą uzyskać bezpłatny dostęp do wersji
płatnej po wcześniejszym uzgodnieniu tego z autorem — na testy, dla szkół i
podobnych instytucji, albo po prostu tam, gdzie to ma sens. To przyznanie
uprawnienia, a nie roszczenie: najpierw pytanie, a obowiązuje od momentu
uzgodnienia.

Żeby być precyzyjnym: to licencja **source-available**, a nie „open source" w
rozumieniu [OSI](https://opensource.org/osd), ponieważ tamta definicja
zabrania ograniczania użytku komercyjnego. Wszystko jest czytelne,
audytowalne i modyfikowalne; od firm oczekuje się po prostu opłaty za użytek
komercyjny.

## Współpraca

Zgłoszenia i pull requesty są mile widziane — pełny przewodnik w
[CONTRIBUTING.md](CONTRIBUTING.md), a zgłaszanie podatności prywatnie opisuje
[SECURITY.md](SECURITY.md). Dwie zasady, obie nienegocjowalne ze względu na
to, co ten program robi:

1. **Żadnych nowych uprzywilejowanych zachowań poza katalogiem brokera** —
   żadnego `sudo`, `pkexec` ani wywołań jako root wewnątrz modułu, choćby
   wyglądały na maksymalnie wąskie.
2. **Wszystko, co destrukcyjne, dostaje najpierw podgląd, a walidację po
   stronie uprzywilejowanej**, niezależnie od tego, co sprawdził już
   interfejs.

Przesyłając wkład, zgadzasz się, że jest on objęty tymi samymi warunkami
podwójnej licencji co projekt.
