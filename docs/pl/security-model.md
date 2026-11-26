# Model bezpieczeństwa

*[English version →](../security-model.md)*

Ten dokument istnieje po to, żeby porównać go z kodem, a nie przyjąć na
wiarę. Opisuje, co może sięgnąć po uprawnienia administratora, co to
powstrzymuje i — równie ważne — co **nie** jest chronione.

## Wersja w jednym zdaniu

Nic poza małym, zamkniętym zbiorem sprawdzonych operacji nie może działać z
uprawnieniami administratora, a kod, który te uprawnienia trzyma, sam od
nowa ustala swoje warunki bezpieczeństwa, zamiast ufać czemukolwiek poniżej.

## Granice uprawnień

| Komponent | Działa jako | Czy sięga do roota? |
|---|---|---|
| Interfejs React | użytkownik, w webview | Nie |
| Rdzeń (`core/src-tauri`) | użytkownik | Tylko prosząc brokera |
| Moduły (`modules/*`) | użytkownik | **Nie** — nigdy, z założenia |
| Broker (`*-broker`) | root | To on *jest* komponentem uprzywilejowanym |

Moduł nie może podnieść uprawnień. Nie ma `sudo`, nie ma `pkexec`, nie ma
ścieżki setuid. Kiedy moduł trafia na brak uprawnień, uczciwie zgłasza
porażkę — tak ma być, to nie błąd. Uprzywilejowana połowa takiej funkcji to
osobna operacja brokera wywoływana przez rdzeń.

Tej zasady pilnowano pod realną presją: kiedy moduł czyszczenia plików
tymczasowych nie mógł przyciąć logów systemowych, dodanie wąskiego,
jednorazowego wywołania `pkexec` od razu by to naprawiło — i celowo tego
nie zrobiono.

## Zamknięty katalog operacji

Wszystko, co broker potrafi, to warianty jednego enuma w Rust
(`crates/broker-common/src/ops.rs`). **Nie ma** operacji, która przyjmuje
polecenie, skrypt albo dowolną ścieżkę do wykonania.

Skutki warte nazwania wprost:

- Przejęty albo wadliwy interfejs nie może poprosić brokera o coś nowego.
  Najgorsze, co może zrobić, to wywołać istniejącą, sprawdzoną operację ze
  złymi argumentami — a każda operacja sama je waliduje.
- Dodanie uprzywilejowanego uprawnienia to zmiana kodu w sprawdzanym pliku,
  nie zmiana konfiguracji.
- Nieznane operacje odrzuca deserializator, zanim ruszy jakakolwiek logika.

Sprawdzone zachowanie:

```
$ echo '{"op":"run_arbitrary_command","cmd":"rm -rf /"}' | linux-broker
{"ok":false,"error":"invalid request: unknown variant `run_arbitrary_command`, …"}
```

## Broker nie ufa warstwom poniżej

Każda operacja ponownie waliduje swoje dane i ponownie ustala swoje warunki
bezpieczeństwa w procesie roota, nawet jeśli strona bez uprawnień już je
sprawdziła. Najczytelniejszym przykładem jest usuwanie jądra:

- samo uruchamia `uname -r`, żeby znaleźć działające jądro, i odmawia jego
  usunięcia;
- samo czyta dowiązanie `/boot/vmlinuz`, żeby znaleźć najnowsze jądro, i
  odmawia jego usunięcia;
- **odmawia w ogóle, jeśli nie potrafi ustalić któregokolwiek z nich** —
  wartość, której nie da się odczytać, jest traktowana jako „niebezpieczna”,
  nigdy jako „w porządku”.

Ten ostatni punkt to zasada ogólna: **w razie niepewności odmawiaj.** Waży
więcej, niż się wydaje. Obie blokady jądra używały pierwotnie
`.unwrap_or_default()`, które zamienia porażkę w pusty napis, różny od
wszystkiego — po cichu wyłączając obie ochrony na każdym systemie, na którym
tych wartości nie dało się odczytać. Znaleziono to i poprawiono podczas
przeglądu; to dokładnie ten rodzaj błędu, któremu ta zasada ma zapobiegać.

