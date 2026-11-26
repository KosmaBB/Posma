# Architektura

*[English version →](../architecture.md)*

POSMA to trzy warstwy o celowo różnych poziomach uprawnień, rozmawiające
jednym protokołem.

```
┌──────────────────────────────────────────────┐
│ Interfejs     React, w webview Tauri         │  bez dostępu do systemu
└───────────────────┬──────────────────────────┘
                    │ komendy Tauri (invoke)
┌───────────────────┴──────────────────────────┐
│ Rdzeń         Rust, core/src-tauri           │  działa jako użytkownik
│               routing, rejestr uprawnień     │
└──────┬─────────────────────────┬─────────────┘
       │ JSON w jednej linii     │ JSON w jednej linii
┌──────┴──────────────┐   ┌──────┴─────────────┐
│ Moduły              │   │ Broker             │  działa jako root
│ modules/*           │   │ modules/*-broker   │
│ jako użytkownik     │   │ zamknięty katalog  │
└─────────────────────┘   └────────────────────┘
```

## Rdzeń (`core/`)

Aplikacja Tauri: backend w Rust w `core/src-tauri`, interfejs w React w
`core/src`.

Rdzeń nie ma własnego kodu uprzywilejowanego. Jego zadania to przekazywanie
żądań interfejsu do właściwego modułu, prowadzenie rejestru uprawnień
(`permissions.rs` — które uprawnienia użytkownik przyznał, zapisane w
`permissions.json` w katalogu danych aplikacji) i bycie jedyną rzeczą, która
rozmawia z brokerem.

Interfejs nigdy nie sięga do modułu ani brokera bezpośrednio — wszystko
przechodzi przez komendę Tauri i tam odbywa się sprawdzanie uprawnień
(`PermissionRegistry::require`).

Wygląd interfejsu to *świat* (`core/src/worlds/`): powłoka, ekran główny i
arkusz stylów wczytywane, gdy świat zostanie wybrany. Światy dzielą
interfejsy modułów, ustawienia i każde wywołanie backendu, więc motyw
zmienia to, jak aplikacja wygląda i się porusza, nigdy to, co wolno jej
zrobić — patrz [Pisanie motywu](writing-a-theme.md).

## Moduły (`modules/`)

Jeden crate na funkcję. Każdy buduje się do samodzielnego pliku
wykonywalnego, który `scripts/sync-sidecars.mjs` kopiuje do paczki
aplikacji, a Tauri uruchamia go jako *sidecar*.

**Moduły nie mają uprawnień.** Działają jako użytkownik, bez żadnego
podnoszenia uprawnień. Moduł, który potrzebuje czegoś uprzywilejowanego,
tego nie dostaje — zwraca uczciwy błąd, a uprzywilejowana połowa funkcji to
osobna operacja brokera, którą wywołuje rdzeń.

Protokół jest celowo minimalny: **jedna linia JSON na stdin, jedna linia
JSON na stdout, potem koniec.**

```json
{"cmd":"scan"}
{"ok":true,"data":{"total_bytes":423336032}}
```

Nowy proces na każde żądanie zamiast długo działającego demona, bo tak dużo
trudniej o błąd: nie ma wspólnego stanu, który mógłby przeciekać między
wywołaniami, nie ma procesu, który zostaje w tle, a moduł, który się
wyłoży, niczego ze sobą nie pociągnie.

**Jeden wyjątek:** `modules/vault` działa długo, bo trzyma w pamięci
wyprowadzony klucz szyfrujący, a wyprowadzanie go od nowa (Argon2id) albo
pytanie o hasło główne przy każdej akcji byłoby i wolne, i gorsze dla
użytkownika. Jest uruchamiany i zatrzymywany jawnie i jako jedyny moduł ma
taki kształt.

## Brokery (`modules/{linux,macos,windows}-broker`)

Jedyne komponenty działające jako root i z założenia najmniejsze —
argument bezpieczeństwa trzyma się tylko wtedy, gdy ten kod jest na tyle
mały, że da się go naprawdę przeczytać.

Wszystkie trzy korzystają z `crates/broker-common`, w którym są:

- **zamknięty katalog operacji** (`ops.rs`) — enum w Rust z każdą
  dozwoloną operacją uprzywilejowaną na wszystkich systemach. Nie ma w nim
  wariantu „wykonaj dowolne polecenie”. Nieznaną operację odrzuca
  deserializator, zanim dotrze ona do jakiejkolwiek logiki.
- **trait `Broker`** (`broker.rs`) — jedna metoda na operację, każda
  domyślnie uczciwie odpowiada „nieobsługiwane na tym systemie”. Nowy
  broker dla systemu kompiluje się i poprawnie odpowiada na każdą operację,
  zanim choć jedna zostanie zaimplementowana; każda dochodzi przez
  nadpisanie jednej metody.
