# Budowanie i praca z kodem

*[English version →](../building.md)*

## Wymagania

- [Narzędzia Rust](https://rustup.rs) (stable)
- Node.js 20+
- [Zależności systemowe Tauri](https://tauri.app/start/prerequisites/) dla
  Twojego systemu. Na Linuksie nazwy pakietów różnią się między rodzinami:

  ```bash
  # Debian, Ubuntu, Mint, Pop!_OS, Zorin, elementary, Kali, MX
  sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev \
      librsvg2-dev build-essential curl wget file libssl-dev libxdo-dev

  # Arch, CachyOS, Manjaro, EndeavourOS, Garuda
  sudo pacman -S --needed webkit2gtk-4.1 base-devel curl wget file openssl \
      appmenu-gtk-module libappindicator-gtk3 librsvg xdotool

  # Fedora, Nobara
  sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file \
      libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++ make

  # RHEL 10, AlmaLinux 10, Rocky 10: to samo, po włączeniu EPEL,
  # bo tam leży WebKitGTK
  sudo dnf install epel-release && sudo dnf config-manager --set-enabled crb

  # openSUSE — po zdolności, bo pakiet zmienił nazwę
  # (webkit2gtk3-devel, teraz webkitgtk3-devel)
  sudo zypper install 'pkgconfig(webkit2gtk-4.1)' libopenssl-devel curl wget file \
      libappindicator3-1 librsvg-devel gcc gcc-c++ make
  ```

  RHEL 9 i jego przebudowy w ogóle nie zbudują aplikacji: pakują tylko
  starszy WebKitGTK 4.0, a Tauri potrzebuje 4.1.

  Te listy są sprawdzone, nie zapamiętane: `scripts/distro-check.sh --build`
  instaluje dokładnie je w kontenerze każdej rodziny i kompiluje tam
  workspace. Wynik dla każdej dystrybucji jest w
  [Dystrybucjach Linuksa](distributions.md).

## Pierwsze budowanie

```bash
npm --prefix core install
npm --prefix core run tauri dev
```

`tauri dev` sam synchronizuje sidecary przed startem, więc moduł zmieniony
bez ponownej synchronizacji nie może już trafić do działającej aplikacji —
taka niezgodność raz wyłożyła monitor zdrowia, bo interfejs oczekiwał pola,
którego nieaktualna binarka nie wysyłała. Synchronizacja, która nic nie
zmienia, kosztuje około półtorej sekundy.

Żeby zsynchronizować bez uruchamiania czegokolwiek:

```bash
node scripts/sync-sidecars.mjs
```

To skrypt Node, nie powłoki, więc działa tak samo na Windowsie, gdzie
`bash` w skrypcie zwykle prowadzi do WSL i zbudowałby moduły linuksowe.

**Po co jest synchronizacja.** `sync-sidecars.mjs` buduje moduły
przeznaczone dla tego systemu i kopiuje każdą binarkę do
`core/src-tauri/binaries/posma-<moduł>-<target-triple>` — takiego nazewnictwa
wymaga mechanizm sidecarów w Tauri. Prefiks `posma-` jest dlatego, że
pakiet linuksowy instaluje sidecary w `/usr/bin`, gdzie gołe `vault`
zderzyłoby się z HashiCorp Vault. Te binarki celowo nie są commitowane,
więc na świeżym klonie jeszcze nie istnieją i Tauri odmawia budowania:

```
resource path `binaries/posma-system-info-x86_64-unknown-linux-gnu` doesn't exist
```

Ten komunikat wygląda jak uszkodzone repozytorium, ale nim nie jest — to
oczekiwany stan przed pierwszą synchronizacją. Sam
`cargo build --workspace` tego nie naprawi.

Uruchom `sync-sidecars.mjs` ponownie po zmianie dowolnego modułu: aplikacja
używa skopiowanych binarek, więc zmiany nie są widoczne, dopóki nie
zostaną zsynchronizowane.

## Struktura

```
core/
  src/            interfejs React
  src-tauri/      backend w Rust, tauri.conf.json, capabilities/
crates/
  broker-common/  wspólny katalog operacji uprzywilejowanych, zabezpieczenia, dyspozytor
  distro/         jaki to Linux — menedżer pakietów, jądra, układ GRUB
modules/
  <funkcja>/      po jednym crate na moduł
  *-broker/       brokery uprzywilejowane per system
scripts/
  sync-sidecars.mjs
  distro-check.sh
```

## Częste zadania

```bash
cargo build --workspace          # cały Rust (po pierwszej synchronizacji sidecarów)
cargo build -p temp-clean        # jeden moduł
cargo test --workspace           # testy jednostkowe
cargo test -p vault -- --ignored # testy wymagające prawdziwego magazynu poświadczeń

npm --prefix core run build      # tsc + build produkcyjny vite
cd core && npx tsc --noEmit      # samo sprawdzenie typów
```

## Rozmowa z modułem bezpośrednio

Moduły to zwykłe procesy mówiące JSON-em w jednej linii, więc łatwo je
sprawdzać bez interfejsu:

```bash
echo '{"cmd":"scan"}' | ./target/debug/temp-clean | python3 -m json.tool
echo '{"op":"capabilities"}' | ./target/debug/linux-broker
```

To główny sposób testowania logiki modułów. `{"op":"capabilities"}`
wysłane do dowolnego brokera zgłasza, które operacje dana platforma
faktycznie implementuje.

## Dodawanie nowego sidecara — kolejność

Dodanie binarki do `externalBin`, **zanim** ona istnieje, psuje budowanie
Tauri i kładzie razem z nim `tauri dev`. Właściwa kolejność:

1. napisz crate
2. `node scripts/sync-sidecars.mjs`
3. dodaj `"binaries/posma-<nazwa>"` do `externalBin` w `tauri.<platforma>.conf.json`
4. uruchom ponownie `tauri dev`

## Testy wymagające sesji pulpitu

Sejf przechowuje klucz szyfrujący w systemowym magazynie poświadczeń
(Secret Service, Pęk kluczy, Menedżer poświadczeń). Test, który sprawdza tę
ścieżkę od początku do końca, jest oznaczony `#[ignore]`, bo maszyna bez
środowiska graficznego — łącznie z CI — nie ma magazynu, z którym mogłaby
rozmawiać, a test, który nie może się uruchomić, powinien to powiedzieć,
a nie się wyłożyć.

Uruchom go w zwykłej sesji pulpitu:

```bash
cargo test -p vault -- --ignored
```

Używa jednorazowej nazwy usługi, nigdy produkcyjnej, i usuwa po sobie wpis.
Logikę kodowania i sprawdzania długości wokół niego pokrywają zwykłe
testy, które działają wszędzie.

## Budowanie na inny system

POSMA powstaje na Linuksie i jest testowana na maszynie z docelowym
systemem. Paczki Tauri nie da się skompilować skrośnie — bundler macOS i
linker Apple działają tylko na macOS — więc build na inny system robi się
*na* tym systemie, z tych samych źródeł.

**Przeniesienie wersji na Maca** to więc `git pull`, a nie przesyłanie
plików:

```bash
git pull
npm --prefix core ci
node scripts/sync-sidecars.mjs
npm --prefix core run tauri dev
```

`sync-sidecars.mjs` buduje tylko moduły, których `module.json` wymienia
system, na którym działa, więc build macOS nie zawiera edytora GRUB, a
linuksowy — modułu Time Machine. Których sidecarów paczka oczekuje, mówi
`tauri.<platforma>.conf.json`, który zastępuje listę bazową, a nie do niej
dopisuje.

Build wydaniowy (`sync-sidecars.mjs release`, `tauri build`) używa
`[profile.release]` z workspace'u: optymalizacja całego programu i usunięte
symbole zmniejszają każdą binarkę o mniej więcej jedną trzecią. Ceną jest
wolniejsze budowanie i panika, której backtrace nie podaje nazw funkcji —
takie odtwarzaj na buildzie debug.

### Inna dystrybucja Linuksa

Źródła budują się w każdej obsługiwanej rodzinie z jej własnymi pakietami
— patrz [Wymagania](#wymagania). *Binarka* jest mniej przenośna niż
źródła: zbudowana na Ubuntu 24.04 potrzebuje glibc 2.39 i nie uruchomi się
na Debianie 12, Ubuntu 22.04 ani RHEL 9. Build wędruje na nowsze systemy,
nigdy na starsze, więc wszystko, co ma być rozdawane, buduje się na
najstarszym systemie, który ma być obsługiwany. Szczegóły są w
[Dystrybucjach Linuksa](distributions.md).

### Obie architektury Maca

Zwykła synchronizacja buduje tylko na architekturę maszyny, której szuka
`tauri dev`, i jest dużo szybsza. Jedna paczka, która działa i na Intelu, i
na Apple silicon, wymaga zbudowania każdego sidecara dwa razy i
połączenia:

```bash
rustup target add x86_64-apple-darwin aarch64-apple-darwin
node scripts/sync-sidecars.mjs release --universal
npm --prefix core run tauri build -- --target universal-apple-darwin
```

`--universal` buduje każdy moduł na oba cele, zostawia kopie dla każdej
architektury, żeby `tauri dev` dalej działało na obu maszynach, i łączy je
przez `lipo` w `posma-<moduł>-universal-apple-darwin`. Brakujący cel Rust
jest zgłaszany przed pierwszym budowaniem, a nie jako błąd linkera po kilku
minutach.

### Sprawdzanie innych systemów bez wychodzenia z tego

Rust na obcy cel da się lokalnie sprawdzić pod kątem typów, co łapie błędy
przenośności, które inaczej czekałyby, aż kod trafi na drugą maszynę:

```bash
rustup target add aarch64-apple-darwin
cargo check --target aarch64-apple-darwin -p macos-broker
```

Tak znalazł się prawdziwy błąd: `broker-common` osłaniał odczyt poświadczeń
drugiej strony gniazda przez `#[cfg(unix)]`, co na macOS jest prawdą, a
ciało używało linuksowego `SO_PEERCRED`. Każdy broker zależy od tego
crate'a, więc broker macOS w ogóle nie skompilowałby się na Macu.

Warto znać granicę: to sprawdza nasz Rust, nie crate'y kompilujące C.
`vault` nie przechodzi tego sprawdzenia, bo `libsqlite3-sys` buduje
dołączony SQLite i potrzebuje narzędzi C dla macOS. To ograniczenie
kompilacji skrośnej, nie błąd przenośności — na prawdziwym Macu się buduje.

To samo działa dla Windows z `rustup target add x86_64-pc-windows-msvc`;
brokery Linux i macOS to w gruncie rzeczy demon na gnieździe Unix i nigdy
nie są dla niego budowane. `cargo check --target x86_64-pc-windows-msvc -p core`
też działa, gdy `core/src-tauri/binaries/` zawiera plik dla każdego
sidecara Windows — wystarczy pusty, build sprawdza tylko, czy istnieje.
Czego nie złapie sprawdzenie typów, łapie CI: buduje i testuje każdy moduł
na Apple silicon, na Intelu i na Windowsie — na Windowsie także sesję
uprzywilejowanego brokera, od początku do końca. Tag wersji buduje
instalatory, opisane niżej.

## Instalatory

Wypchnięcie tagu `v*` uruchamia `.github/workflows/release.yml`, który
buduje instalatory i umieszcza je w wydaniu **roboczym** — nic nie jest
publiczne, dopóki wersja robocza nie zostanie opublikowana ręcznie.
Uruchomiony z zakładki Actions buduje te same pliki jako artefakty
workflow i niczego nie wydaje.

| System | Pliki | Budowane na |
|---|---|---|
| Linux | `.deb` (rodzina apt), `.rpm` (dnf, zypper) | Ubuntu 22.04, najstarsza obsługiwana glibc |
| macOS | jeden uniwersalny `.dmg` dla Apple silicon i Intela | macOS 15 |
| Windows | `.exe` (NSIS) | `windows-latest` na GitHubie |

Lokalnie, na systemie, dla którego jest instalator:

```bash
npm --prefix core ci
npm --prefix core run tauri build      # Linux: target/release/bundle/{deb,rpm}
                                       # Windows: target/release/bundle/nsis
```

Dla Maca — build uniwersalny z sekcji
[Obie architektury Maca](#obie-architektury-maca).

**Bez AppImage.** AppImage działa z montowania FUSE, które może czytać
tylko użytkownik, który je uruchomił — nawet root dostaje odmowę — więc
`pkexec` nigdy nie uruchomiłby z niego brokera i każda operacja
uprzywilejowana by się nie udała. Pakiety instalują brokera w `/usr/bin`,
z rootem jako właścicielem.

Pakietu dla pacmana jeszcze nie ma: na Archu i pochodnych POSMA buduje się
ze źródeł jak wyżej.

**Aplikacja na Maca jest podpisana doraźnie, nie przez dewelopera.** Bez
konta dewelopera Apple nie ma tożsamości, którą można by podpisać; podpis
doraźny (`signingIdentity: "-"` w `tauri.macos.conf.json`) przynajmniej
powstrzymuje Gatekeepera przed nazywaniem pobranej kopii uszkodzoną.
Pierwsze uruchomienie i tak zostanie odrzucone jako od niezidentyfikowanego
dewelopera: Ustawienia systemowe → Prywatność i ochrona → *Otwórz mimo
to*, jeden raz.

**Instalator Windows instaluje dla wszystkich użytkowników, w Program
Files** (`installMode: perMachine` w `tauri.windows.conf.json`), więc raz
prosi o administratora. Instalacja dla jednego użytkownika umieściłaby
brokera — binarkę, którą UAC uruchamia jako administrator — w folderze, do
którego mogą pisać programy samego użytkownika, gdzie cokolwiek mogłoby go
podmienić i poczekać na następną zgodę. Instalator też nie jest podpisany,
więc SmartScreen ostrzega przy pierwszym uruchomieniu: *Więcej informacji*
→ *Uruchom mimo to*.

Mówi po polsku na polskim systemie, a na każdym innym po angielsku; strony
NSIS tłumaczy sam NSIS, a komunikaty Tauri są w `src-tauri/nsis/Polish.nsh`.
WebView2 pobiera tylko na rzadkim Windowsie, który go nie ma. Odinstalowanie
proponuje usunięcie ustawień aplikacji; sejf (`%APPDATA%\posma`) nigdy do
nich nie należy — magazyn haseł znika tylko wtedy, gdy usunie go właściciel.

## Zasady testowania

Testuj ścieżki odmowy na prawdziwych binarkach: zniekształcone żądania,
ścieżki spoza białych list, nazwy, które mogłyby zostać odczytane jako
flagi.

**Nie uruchamiaj niszczących ścieżek sukcesu na własnej maszynie.**
Usuwanie pakietu, przycinanie logów, zapis konfiguracji rozruchu —
weryfikuj je, czytając kod i testując odmowy, albo użyj jednorazowej
maszyny wirtualnej. To zasada projektu, nie sugestia; zignorowanie jej
już raz kosztowało prawdziwe dane.

Dla operacji na pakietach i jądrach jednorazowa maszyna istnieje:
`scripts/distro-check.sh` uruchamia kontener każdej obsługiwanej
dystrybucji i przechodzi tam ścieżki sukcesu — usunięty pakiet, sprzątnięte
osierocone pakiety, opróżniona pamięć podręczna, wyjęte stare jądro — na
prawdziwym menedżerze pakietów tej dystrybucji. Uruchom go po zmianie
czegokolwiek, co któryś z nich wywołuje:

```bash
rustup target add x86_64-unknown-linux-musl   # raz
bash scripts/distro-check.sh --kernels --grub
```

Czego nie sięga, wymieniają [Dystrybucje Linuksa](distributions.md):
prawdziwy rozruch przez odbudowane menu GRUB wciąż wymaga maszyny
wirtualnej.

## Uwagi o środowisku

Niektóre edytory (zwłaszcza VS Code zainstalowany jako snap na Linuksie)
wstrzykują procesom potomnym terminala zmienne GTK/GDK i locale, przez które
skompilowana binarka Tauri pada z błędem wyszukiwania symbolu `libpthread`.
Jeśli uruchomienie zbudowanej aplikacji z wbudowanego terminala kończy się w
ten sposób, uruchom ją z czystego środowiska (`env -i`, zostawiając tylko
`HOME`, `USER`, `LANG`, `DISPLAY`, `XDG_RUNTIME_DIR`,
`DBUS_SESSION_BUS_ADDRESS` i jawny `PATH`) albo ze zwykłego terminala poza
edytorem.

Poza tym build z profilem dev respektuje `devUrl` z `tauri.conf.json`, więc
uruchomienie skompilowanej binarki bezpośrednio, bez serwera deweloperskiego
Vite, pokazuje „Could not connect to localhost”. Używaj
`npm --prefix core run tauri dev`.

**„Could not create GBM EGL display: EGL_NOT_INITIALIZED. Aborting...”**
to renderer DMA-BUF WebKitGTK, który nie może dosięgnąć GPU, i kładzie on
cały proces. Zdarzyło się to na maszynie, na której powstaje ten projekt:
aktualizacja sterownika NVIDIA zainstalowała nowe biblioteki, podczas gdy
stary moduł jądra był wciąż załadowany, a `nvidia-smi` zgłaszało
niezgodność wersji aż do restartu. Ta sama awaria jest częsta przy NVIDIA w
ogóle i w maszynach wirtualnych.

Aplikacja ustawia teraz sama sobie `WEBKIT_DISABLE_DMABUF_RENDERER=1` na
Linuksie, zanim cokolwiek wystartuje, co wybiera ścieżkę renderowania,
która zawsze działa. Jawna wartość jest respektowana —
`WEBKIT_DISABLE_DMABUF_RENDERER=0` włącza renderer DMA-BUF z powrotem. Jeśli
aktualizacja sterownika czeka na restart, i tak warto go zrobić: dotyczy to
też innych programów korzystających z GPU.
