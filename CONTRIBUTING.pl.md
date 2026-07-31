# Współtworzenie POSMA

*[English version →](CONTRIBUTING.md)*

Zgłoszenia i pull requesty są mile widziane. Ten plik opisuje zasady
specyficzne dla tego projektu; jak wszystko działa, wyjaśnia
[dokumentacja](https://kosmabb.github.io/Posma/) (po angielsku).

## Zanim zaczniesz

- **Zgłoszenia błędów** — podaj system operacyjny i dokładną treść komunikatu,
  jeśli jakiś jest. Gdy moduł zachował się nieprawidłowo, bardzo pomaga wynik
  rozmowy z nim wprost:
  `echo '{"cmd":"scan"}' | ./target/debug/<moduł>`.
- **Kwestie bezpieczeństwa** — nie zakładaj publicznego zgłoszenia. Patrz
  [SECURITY.pl.md](SECURITY.pl.md).
- **Większe zmiany** — najpierw załóż zgłoszenie. Nowy moduł albo nowa
  operacja uprzywilejowana to rozmowa o projekcie, nie sama łatka.

## Dwie zasady nienegocjowalne

Obie wynikają z tego, co ten program robi z uprawnieniami administratora.

1. **Żadnych nowych zachowań uprzywilejowanych poza katalogiem brokera.**
   Żadnego `sudo`, `pkexec`, setuid ani wywołania jako root wewnątrz modułu,
   choćby wyglądało na maksymalnie wąskie. Jeśli funkcja wymaga roota, jej
   uprzywilejowana część staje się przejrzaną operacją w
   `crates/broker-common`, a moduł bez niej zgłasza uczciwy błąd.

2. **Wszystko, co destrukcyjne, najpierw pokazuje podgląd, a walidowane jest
   po stronie uprzywilejowanej.** Skanowanie i działanie to osobne polecenia.
   Broker sam sprawdza każde wejście, zamiast ufać temu, co zweryfikował już
   interfejs lub moduł, i odmawia, gdy nie potrafi ustalić, czy operacja jest
   bezpieczna.

Łatka naruszająca którąkolwiek z nich nie zostanie przyjęta, nawet jeśli
działa.

## Czego się oczekuje w praktyce

**Zawodź bezpiecznie.** Jeśli nie da się stwierdzić, czy coś można ruszyć —
odmów. Nigdy nie pozwól, żeby nieodczytana wartość stała się wartością
domyślną, która po cichu wyłącza sprawdzenie.

**Korzystaj ze wspólnych zabezpieczeń.** `crates/broker-common/src/guards.rs`
zawiera sprawdzanie zawierania ścieżek, walidację nazw, wykrywanie tego samego
pliku, zapis atomowy oraz łańcuch kopii zapasowej i wycofania zmian. Używaj
ich, zamiast pisać sprawdzenie po raz drugi — każde z nich chroni przed
konkretnym błędem, a druga kopia to druga rzecz do zepsucia.

**Testuj zabezpieczenia, których dotykasz.** Funkcje krytyczne dla
bezpieczeństwa mają testy jednostkowe napisane tak, że **padają po usunięciu
zabezpieczenia**. Dodajesz zabezpieczenie — dodaj test, który wykryłby jego
brak.

**Bądź uczciwy w interfejsie i w dokumentacji.** Funkcja działająca tylko na
części konfiguracji powinna to mówić. Dokumentacja obiecująca więcej, niż
robi kod, traktowana jest tutaj jak błąd.

## Praca z kodem

Wymagania i kolejność budowania opisuje
[docs/building.md](docs/building.md). W skrócie:

```bash
npm --prefix core install
bash scripts/sync-sidecars.sh   # wymagane przed pierwszym budowaniem
npm --prefix core run tauri dev
```

Przed otwarciem pull requesta:

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
npm --prefix core run build
```

CI uruchamia te same sprawdzenia plus audyt zależności. Jeden test jest
oznaczony `#[ignore]`, bo wymaga prawdziwego magazynu poświadczeń systemu;
uruchom go w sesji graficznej przez `cargo test -p vault -- --ignored`.

## Zasady testowania

Ścieżki odrzucenia testuj na prawdziwych binarkach — nieprawidłowe żądania,
ścieżki spoza białych list, nazwy, które mogłyby zostać odczytane jako flagi.

**Nie uruchamiaj destrukcyjnych ścieżek sukcesu na własnej maszynie**, żeby
sprawdzić, czy działają. Usuwanie pakietów, przycinanie logów, zapis
konfiguracji rozruchu — te weryfikuj czytając kod i testując odmowy, albo na
maszynie wirtualnej, której nie szkoda.

## Licencja wkładu

POSMA objęty jest podwójną licencją (patrz [LICENSE.md](LICENSE.md) oraz
[COMMERCIAL-LICENSE.pl.md](COMMERCIAL-LICENSE.pl.md)). Przesyłając wkład,
zgadzasz się, że jest on objęty tymi samymi warunkami, łącznie z komercyjnymi,
żeby projekt mógł nadal być oferowany na obu.