## Co użytkownik mówi o swoim systemie

Przy pierwszym uruchomieniu użytkownik potwierdza albo poprawia to, co
POSMA wykryła — rodzinę pakietów, pulpit, program rozruchowy. Poprawka
trafia do modułów, w ich środowisku, i nigdy do brokera, którego rdzeń nie
uruchamia z tymi danymi i który decyduje wyłącznie na podstawie wykrycia.
Tam, gdzie obie strony mogłyby się różnić w istotny sposób — który menedżer
pakietów działa jako root — dzielą jedną zasadę
(`distro::manager_preferring`): rodzina zadeklarowana w `os-release`, z
zainstalowanym narzędziem, wygrywa z każdą odpowiedzią. Tylko na systemie,
który żadnej nie deklaruje, broker przyjmuje wybór z żądania, i to tylko
spośród menedżerów faktycznie zainstalowanych.

## Co może zawierać zapisywany plik

`/etc/default/grub` to nie są dane: `grub-mkconfig` uruchamia go jako
skrypt powłoki, jako root. Broker, który zapisywałby dowolny tekst z
żądania, byłby właśnie operacją „uruchom to jako root”, którą katalog ma
wykluczać — a w trybie demona bez hasła. Dlatego broker porównuje żądanie z
plikiem na dysku:

- linia, która już jest w pliku, przechodzi nietknięta — `GRUB_DISTRIBUTOR`
  Ubuntu, Debiana i Fedory to podstawienia poleceń i należą do roota;
- każda inna linia musi być pusta, być komentarzem albo przypisaniem
  klucza, który ustawia edytor (`GRUB_DEFAULT`, `GRUB_TIMEOUT`,
  `GRUB_TIMEOUT_STYLE`, `GRUB_DISABLE_OS_PROBER`, `GRUB_THEME`,
  `GRUB_TERMINAL_OUTPUT`), zwykłym tekstem: bez `$`, bez grawisów, nic po
  zamykającym cudzysłowie.

Linii poleceń jądra celowo nie ma na tej liście: `init=` w niej to powłoka
roota przy następnym rozruchu. Zmienia się ją ręcznie. Przywracanie kopii
zapasowej pomija to sprawdzenie, bo kopia to plik skopiowany przez roota, a
nie tekst z żądania.

Limine, systemd-boot i rEFInd czytają konfigurację same, więc nic w niej
nie jest uruchamiane — ale linia poleceń jądra w niej to ta sama powłoka
roota przy następnym rozruchu. Ich edytor nie wysyła więc pliku w ogóle:
`set_boot_options` niesie domyślny wpis i czas oczekiwania, a broker sam,
jako root, znajduje plik, zmienia te dwie linie i zostawia każdy inny bajt
w spokoju. Czas oczekiwania musi być liczbą sekund albo jednym ze słów
samego programu rozruchowego (Limine przy czymkolwiek innym startuje od
razu), a domyślny wpis musi być jedną linią tekstu.

Pakiety podlegają tej samej zasadzie. Deinstalator nie umieszcza na liście
jąder ani systemu bazowego, a `pkg_remove` odmawia ich ponownie w procesie
roota — jądro usunięte w ten sposób ominęłoby wszystkie blokady, których
pilnuje `remove_kernel`.

## Jak żądanie trafia do procesu uprzywilejowanego

Na Linuksie żądanie trafia do brokera przez stdin, więc nie parsuje go nic
poza brokerem. Dwa systemy wymagają więcej uwagi:

- **macOS.** Pytanie przy każdej akcji to `do shell script ... with
  administrator privileges`, które uruchamia powłokę roota i nie przekazuje
  stdin, więc żądanie jedzie w linii poleceń brokera. Trafia do literału
  napisu AppleScript — z ucieczką ukośników wstecznych i cudzysłowów, niczego
  więcej — a `quoted form of` zamienia go w jedno słowo powłoki. Żądanie z
  cudzysłowami, `$` czy grawisami dociera więc do brokera jako tekst, a test
  sprawdza, że literał oddaje dokładnie to, co do niego weszło.
