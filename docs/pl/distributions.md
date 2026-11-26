# Dystrybucje Linuksa

*[English version →](../distributions.md)*

POSMA powstała na Ubuntu i długo było to widać: cztery z siedmiu modułów
linuksowych zakładały apt i dpkg, `update-grub` i dowiązanie
`/boot/vmlinuz`. Ta strona mówi, gdzie aplikacja działa teraz, co
faktycznie uruchomiono, żeby to ustalić, i czego nie uruchomiono.

## Jak działa obsługa

Po rodzinie, nie po nazwie. Ponad dwadzieścia dystrybucji, które ludzie
faktycznie instalują, sprowadza się do czterech menedżerów pakietów, a
pochodna ogłasza swojego rodzica w `/etc/os-release` (`ID_LIKE`). Wspólny
crate `distro` to czyta, a pytają go i moduły bez uprawnień, i broker
działający jako root — więc nie mogą się różnić w tym, jaki to system.

| | apt | pacman | dnf | zypper | oparte na obrazie | cokolwiek innego |
|---|---|---|---|---|---|---|
| | Debian, Ubuntu, Mint, Pop!_OS, Zorin, MX, elementary, Kali, KDE neon | Arch, CachyOS, Manjaro, EndeavourOS, Garuda | Fedora, Nobara, RHEL, AlmaLinux, Rocky | openSUSE | Bazzite, SteamOS, Silverblue | NixOS, Void, Alpine, Gentoo |
| Dziewięć modułów wieloplatformowych | tak | tak | tak | tak | tak | tak |
| Pamięć podręczna pakietów, osierocone | tak | tak | tak | tak | mówi, dlaczego nie | mówi, dlaczego nie |
| Deinstalator — pakiety systemowe | tak | tak | tak | tak | — | — |
| Deinstalator — Flatpak, snap, pozostałości | tak | tak | tak | tak | tak | tak |
| Wersje jądra — lista | tak | tak | tak | tak | — | — |
| Wersje jądra — usuwanie | tak | nie¹ | tak | nie² | — | — |
| Edytor GRUB | `update-grub`, `/boot/grub` | `grub-mkconfig`, `/boot/grub` | `grub2-mkconfig`, `/boot/grub2` | `grub2-mkconfig`, `/boot/grub2` | mówi, dlaczego nie | tam, gdzie są GRUB i jego narzędzia |
| Dziennik systemd | tam, gdzie init to systemd | tak | tak | tak | tak | mówi, dlaczego nie |

¹ Każdy pakiet jądra zawiera dokładnie jedną wersję, a aktualizacja ją
zastępuje, więc nic się nie gromadzi.
² openSUSE sam usuwa stare jądra po restarcie.

„Mówi, dlaczego nie” należy rozumieć dosłownie: moduł się otwiera i podaje
powód w jednym zdaniu. Tam, gdzie funkcja na danym systemie nie istnieje,
POSMA to mówi, zamiast pokazywać pustą listę albo przycisk, który zawiedzie.

System oparty na obrazie jest rozpoznawany po `/run/ostree-booted` albo po
`/usr` zamontowanym tylko do odczytu. Jego pakiety należą do obrazu, więc
POSMA nie proponuje ich usuwania — Flatpak, przez który aplikacje mają być
tam instalowane, działa jak wszędzie.

## O co POSMA pyta przy pierwszym uruchomieniu

Rodzina to jedna z czterech rzeczy, które ustala crate `distro`. Pozostałe
to pulpit, czytany z `XDG_CURRENT_DESKTOP`, i program rozruchowy, czytany
najpierw ze zmiennej EFI `LoaderInfo`, którą ustawia sam program (systemd-boot,
Limine i GRUB tam, gdzie jest zbudowany z `bli`, jak na Fedorze), a dopiero
potem z plików na dysku. Ostatnia to to, czy init to systemd.

Pierwszy ekran po zgodzie pokazuje to wszystko — „CachyOS · na bazie: arch
· pacman · KDE Plasma · Limine” — i pyta, czy się zgadza. Wszystko, co
zostanie tam poprawione, albo później w Ustawieniach, rdzeń zapisuje i
przekazuje każdemu uruchamianemu modułowi jako `POSMA_PKG_MANAGER`,
`POSMA_DESKTOP` i `POSMA_BOOTLOADER`. Co się z tym zmienia:

