# Pisanie modułu

*[English version →](../writing-a-module.md)*

Moduł to samodzielny plik wykonywalny, który czyta jedno żądanie JSON ze
stdin, wypisuje jedną odpowiedź JSON na stdout i kończy działanie. To cały
kontrakt.

## Najmniejszy działający moduł

`modules/my-module/Cargo.toml`:

```toml
[package]
name = "my-module"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "my-module"
path = "src/main.rs"

[dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

`modules/my-module/module.json`:

```json
{
  "id": "my-module",
  "name": "Nazwa widoczna w aplikacji",
  "description": "What it does, and honestly what it does not",
  "version": "0.1.0",
  "platforms": ["linux"],
  "binary": "my-module",
  "capabilities": ["fs-user"]
}
```

`capabilities` wymienia tylko to, czego **obecny kod faktycznie używa** — nie
to, czego mógłby chcieć później. To deklaracja, która podlega przeglądowi.

`src/main.rs` ma kształt, którego używa każdy istniejący moduł: enum żądań z
`#[serde(tag = "cmd")]`, nieoznaczony enum odpowiedzi i `main`, który czyta
jedną linię i wypisuje jedną linię. Zamiast pisać od zera, skopiuj
najmniejszy istniejący moduł (`modules/system-info`).

## Podłączanie

1. **Zarejestruj crate** — workspace już obejmuje `modules/*`, więc
   `Cargo.toml` w katalogu głównym nie wymaga zmian.
2. **Dopisz go do `access/catalog.json`** w sekcji `modules`, z tymi samymi
   uprawnieniami co w manifeście (`cargo test -p core` porównuje oba
   miejsca). Rdzeń uruchamia tylko moduły stamtąd i po stronie Rust nic
   więcej nie trzeba: widok rozmawia z modułem jedną komendą,

   ```ts
   const res = await callModule<ScanData>('my-module', { cmd: 'scan' })
   ```

   z żądaniem w snake_case modułu. Własna komenda rdzenia jest tylko dla
   uprzywilejowanej połowy — takiej, która prosi brokera, z bramką w postaci
   wpisu w `operations` w tym samym katalogu.
3. **Zbuduj i zsynchronizuj**: `node scripts/sync-sidecars.mjs`
4. **Dodaj go do `externalBin`** w `core/src-tauri/tauri.<system>.conf.json`
   dla każdego systemu wymienionego w manifeście — *po* tym, jak binarka
   istnieje, inaczej budowanie Tauri skończy się błędem
   `resource path ... doesn't exist`. Test sprawdza, że każda paczka zawiera
   dokładnie moduły swojego systemu.
5. **Dodaj wpis do katalogu** w `core/src/data/modules.ts` (folder,
   obsługiwane systemy, poziom ryzyka, uprawnienia).
6. **Dodaj widok** w `core/src/views/modules/` i zarejestruj go w
   `MODULE_VIEWS` w `ModuleView.tsx`.

## Zasady, które nie podlegają negocjacji

**Żadnego podnoszenia uprawnień w module.** Żadnego `sudo`, `pkexec`,
setuid, żadnego wyjątku „tylko ten jeden raz”, choćby najwęższego. Jeśli
moduł potrzebuje roota, uprzywilejowana część należy do brokera jako nowa
operacja w katalogu, a moduł bez niej zgłasza uczciwy błąd. Patrz
[Model bezpieczeństwa](security-model.md).

**Podgląd przed zniszczeniem.** Skanowanie i działanie to osobne komendy.
Użytkownik widzi, co się stanie, i potwierdza; moduł nigdy nie skanuje i nie
działa w jednym wywołaniu.

**Sprawdzaj ponownie po stronie działania.** Nie zakładaj, że ścieżki
wracające w żądaniu `clean` to te, które zwróciłeś ze `scan`. Sprawdź je
znowu z białą listą. Stan może się zmienić między wywołaniami, a żądanie nie
musi być tym, które wyprodukowałeś.

**W razie niepewności odmawiaj.** Jeśli nie potrafisz ustalić, czy czegoś
bezpiecznie dotknąć, odmów. Nigdy nie pozwól, żeby nieczytelna wartość stała
się domyślną, która wyłącza sprawdzenie — ten konkretny błąd już raz w tym
kodzie popełniono i trafił do wydania jako prawdziwa dziura.