- **Windows.** UAC pyta raz na uruchomienie. Rdzeń tworzy nazwany potok pod
  świeżą nazwą, odmawiając dołączenia do już istniejącego, uruchamia brokera
  przez UAC z tą nazwą i obsługuje potok tylko dla procesu, który uruchomił
  UAC — `GetNamedPipeClientProcessId` musi się z nim zgadzać. Broker nie
  otwiera niczego poza potokiem z prefiksem POSMA: nazwa to wszystko, co
  dostaje, a proces z podniesionymi uprawnieniami, któremu podano by ścieżkę
  pliku, zapisałby tam swoje odpowiedzi. Żądania idą potem po jednej linii,
  aż POSMA się zamknie.
- **PowerShell.** `powershell -Command` parsuje wszystko po nim jako jeden
  skrypt. Każdy skrypt jest stały, a wartość z żądania wstawiana jest raz, w
  apostrofach, po sprawdzeniu, które nie przepuszcza ani apostrofu, ani
  separatora.

Na Windowsie broker nigdy też nie bierze katalogu Windows z `%SystemRoot%`,
który konto proszące może ustawić sobie samo; pyta system. Usługi są
przełączane tylko z przejrzanej listy
(`broker-common/src/windows_services.rs`): żądanie podaje usługę i
włącz/wyłącz, broker odmawia każdej nazwy spoza listy, a „włącz” oznacza
typ uruchamiania, który Windows daje tej usłudze, nigdy typ z żądania.
SMART czyta `smartctl` z miejsca, gdzie kładzie go instalator smartmontools
w Program Files — znów z katalogu, który podaje system, nigdy z `PATH` — i
tylko dla dysków, które wymienia moduł zdrowia, od `/dev/sda` do `/dev/sdz`.

Homebrew nigdy nie jest uruchamiany jako root na macOS: jego prefiks należy
do użytkownika, więc proces roota uruchomiony z niego wykonywałby to, co
użytkownik tam włożył. Dlatego broker macOS nie ma operacji na pakietach i
dlatego SMART jest czytany bez niego.

## Zapis tego, co zrobiono

Każde żądanie, na które broker odpowiada, poza sondą `capabilities`, która
niczego nie zmienia, jest dopisywane do `/var/log/posma/broker.log`
(`%ProgramData%\POSMA\broker.log` na Windowsie) jako jedna linia JSON: czas,
konto, które prosiło — zweryfikowany właściciel demona albo użytkownik
zgłoszony przez pkexec — żądanie bez zawartości plików i to, czy się udało.
Log ma własny katalog, bo `clean_system_paths` może usuwać zwykłe pliki w
`/var/log`.

Nieudany zapis do logu trafia na standardowe wyjście błędów brokera i nie
zatrzymuje operacji. Odmowa sprzątania z powodu pełnego dysku przekreślałaby
sens sprzątania.

## Zmiany niszczące są odwracalne

Zapisy konfiguracji systemu przechodzą przez jeden wspólny ciąg
(`guards::write_with_backup`), nigdy przez bezpośredni zapis:

```
kopia + rotacja → zapis atomowy → weryfikacja → przy porażce: przywrócenie + ponowna weryfikacja
```

Jeśli weryfikacja się nie powiedzie (na Linuksie `update-grub` odrzuca nową
konfigurację), poprzednia zawartość jest przywracana i ponownie
weryfikowana od znanego dobrego stanu, zanim zostanie zgłoszony pierwotny
błąd. Zła edycja nie może zostawić systemu z konfiguracją, która się nie
odtworzy.

Liczbę przechowywanych kopii można ustawić; domyślnie są to dwie najnowsze.

## Wspólne zabezpieczenia i dlaczego każde istnieje