| | |
|---|---|
| Personalizacja pulpitu | Nazwana od pulpitu i steruje jego własnymi ustawieniami: klucze GNOME dla GNOME, Budgie i Pantheon, ich odgałęzienia w Cinnamonie i MATE, `xfconf-query` dla Xfce, `kwriteconfig` dla Plasmy. LXQt, COSMIC i menedżery okien są nazywane i zostawiane w spokoju. |
| Edytor rozruchu | Otwiera się dla programu, który uruchamia system: pełny edytor GRUB albo domyślny wpis i czas oczekiwania dla Limine, systemd-boot i rEFInd. Pliki GRUB mogą przetrwać przejście na Limine, a ich edycja niczego by nie zmieniła. |
| Moduły pakietów | Nazwane od swojego menedżera; podpowiedzi instalacji używają jego polecenia. |
| Dziennik | Mówi, dlaczego nie, tam, gdzie init to nie systemd. |

Rodzinę można wybrać tylko tam, gdzie system żadnej nie deklaruje. Rodzina
podana w `os-release`, z zainstalowanym narzędziem, to fakt, na którym
działa też broker roota — więc odpowiedź użytkownika nie może sprawić, że
moduł pokaże pakiety pacmana brokerowi, który uruchomi apt.

## Co uruchomiono i gdzie

Trzy rodzaje dowodów, które nie są tym samym:

- **Prawdziwa maszyna** — aplikacja używana na zainstalowanym systemie.
- **Kontener** — moduły i broker działają w kontenerze tej dystrybucji, na
  jej prawdziwym menedżerze pakietów, łącznie ze ścieżkami niszczącymi:
  pakiet zostaje usunięty, osierocone sprzątnięte, pamięć podręczna
  opróżniona, stare jądro wyjęte.
- **Zastępstwo** — dystrybucja nie publikuje obrazu kontenera, więc używany
  jest obraz, z którego jest zbudowana, przedstawiający się w `os-release`
  tak, jak robi to pochodna. To sprawdza wykrywanie na właściwym userlandzie.
  To nie jest ta dystrybucja.

Czego nie pokaże żaden kontener, dla żadnego wiersza poniżej: rozruchu
przez odtworzone menu GRUB, okna hasła polkit, samego okna aplikacji,
zainstalowanego demona brokera i magazynu poświadczeń, w którym sejf
trzyma klucz.

| Dystrybucja | Rodzina | Dowód | Uruchomiono też |
|---|---|---|---|
| Ubuntu 24.04 | apt | prawdziwa maszyna; kontener | jądra, GRUB, build |
| Ubuntu 26.04 | apt | kontener | build |
| CachyOS | pacman | kontener; samo okno, na wirtualnym ekranie | jądra, GRUB, build |
| Linux Mint 22.3 | apt | kontener | |
| Debian 13 | apt | kontener | jądra, GRUB, build |
| Fedora 44 | dnf | kontener | jądra, GRUB, build |
| Arch Linux | pacman | prawdziwa maszyna: aplikacja startuje, modułów nie sprawdzono jeszcze po kolei; kontener | build |
| Manjaro | pacman | kontener | |
| openSUSE Tumbleweed | zypper | kontener | jądra, GRUB, build |
| elementary OS | apt | kontener | |
| Kali | apt | kontener | jądra (tylko jedna wersja), GRUB |
| SteamOS | oparta na obrazie | kontener jej obrazu bazowego, tylko do odczytu | |
| NixOS | brak | kontener userlandu Nix, nie zainstalowany NixOS | |
| MX Linux | apt | zastępstwo na Debianie 13 | |
| Pop!_OS | apt | zastępstwo na Ubuntu 24.04 | |
| Zorin OS | apt | zastępstwo na Ubuntu 24.04 | |
| KDE neon | apt | zastępstwo na Ubuntu 24.04 | |
| EndeavourOS | pacman | zastępstwo na Archu | |
| Garuda | pacman | zastępstwo na Archu | |
| Nobara | dnf | zastępstwo na Fedorze 44 | |
| Bazzite | oparta na obrazie | zastępstwo na Fedorze 44, tylko do odczytu | |
| **Serwery** | | | |
| Ubuntu Server 22.04 | apt | kontener | build |
| Debian 12 | apt | kontener | jądra, GRUB, build |
| AlmaLinux 9 (RHEL 9) | dnf | kontener | jądra, GRUB; **okna nie da się zbudować** |
| Rocky Linux 10 (RHEL 10) | dnf | kontener | build, z EPEL |
| **Poza czterema rodzinami** | | | |
| Void, Alpine | brak | kontener | |

Dwadzieścia dystrybucji domowych wybrano z rankingu odsłon DistroWatch i z
ankiety sprzętowej Steam z września 2026. Żadne z nich nie liczy
instalacji; to najbliższe liście, co istnieje.

## Warto wiedzieć o poszczególnych dystrybucjach

