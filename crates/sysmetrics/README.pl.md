# sysmetrics

*[English version →](README.md)*

Odczyty, które maszyna odda o sobie bez żadnych uprawnień.

## Dodawanie źródła

Jedna funkcja zwracająca `Vec<Metric>`, dopisana do `collect()` w
`lib.rs`. Nic dalej się nie zmienia — ani sidecary, ani pulpit, ani monitor
zdrowia. Obsługa GPU doszła właśnie tak i pojawiła się w interfejsie bez
edycji któregokolwiek z widoków.

```rust
pub fn fan_speeds() -> Vec<Metric> {
    // Nothing to report is an empty list, never a zero.
    vec![Metric::new("fan-0", "Wentylator", rpm, "RPM", MetricKind::Load)
        .detail("obudowa")
        .group("cooling")]
}
```

## Zasady, których trzyma się źródło

**Brak to brak.** Maszyna bez osobnej karty graficznej to nie maszyna,
której GPU stoi na 0%. Kolektor, który nic nie znajduje, zwraca pustą
listę, a odczytu po prostu nie ma.

**Bez uprawnień.** Wszystko tutaj czyta pliki dostępne dla każdego albo
uruchamia narzędzie bez uprawnień. Wszystko, co wymaga roota, należy za
brokerem — tam żyje S.M.A.R.T. i dlatego nie ma go w tym crate'cie.

**Białe listy, nie wszystko.** Maszyna zgłasza temperatury kontrolera
sieci i regulatora napięcia. Pokazanie wszystkich zamienia pulpit w zrzut
czujników, więc każdy kolektor wymienia układy, które rozumie, a resztę
pomija, zamiast pokazywać liczbę bez podpisu.

**`kind` decyduje o sposobie pokazania.** Interfejs rysuje wykres dla
`Load`, daje pasek wszystkiemu, co ma `percent`, a resztę pokazuje jako
liczbę. Metryka dodana później wyświetla się poprawnie bez zmiany po
drugiej stronie.

**Koszt jest częścią kontraktu.** `nvidia-smi` kosztuje uruchomienie
procesu (~25 ms) i jest pytane dopiero wtedy, gdy sysfs nic nie zwróci.
Kolektor, który kosztowałby więcej niż odstęp między odczytami, nie należy
tutaj.

## Gdzie pojawiają się odczyty

| Odbiorca | Używa |
|---|---|
| `system-info` | Kafelki pulpitu |
| `health-monitor` | Sekcja czujników, obok rdzeni i procesów |