Leżą w `crates/broker-common/src/guards.rs`, żeby zasada była w jednym
miejscu, a nie w kopii na moduł, która może się rozjechać:

| Zabezpieczenie | Zapobiega |
|---|---|
| `is_safe_package_id` | Nazwie zaczynającej się od `-`, odczytanej przez apt/snap/winget/brew jako *flaga*. Argumenty nie są interpretowane przez powłokę, więc ryzykiem nie jest wstrzyknięcie, tylko przemycenie flagi. |
| `contained_in` | Wskazaniu jako celu samego korzenia z białej listy. `Path::starts_with` jest prawdziwe także dla tej samej ścieżki, więc bez połowy `!=` żądanie wskazujące `~/Downloads` przechodzi test „wewnątrz dozwolonego obszaru” i zabiera całe drzewo. |
| `is_same_file` / `copy_dir_recursive` | Obcięciu pliku przy kopiowaniu na samego siebie. `fs::copy` otwiera cel do zapisu (obcinając go), *zanim* przeczyta źródło; jeśli to ten sam plik, zawartość zostaje zniszczona i nie ma już czego skopiować z powrotem. |
| `write_atomic` | Częściowemu zapisowi, który po przerwaniu zostawia obcięty oryginał. |
| `backup_and_rotate` / `write_with_backup` | Nieodwracalnym zmianom konfiguracji. |

Dwa z nich powstały w odpowiedzi na błędy, które faktycznie się wydarzyły,
a nie na hipotezy. Zabezpieczenie przed kopiowaniem na siebie istnieje, bo
instalacja motywu, której źródło i cel wskazywały ten sam katalog, wyzerowała
około 80 prawdziwych plików na działającej maszynie.

## Bramkowanie uprawnień