**CachyOS.** Instalator proponuje kilka programów rozruchowych i GRUB jest
tylko jednym z nich. Z Limine, systemd-boot albo rEFInd edytor rozruchu
ustawia tylko domyślny wpis i czas oczekiwania — motywy GRUB nie mają tam
odpowiednika. `limine.conf` Limine jest po każdej zmianie ponownie
pieczętowany przez `limine-enroll-config`, jak oczekuje limine-entry-tool;
przy domyślnych ustawieniach tej dystrybucji podpisuje ponownie tylko
tam, gdzie istnieją klucze Secure Boot. Domyślny pulpit to KDE Plasma;
personalizacja pulpitu poprawnie czyta jej ustawienia w sesji Plasma 6, a
ich zapisywania jeszcze tam nie próbowano. Wersje jądra wymieniają
`linux-cachyos` i rodzeństwo, ale nie mają czego usuwać.

**Systemy na bazie Archa z wydaniami rolling.** Opróżnienie pamięci
podręcznej pakietów usuwa też poprzednie wersje, do których dałoby się
cofnąć nieudaną aktualizację. Potwierdzenie to mówi.

**Pop!_OS** uruchamia się przez systemd-boot: edytor rozruchu ustawia jego
domyślny wpis i czas oczekiwania.

**MX Linux** startuje z SysVinit, o ile nie powie mu się inaczej. Bez
systemd nie ma dziennika do przycinania, a demona brokera nie da się
zainstalować; każda akcja uprzywilejowana pyta zamiast tego przez `pkexec`,
czyli tą samą drogą, której używa świeża instalacja wszędzie.

**Fedora i jej rodzina.** Motywy GRUB wyświetlają się tylko z
`GRUB_TERMINAL_OUTPUT="gfxterm"`; Fedora dostarcza `console`, więc
instalacja motywu przełącza tę jedną linię. `GRUB_TERMINAL=console`
ustawione ręcznie wciąż wygrywa i zostaje nietknięte. Jądra nie są tam w
`grub.cfg`, tylko w `/boot/loader/entries`, po pliku na każde; lista wpisów
rozruchowych czyta je stamtąd.

**Wybór domyślnego wpisu.** Na Debianie, Ubuntu i openSUSE każde jądro poza
najnowszym siedzi w podmenu „Advanced options”, a GRUB znajduje taki wpis
tylko po pełnej ścieżce. Lista podaje go jako
`Advanced options for Ubuntu>Ubuntu, with Linux …` — przy samym tytule GRUB
po cichu uruchomiłby zamiast niego pierwszy wpis.

**Bazzite, SteamOS** i inne systemy oparte na obrazie: patrz wyżej.

**NixOS, Void, Alpine, Gentoo.** Moduły pakietów aplikacji nie obsługują
nix, xbps, apk ani portage i to mówią. Działa wszystko, co pracuje na
własnych plikach użytkownika.

**Serwery.** POSMA to aplikacja na pulpit: potrzebuje sesji graficznej,
WebKitGTK 4.1 i polkit z agentem uwierzytelniania. Na RHEL 9 i jego
przebudowach moduły i broker działają, ale okna nie da się zbudować:
pakowany jest tam tylko WebKitGTK 4.0, i w dystrybucji, i w EPEL. RHEL 10
ma 4.1 w EPEL. Ubuntu Server i Debian go mają.

## Build zrobiony na jednej dystrybucji, uruchomiony na innej

Binarka zbudowana na Ubuntu 24.04 potrzebuje glibc 2.39 i nie uruchomi się
na niczym starszym — na AlmaLinux 9 zatrzymuje się na loaderze:

```
/lib64/libc.so.6: version `GLIBC_2.39' not found
```

Build wędruje więc do przodu, nie wstecz: zbudowany tutaj działa na
Debianie 13, Fedorze, Archu i ich rodzinach, a nie na Debianie 12, Ubuntu
22.04 ani RHEL 9. Zbudowany ze źródeł *na* każdym z nich działa dobrze.

Dlatego workflow wydań buduje pakiety linuksowe na Ubuntu 22.04: wydanie
trzeba budować na najstarszym systemie, który ma obsługiwać, a nie na tym,
na którym akurat działa maszyna deweloperska — a dystrybucja rolling jest
najnowszym, co istnieje.

## Uruchamianie sprawdzeń

```bash
rustup target add x86_64-unknown-linux-musl   # raz
bash scripts/distro-check.sh                  # każda dystrybucja
bash scripts/distro-check.sh --kernels --grub cachyos fedora
bash scripts/distro-check.sh --build debian
```

Skrypt raz buduje moduły jako statyczne binarki, więc te same pliki działają
na każdym obrazie bez względu na jego bibliotekę C, i uruchamia kontener na
dystrybucję. Pobrane obrazy usuwa po drodze.

Dystrybucję dodaje się, dopisując jeden wiersz do tabeli na początku
skryptu. Jeśli należy do rodziny, która już jest na liście, nic więcej się
nie zmienia.