**Nigdy nie podążaj za dowiązaniami przy usuwaniu.** Działaj na samym
dowiązaniu. Do sprawdzania zawierania rozwiązuj katalog *nadrzędny*, nie
ścieżkę docelową.

**Mów uczciwie o ograniczeniach.** Jeśli funkcja działa tylko w niektórych
konfiguracjach, napisz to w opisie i w interfejsie. Moduł, który po cichu
robi mniej, niż obiecuje, jest gorszy od takiego, który mówi, że nie
potrafi.

## Logika per system

Moduł ma **jeden crate, jedną nazwę binarki i jeden protokół** na każdym
systemie. To, co zmienia się pod spodem, jest szczegółem implementacji,
którego frontend i `module.json` nigdy nie widzą.

Sposób podziału zależy od tego, jak bardzo systemy się faktycznie różnią.

### Różne ścieżki albo napisy — rozgałęzienie w miejscu

`cfg!(target_os = "…")` to zwykła wartość logiczna w czasie działania.
Każda gałąź kompiluje się na każdej platformie, więc to działa tylko wtedy,
gdy wszystkie gałęzie *da się* wszędzie skompilować — inne katalogi, inne
nazwy poleceń, inne wartości domyślne. Tak robią to istniejące moduły
wieloplatformowe:

```rust
let cache_root = if cfg!(target_os = "macos") {
    home.join("Library/Caches")
} else {
    home.join(".cache")
};
```

### Różne mechanizmy — podział na pliki

W chwili, gdy implementacja potrzebuje API, crate'a albo polecenia, które na
innych systemach nie istnieje, `cfg!` przestaje działać: kod nadal musi się
wszędzie kompilować, a nie może. Użyj wtedy *atrybutu* `#[cfg]`, który
usuwa niepasujący kod przed kompilacją, i daj każdemu systemowi osobny plik
za wspólnym traitem:

```
modules/<name>/src/
  main.rs         protokół, dyspozycja, wspólne typy — bez rozgałęzień per system
  platform/
    mod.rs        trait i reeksport wybierany przez cfg
    linux.rs
    macos.rs
    windows.rs
```

```rust
// platform/mod.rs
pub trait Platform {
    fn scan(&self) -> ScanResult;
    fn clean(&self, paths: Vec<String>) -> CleanResult;
}

#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "linux")]
pub use linux::Impl as Current;

#[cfg(target_os = "macos")]
mod macos;
#[cfg(target_os = "macos")]
pub use macos::Impl as Current;

#[cfg(target_os = "windows")]
mod windows;
#[cfg(target_os = "windows")]
pub use windows::Impl as Current;
```

`main.rs` rozmawia wtedy tylko z `Current` i nigdy nie wspomina systemu
operacyjnego. To ten sam kształt, którego `crates/broker-common` używa dla
brokerów per system, z tego samego powodu.

**Reguła kciuka:** inne *miejsce* to rozgałęzienie; inny *mechanizm* to
plik. Najczytelniejszy przykład to harmonogramy — timery systemd, `launchd`
i Harmonogram zadań nie mają ze sobą nic wspólnego poza intencją.

### Linux to nie jeden system

Moduł, który uruchamia `apt-get`, czyta `/var/lib/dpkg/status` albo wywołuje
`update-grub`, działa w rodzinie Debiana i nigdzie indziej. Wszystko, co
zależy od dystrybucji, idzie przez `crates/distro`, który odpowiada na trzy
pytania każdemu, kto pyta, łącznie z brokerem działającym jako root:

- który menedżer pakietów jest tu natywny — `distro::manager()` — albo
  dlaczego nie ma żadnego do użycia (system oparty na obrazie, menedżer,
  którego POSMA nie obsługuje);
- które jądra są zainstalowane i który pakiet jest właścicielem każdego;
- gdzie GRUB trzyma pliki i jak odbudowuje się jego menu.