Uprawnienia to zamknięta lista (`fs-user`, `fs-system`, `fs-scan`, `pkg`,
`svc`, `autostart-user`, `autostart-system`, `boot`, `disk-smart`,
`restore-point`, `fda`, `secrets`, `net`), zdefiniowana raz w
[`access/catalog.json`](https://github.com/KosmaBB/Posma/blob/master/access/catalog.json). Rdzeń w Rust osadza ten
plik przy kompilacji, a interfejs importuje ten sam, więc to, co egzekwuje
uprawnienia, i to, co Ci je opisuje, nie mogą się różnić. Kiedyś były to
osobne, ręcznie utrzymywane kopie — i zdążyły się rozjechać.

Katalog zapisuje też, o które uprawnienia może prosić każdy moduł i do
którego modułu należy każda operacja uprzywilejowana. Każda komenda
uprzywilejowana wywołuje `PermissionRegistry::require_operation(...)`, które
odmawia, o ile nie są spełnione **oba** warunki:

1. katalog mówi, że moduł operacji deklaruje potrzebne jej uprawnienie;
2. użytkownik to uprawnienie przyznał.

Pierwszy warunek sprawia, że przyznane uprawnienie nie jest wytrychem.
Przyznanie `boot` pozwala edytorowi GRUB zapisać konfigurację rozruchu; nie
pozwala na to modułowi, który `boot` nigdy nie zadeklarował. Operacja,
której katalog nie opisuje, jest od razu odrzucana, a nie przepuszczana.

Każdy moduł ma też własny `module.json`, bo moduł musi być samodzielny —
moduł od kogoś innego przychodzi z manifestem, a katalog nic o nim nie wie.
`cargo test -p core` porównuje każdy manifest na dysku z katalogiem, więc
oba zapisy nie mogą się rozjechać.

**Poziomy dostępu** decydują, jak długo trwa zgoda. Przy pełnym dostępie
zgoda została udzielona hurtowo podczas pierwszego uruchomienia, z całą
listą na widoku, więc zgody są zapisywane i przetrwają restart. Przy
dostępie wybiórczym wszystko, co wymaga podniesienia uprawnień, jest
przyznawane tylko na bieżące uruchomienie i następnym razem pada pytanie od
nowa. Zmiana z pełnego na wybiórczy od razu cofa zgody sesyjne. Poziom jest
zapisany we własnym pliku stanu rdzenia, a nie tylko w interfejsie, bo to,
jak długo trwa zgoda uprzywilejowana, nie jest decyzją, którą zostawia się
tam, gdzie użytkownik może ją zmienić konsolą przeglądarki.

## Co *nie* jest chronione

Konkret jest tu bardziej użyteczny niż uspokajanie:

- **Ty, potwierdzając akcję niszczącą.** POSMA najpierw pokazuje podgląd i
  pyta, ale jeśli potwierdzisz usunięcie plików albo pakietu, zrobi to. Miej
  kopie zapasowe.
- **Moduły instalowane samodzielnie, spoza oficjalnej dystrybucji.** Nie
  mają uprawnień jak każdy moduł, ale w obrębie Twojego konta mogą zrobić
  wszystko, co Twoje konto. Nikt ich nie sprawdzał.
- **Przejęte konto użytkownika.** Granica POSMA to użytkownik kontra root.
  Nie broni przed czymś, co już działa jako Ty. Przy zainstalowanym demonie
  obejmuje to wywoływanie brokera tak, jak mógłbyś Ty — każdej operacji z
  katalogu, bez pytania, ale niczego spoza katalogu i niczego, czego
  odmawiają jego sprawdzenia.
- **Demon zainstalowany przez niewłaściwego użytkownika.** Dostęp dostaje
  identyfikator użytkownika zapisany przy instalacji. Instalacja w imieniu
  innego konta daje dostęp temu kontu.
- **Sesja na Windowsie po udzieleniu zgody.** Po pierwszej zgodzie UAC w
  danym uruchomieniu każda operacja z katalogu przechodzi bez kolejnego
  pytania, aż POSMA się zamknie — ta sama wymiana, którą robi demon na
  Linuksie, tylko na jedno uruchomienie. Cokolwiek przejmie w tym czasie
  proces POSMA, może z tego skorzystać; nic spoza katalogu i nic, czego
  odmawiają jego sprawdzenia. Zainstalowanego pomocnika dla Windows nie ma.
- **Brokery macOS i Windows w ogóle.** Są napisane, ale nigdy nie działały
  na prawdziwym sprzęcie. Traktuj je jako niesprawdzone, dopóki to się nie
  zmieni.

## Zasady sprawdzania modułów

Dla modułów rozprowadzanych oficjalnymi kanałami (planowane w 1.0):

- żadnych zewnętrznych skryptów — moduł nie pobiera, nie generuje ani nie
  wykonuje kodu z innego miejsca;
- żadnego pobierania zewnętrznych plików, skryptów ani kodu w trakcie
  działania;
- przegląd przed publikacją i przy każdej aktualizacji, łącznie z
  zadeklarowanymi uprawnieniami;
- uprawnienia nie wychodzą poza katalog — moduł nie może wymyślić akcji
  uprzywilejowanej, może tylko poprosić o istniejącą, sprawdzoną operację.

To zobowiązanie do staranności, nie gwarancja. Przegląd może coś przeoczyć.
Prawo do pomyłki jest wprost zastrzeżone, a odpowiedzialność za Twoje dane,
potwierdzone przez Ciebie akcje i wszelkie moduły firm trzecich, które
instalujesz, pozostaje Twoja — patrz
[README](https://github.com/KosmaBB/Posma/blob/master/README.pl.md#bezpieczeństwo-modułów)
i wyłączenie gwarancji w [licencji](https://github.com/KosmaBB/Posma/blob/master/LICENSE.md).

## Zgłaszanie problemu bezpieczeństwa

Napisz na **kosma.brzezawski@gmail.com**, podając tyle szczegółów, żeby dało
się to odtworzyć. Nie otwieraj publicznego zgłoszenia o czymś, co da się
wykorzystać, dopóki nie zostanie naprawione.