- **wspólne zabezpieczenia** (`guards.rs`) — zawieranie ścieżek, walidacja
  nazw pakietów, wykrywanie tego samego pliku, rotacja kopii zapasowych,
  zapisy atomowe. Każde z nich istnieje, bo bez niego coś poszło źle (patrz
  [Model bezpieczeństwa](security-model.md)).
- **dyspozytor i transporty** (`serve.rs`) — jedna obsługa żądań używana
  przez każdy tryb działania, więc żaden transport nie może się rozjechać w
  tym, co faktycznie robi.

Każdy broker implementuje tylko to, co na swoim systemie naprawdę potrafi,
a resztę zgłasza jako nieobsługiwaną. `capabilities` samo jest operacją,
więc brokera można zapytać, co implementuje, zamiast odkrywać to po
porażkach.

### Pozostałe wspólne crate'y

Trzy kolejne crate'y istnieją z tego samego powodu: zasada, która żyje w
jednym module, nie jest zasadą.

- **`scan-filter`** — co skaner dysku może pokazać. Trzy moduły przechodzą
  system plików w poszukiwaniu rzeczy do usunięcia; plik ukryty przez jeden
  i zaproponowany przez drugi czyniłby wykluczenie bezsensownym. Oddziela
  rzeczy *zablokowane* (wolumen innego systemu, działający system, lista
  użytkownika) od *szumu* (gry, drzewa zależności), bo mapa dysku musi
  liczyć to drugie i nie ukrywać żadnego z nich.
- **`sysmetrics`** — odczyty, które maszyna oddaje bez uprawnień:
  temperatury z hwmon, karty graficzne z sysfs albo `nvidia-smi`. Dodanie
  źródła to jedna funkcja zwracająca listę; pulpit i monitor zdrowia
  podchwytują ją bez edycji. Wszystko, co wymaga roota, zostaje poza nim —
  od tego jest broker, i dlatego nie ma tu S.M.A.R.T.
- **`distro`** — jaki to Linux: natywny menedżer pakietów, jak pakowane są
  jądra, gdzie GRUB trzyma pliki i czy system jest oparty na obrazie i nie
  należy go ruszać. Moduły bez uprawnień używają go, żeby pokazać listę, a
  broker pyta go ponownie, jako root, zanim na niej zadziała — więc obie
  strony nie mogą się różnić w tym, czym jest maszyna. Patrz
  [Dystrybucje Linuksa](distributions.md).

### Trzy drogi do brokera

| Tryb | Jak | Koszt |
|---|---|---|
| Jednorazowo | Rdzeń uruchamia binarkę brokera przez systemowe okno podnoszenia uprawnień (`pkexec` na Linuksie, prośba o hasło administratora na macOS) przy każdej akcji | Bez instalacji, pytanie za każdym razem |
| Sesja (Windows) | Rdzeń uruchamia brokera przez UAC przy pierwszej akcji uprzywilejowanej i trzyma go połączonego potokiem, który obsługuje tylko ten proces | Bez instalacji, jedno pytanie na uruchomienie |
| Demon (Linux, macOS) | Zainstalowany pomocnik trzyma gniazdo Unix; rdzeń się z nim łączy | Jedna instalacja, potem bez pytań |

Kontrolą dostępu demona jest **zweryfikowany identyfikator użytkownika**
łączącego się procesu (`SO_PEERCRED`), sprawdzany, zanim zostanie
przeczytany choćby bajt żądania — nie uprawnienia pliku gniazda. Jeśli
demon nie potrafi ustalić swojego właściciela, odmawia startu.

Sesja na Windowsie odwraca pytanie demona: podniesiony broker jest klientem
potoku, nie jego serwerem, więc nikt nie może do niego zapukać. Rdzeń
tworzy potok i przyjmuje tylko proces uruchomiony przez UAC
(`GetNamedPipeClientProcessId`). Zainstalowany pomocnik dla Windows —
serwer, do którego mógłby zapukać każdy proces — nie jest napisany, bo
sprawdzenie, kto puka, trzeba przetestować na maszynie, zanim trafi do
wydania.

## Dlaczego taki kształt

Alternatywa — jedna binarka działająca z podniesionymi uprawnieniami, z
funkcjami jako wewnętrznymi modułami — byłaby mniejsza i prostsza do
zbudowania. Została odrzucona, bo uniemożliwia dwie obietnice projektu:

1. **Możliwość sprawdzenia.** Jeśli wszystko działa z podniesionymi
   uprawnieniami, „przeczytaj kod uprzywilejowany” znaczy przeczytaj całą
   aplikację. Tutaj znaczy: przeczytaj jeden mały crate i jeden plik na
   system.
2. **Prawdziwe usuwanie.** Jeśli funkcje są wkompilowane, odinstalowanie
   jednej może zawsze tylko ją ukryć. Osobne pliki wykonywalne znaczą, że
   usunięcie może skasować plik.

Kosztem jest uruchomienie procesu przy każdej akcji i protokół do
utrzymania. Dla narzędzia do konserwacji, które działa po kliknięciu, to
niewiele.