Jeśli odpowiedź brzmi „żaden”, przekaż powód do interfejsu. Nie sprawdzaj
dystrybucji po nazwie i nie zgaduj na podstawie tego, które binarki akurat
są zainstalowane — na Fedorze może być `apt`.

`scripts/distro-check.sh` uruchamia każdy moduł linuksowy w kontenerze
każdej obsługiwanej dystrybucji. Moduł, który parsuje wyjście narzędzia,
potrzebuje tam sprawdzenia: menedżery pakietów w dystrybucjach rolling
zmieniają to, co wypisują.

### Protokół zostaje identyczny

Kształt odpowiedzi nie może zależeć od systemu, bo inaczej frontend skończy
z gałęzią na platformę, a moduł przestanie być jednym modułem.

Tam, gdzie system naprawdę nie potrafi czegoś, co potrafią inne, **powiedz
to w odpowiedzi**, zamiast po cichu robić mniej — ta sama zasada
uczciwości, której broker trzyma się z `not_supported`. Pole zawsze puste na
jednej platformie jest lepsze niż pole, które znaczy tam coś innego.

### Deklaruj tylko to, czego potrzebuje bieżący system

`module.json` wymienia `platforms` i `capabilities` dla modułu jako całości.
Jeśli implementacja na jednym systemie wymaga podniesienia uprawnień, a na
innym nie, ta różnica należy do opisu, żeby nikt czytający manifest nie
zakładał, że ścieżka uprzywilejowana jest używana wszędzie.

## Bezpieczeństwo ścieżek

Dla wszystkiego w katalogu domowym użytkownika wzorzec stosowany w całym
kodzie to: rozwiąż katalog nadrzędny, dołącz nazwę pliku i wymagaj
zawierania **ściśle wewnątrz** dozwolonego korzenia:

```rust
let inside = path.parent()
    .and_then(|p| p.canonicalize().ok())
    .map(|parent| {
        let full = parent.join(path.file_name().unwrap_or_default());
        roots.iter().any(|root| root.canonicalize()
            .map(|r| full.starts_with(&r) && full != r)   // != r is load-bearing
            .unwrap_or(false))
    })
    .unwrap_or(false);
```

Połowa `full != r` powstrzymuje żądanie wskazujące sam korzeń przed
zabraniem całego drzewa. Brakowało jej w czterech modułach naraz — nie
usuwaj jej.

Rozwiązywanie katalogu *nadrzędnego* zamiast samej ścieżki też jest celowe:
cel może być dowiązaniem, które chcesz odłączyć, albo może jeszcze nie
istnieć.

## Dodawanie operacji uprzywilejowanej

Jeśli funkcja naprawdę potrzebuje roota:

1. Dodaj wariant do katalogu w `crates/broker-common/src/ops.rs`.
2. Dodaj metodę z domyślną implementacją do traitu `Broker` w `broker.rs`.
3. Dodaj gałąź dyspozycji w `handle_line`.
4. Zaimplementuj ją w każdym brokerze systemowym, który potrafi ją
   obsłużyć, i wymień ją w `implemented_ops()` tego brokera.
5. Dodaj komendę rdzenia z bramką `PermissionRegistry::require(...)`.

Waliduj dane **wewnątrz brokera**, niezależnie. Korzystaj z
`guards::is_safe_package_id`, `guards::contained_in`, `guards::is_same_file`
— istnieją, bo każde z nich zapobiegło prawdziwemu błędowi (albo raz nie
zapobiegło).

Nigdy nie dodawaj ogólnej operacji przelotowej. Zamknięty katalog jest
modelem bezpieczeństwa; operacja, która przyjmuje polecenie do wykonania,
przekreśla go w całości.

## Testowanie

Rozmawiaj z modułem bezpośrednio — to po prostu proces:

```bash
echo '{"cmd":"scan"}' | ./target/debug/my-module | python3 -m json.tool
```

Testuj ścieżki odmowy (złe dane, ścieżki spoza białej listy, zniekształcone
żądania) na prawdziwej binarce. **Nie** uruchamiaj niszczących ścieżek
sukcesu na własnej maszynie, żeby „sprawdzić, czy działają” — weryfikuj je,
czytając kod, albo na systemie jednorazowym.
