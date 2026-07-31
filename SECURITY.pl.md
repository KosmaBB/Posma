# Polityka bezpieczeństwa

*[English version →](SECURITY.md)*

POSMA wykonuje konserwację systemu i do części zadań prosi o uprawnienia
administratora. Zgłoszenia dotyczące bezpieczeństwa traktowane są poważnie i
są mile widziane.

## Zgłaszanie podatności

E-mail: **kosma.brzezawski@gmail.com**

Prosimy o na tyle szczegółowy opis, żeby dało się problem odtworzyć: co
zostało zrobione, co się stało i czego się spodziewano. Jeśli ma to
znaczenie, prosimy podać system operacyjny oraz wersję lub commit.

**Prosimy nie zakładać publicznego zgłoszenia dla czegoś, co da się
wykorzystać**, dopóki nie zostanie to naprawione. Nie ma programu nagród
finansowych; jest zobowiązanie do odpowiedzi i do wskazania autora zgłoszenia
przy poprawce, chyba że wolisz pozostać anonimowy.

Na pierwszą odpowiedź należy liczyć w ciągu kilku dni. To projekt jednoosobowy,
a nie firma z dyżurem — jeśli coś jest aktywnie wykorzystywane, prosimy
napisać o tym w temacie wiadomości.

## Co jest w zakresie

Wszystko, co pozwala komuś lub czemuś zrobić więcej, niż powinno:

- wyjście poza granicę uprawnień — nakłonienie brokera do wykonania czegoś
  spoza jego katalogu operacji przez nieuprzywilejowany moduł lub interfejs;
- doprowadzenie operacji uprzywilejowanej do działania na celu, który powinna
  odrzucić (wyjście poza katalog, obejście białej listy, sztuczki z
  dowiązaniami, przemycenie flagi w argumencie);
- obejście uwierzytelniania wywołującego w demonie albo dostanie się do niego
  jako inny użytkownik lokalny;
- wydobycie zawartości sejfu bez hasła głównego lub osłabienie chroniącej ją
  kryptografii;
- zniszczenie danych ścieżką, która miała najpierw pokazać podgląd, wykonać
  kopię zapasową albo odmówić.

## Co jest poza zakresem

- **Potwierdzona przez Ciebie operacja destrukcyjna, która robi to, co
  zapowiedziała.** POSMA pokazuje podgląd i pyta; jeśli potwierdzisz usunięcie
  plików, usunie je.
- **Moduły zewnętrzne zainstalowane samodzielnie.** Działają
  nieuprzywilejowanie jak każdy moduł, ale w obrębie Twojego konta mogą
  wszystko to, co Twoje konto — i nikt ich nie sprawdzał.
- **Już przejęte konto użytkownika.** Granicą jest tu użytkownik kontra root,
  a nie obrona przed czymś, co już działa jako Ty.
- **Brak zabezpieczeń w kodzie opisanym jako nieukończony** — brokery macOS i
  Windows nigdy nie działały na prawdziwym sprzęcie, a Windows nie ma w ogóle
  trybu demona. Zgłoszenia, że są niezweryfikowane, są słuszne, ale już znane;
  patrz [docs/security-model.md](docs/security-model.md) (w języku angielskim).

## Wspierane wersje

Projekt jest przed wydaniem 1.0. Poprawki trafiają na gałąź `master`; nie ma
jeszcze utrzymywanych gałęzi wydaniowych. Po wydaniu 1.0 ta sekcja będzie
wskazywać, które wersje otrzymują poprawki.

## Kontekst projektowy

[docs/security-model.md](docs/security-model.md) opisuje model uprawnień w
całości — co może sięgnąć do roota, co go przed tym powstrzymuje oraz jawną
listę tego, co **nie** jest chronione. Przeczytanie go najpierw pozwoli
stwierdzić, czy coś jest błędem, czy udokumentowanym ograniczeniem.

> Dokumentacja techniczna prowadzona jest po angielsku, żeby pozostała
> użyteczna dla osób, które nie czytają po polsku. Zgłoszenia przyjmowane są w
> obu językach.
