# Dokumentacja POSMA

*[English version →](../)*

Dokumentacja dla programistów i osób sprawdzających kod. Jeśli chcesz
zrozumieć, co POSMA robi z uprawnieniami administratora, zanim jej
zaufasz, zacznij od [Modelu bezpieczeństwa](security-model.md) — ten
dokument powstał dokładnie po to.

| Dokument | Co opisuje |
|---|---|
| [Architektura](architecture.md) | Jak rdzeń, moduły i brokery łączą się w całość i dlaczego podział wygląda właśnie tak |
| [Model bezpieczeństwa](security-model.md) | Pełny model uprawnień: co może sięgnąć do roota, co to powstrzymuje i co **nie** jest chronione |
| [Pisanie modułu](writing-a-module.md) | Kontrakt modułu — protokół, manifest, uprawnienia, zasady bezpieczeństwa |
| [Pisanie motywu](writing-a-theme.md) | Własny wygląd całej aplikacji: język, nazwy zmiennych, szablon startowy, zasady |
| [Pisanie tłumaczenia](writing-a-translation.md) | POSMA w twoim języku: format pliku, formy liczby mnogiej, wzór, sprawdzanie |
| [Budowanie i praca z kodem](building.md) | Narzędzia, kolejność budowania, synchronizacja modułów, testowanie, instalatory |
| [Dystrybucje Linuksa](distributions.md) | Na których dystrybucjach POSMA działa, co każdy moduł tam robi i co faktycznie uruchomiono, żeby to ustalić |

Dokumentacja istnieje po polsku i po angielsku. Gdyby obie wersje się
rozjechały, rozstrzyga kod — a rozbieżność warto zgłosić jak każdy inny błąd.
README dla użytkowników też jest w obu językach:
[polskim](https://github.com/KosmaBB/Posma/blob/master/README.pl.md) i
[angielskim](https://github.com/KosmaBB/Posma/blob/master/README.md).

## Dokumenty projektowe

W katalogu głównym repozytorium leży jeden dłuższy dokument, z którego
wywodzi się wiele z tego, co tu opisano:

- [`Access_plan.md`](https://github.com/KosmaBB/Posma/blob/master/Access_plan.md) — projekt systemu
  uprawnień. Sekcja §3 zawiera macierz moduł × uprawnienie × system, §4
  projekt brokera, §6 kolejność wdrażania. Kod odwołuje się do niego z nazwy
  w wielu miejscach.

## Zasady projektu

Leżą w katalogu głównym repozytorium i istnieją po polsku i po angielsku:

- Polityka bezpieczeństwa — [polski](https://github.com/KosmaBB/Posma/blob/master/SECURITY.pl.md) · [English](https://github.com/KosmaBB/Posma/blob/master/SECURITY.md)
- Przewodnik dla współtwórców — [polski](https://github.com/KosmaBB/Posma/blob/master/CONTRIBUTING.pl.md) · [English](https://github.com/KosmaBB/Posma/blob/master/CONTRIBUTING.md)
- Licencja — [tekst wiążący](https://github.com/KosmaBB/Posma/blob/master/LICENSE.md) (po angielsku), wyjaśniony po [polsku](https://github.com/KosmaBB/Posma/blob/master/COMMERCIAL-LICENSE.pl.md) i po [angielsku](https://github.com/KosmaBB/Posma/blob/master/COMMERCIAL-LICENSE.md)

## O dokładności

Te dokumenty opisują, co kod robi *dzisiaj*, łącznie z miejscami, w których
czegoś mu brakuje. Jeśli coś jest zaplanowane, ale nie zbudowane, jest to
powiedziane wprost. Jeśli znajdziesz miejsce, w którym dokumentacja obiecuje
więcej, niż kod daje, to błąd wart zgłoszenia — cały sens tego projektu
polega na tym, że jego twierdzenia da się sprawdzić.
