# POSMA — System dostępów i uprawnień (plan)

Cel: zanim kodujemy kolejne funkcje, ustalamy **jeden spójny system**, przez który każdy moduł
deklaruje czego potrzebuje, a aplikacja wie jak to zdobyć, przechować i wyegzekwować — na każdym
z trzech systemów. To realizuje ideę z mapy myśli: poziom **Pełny** (wszystkie zgody z góry, zero
restartów później) vs **Wybiórczy** (zgody per moduł, możliwe restarty przy doinstalowaniu).

---

## 1. Rzeczywistość uprawnień na trzech systemach (na czym budujemy)

| | Linux | Windows | macOS |
|---|---|---|---|
| Model | user / root | user / Administrator (UAC) | user / admin + **TCC** (zgody per zasób) |
| Podniesienie per akcja | `pkexec` + polityka polkit | UAC prompt (nowy proces elevated) | AuthorizationServices / `osascript` admin |
| Podniesienie trwałe ("Pełny") | polityka polkit z `auth_admin_keep` / usługa systemd (root) | **usługa Windows** (SYSTEM) instalowana raz z jednym UAC | **privileged helper** (SMAppService daemon) instalowany raz z jednym hasłem admina |
| Haczyk specjalny | brak — wszystko sprowadza się do root | punkt przywracania wymaga admina | **Full Disk Access (FDA)** — NIE DA się nadać programowo; użytkownik musi kliknąć w Ustawieniach systemowych (my możemy tylko otworzyć właściwy panel i poprowadzić) |

Wniosek architektoniczny: **"Pełny" = jednorazowa instalacja uprzywilejowanego brokera** (usługa/daemon/polityka)
podczas onboardingu + na macOS przeprowadzenie użytkownika przez FDA. "Wybiórczy" = broker instalowany
dopiero gdy pierwszy zainstalowany moduł go potrzebuje; akcje uprzywilejowane mogą pytać za każdym razem.

---

## 2. Katalog uprawnień (capabilities)

Zamknięta lista klas dostępu. Moduł deklaruje TYLKO te, których używa — rdzeń egzekwuje.

| ID | Nazwa | Wymaga podniesienia? | Uwagi |
|---|---|---|---|
| `fs-user` | Pliki użytkownika | nie | temp/cache/kosz/własne pliki |
| `fs-system` | Pliki systemowe | **tak** | /var/log, C:\Windows\Temp, cache systemowe |
| `fs-scan` | Skan całego dysku (read-only) | częściowo | bez podniesienia = skan z pominięciem cudzych plików (degradacja, nie błąd) |
| `pkg` | Menedżer pakietów | Linux: tak / Win: przeważnie nie / mac: n.d. | apt/pacman/flatpak/winget/brew |
| `svc` | Usługi i daemony | **tak** | systemd, usługi Windows, launchd system |
| `autostart-user` | Autostart użytkownika | nie | ~/.config/autostart, HKCU Run, LaunchAgents usera |
| `autostart-system` | Autostart systemowy | **tak** | jednostki systemowe, HKLM Run, LaunchDaemons |
| `boot` | Bootloader / jądro | **tak + reboot** | GRUB, /boot, wersje jądra — zawsze backup przed zmianą |
| `disk-smart` | S.M.A.R.T. / surowy dysk | **tak** | odczyt zdrowia dysków |
| `restore-point` | Punkt przywracania (Win) | **tak** | wywoływany automatycznie przed operacjami krytycznymi |
| `fda` | Full Disk Access (mac) | zgoda ręczna w Ustawieniach | Mail/Messages/Safari/Time Machine |
| `secrets` | Magazyn sekretów | nie | Vault: szyfrowana baza + klucz główny niedostępny dla modułów |
| `net` | Sieć | nie | np. audyt HIBP w Vault; deklarowane jawnie (przejrzystość) |

Zasada: **moduł nigdy nie dostaje uprawnień bezpośrednio** — wysyła żądanie operacji do rdzenia,
rdzeń sprawdza manifest modułu (czy zadeklarował daną capability) i dopiero wtedy przekazuje ją
brokerowi. Broker dodatkowo waliduje żądanie po swojej stronie (whitelisty ścieżek jak w temp-clean).
Każda operacja uprzywilejowana trafia do lokalnego dziennika audytu.

---

## 3. Macierz: moduły × uprawnienia × OS

Legenda: ✔ wymagane, (✔) opcjonalne/degradowalne, − nie dotyczy.

### Folder 1 — Dane | Pliki
| Moduł | fs-user | fs-system | fs-scan | pkg | fda | Inne |
|---|---|---|---|---|---|---|
| Czyszczenie Temp | ✔ | (✔) system temp | − | − | (✔) mac cache chronione | |
| Szukanie dużych plików | ✔ | − | ✔ | − | (✔) | |
| Szukanie duplikatów | ✔ | − | ✔ | − | (✔) | |
| Niszczarka plików | ✔ | − | − | − | − | krytyczny: własna warstwa potwierdzeń; na SSD komunikat o ograniczeniach nadpisywania |
| Usuwanie metadanych | ✔ | − | − | − | − | |
| Czyszczenie Xcode (mac) | ✔ | − | − | − | − | |
| Odchudzanie macOS | ✔ | − | − | − | ✔ | Mail/Messages = kontenery TCC |
| Cache pakietów (Linux) | − | ✔ | − | ✔ | − | apt/pacman root; flatpak user |
| Logi systemd (Linux) | − | ✔ | − | − | − | vacuum journala systemowego = root |

### Folder 2 — System
| Moduł | autostart-user | autostart-system | svc | boot | disk-smart | restore-point | Inne |
|---|---|---|---|---|---|---|---|
| Mapa dysków | − | − | − | − | − | − | fs-user + fs-scan |
| Menadżer autostartu | ✔ | (✔) | − | − | − | − | Win: rejestr HKCU/HKLM |
| Monitor zdrowia | − | − | − | − | (✔) SMART | − | podstawa (CPU/RAM) bez uprawnień |
| WinSxS (Win) | − | − | − | − | − | ✔ auto | fs-system + DISM (admin) |
| Menedżer usług (Win) | − | − | ✔ | − | − | ✔ auto | |
| Bloatware (Win) | − | − | − | − | − | ✔ auto | admin (PowerShell/Appx) |
| Time Machine (mac) | − | − | − | − | − | − | fda + root (tmutil) |
| Wersje jądra (Linux) | − | − | − | ✔ | − | − | pkg + blokada aktywnego jądra |
| Edytor GRUB (Linux) | − | − | − | ✔ | − | − | obowiązkowy backup configu przed zapisem |

### Folder 3 — Bezpieczeństwo
| Moduł | fs-user | fda | secrets | net |
|---|---|---|---|---|
| Higiena przeglądarek | ✔ (wykrycie czy przeglądarka działa) | (✔) Safari | − | − |
| Vault | ✔ | − | ✔ | (✔) audyt HIBP |

### Folder 4 — Aplikacje
| Moduł | pkg | fs-system | Inne |
|---|---|---|---|
| Winget (Win) | ✔ (user scope bez admina) | − | machine-scope → admin |
| Uninstaller | ✔ | ✔ resztki | Win: rejestr HKLM (admin); Linux: apt/pacman remove (root); mac: /Applications (admin) |

### Folder 5 — Custom
Moduły użytkownika deklarują capabilities w manifeście przy instalacji ("Zgoda U*" z mapy myśli =
ekran z listą żądanych dostępów). Bez deklaracji → broker odrzuca każde żądanie uprzywilejowane.

---

## 4. Broker uprawnień per OS

Jeden mały, audytowalny komponent uprzywilejowany na system. Rdzeń rozmawia z nim tym samym
protokołem JSON co z sidecarami. Moduły NIE mają do niego bezpośredniego dostępu.

| | Linux | Windows | macOS |
|---|---|---|---|
| Forma | helper wywoływany przez `pkexec` + plik polityki polkit | usługa Windows (SYSTEM) z named pipe | SMAppService daemon z XPC |
| Instalacja ("Pełny") | onboarding: 1× hasło admina instaluje politykę | onboarding: 1× UAC instaluje usługę | onboarding: 1× hasło admina rejestruje daemon; potem kreator FDA |
| "Wybiórczy" | `pkexec` przy każdej akcji (lub `auth_admin_keep` = pamięta w sesji) | UAC przy pierwszej akcji w sesji (elevated broker żyje do zamknięcia apki) | prompt admin przy akcji; FDA i tak ręcznie |
| Zakres | wykonuje wyłącznie operacje z zamkniętego katalogu (np. `clean_system_paths`, `vacuum_journal`, `edit_grub`) — nigdy "wykonaj dowolne polecenie" | jw. | jw. |

Kluczowe: broker ma **zamknięty katalog operacji** z własną walidacją (jak whitelist w temp-clean),
a nie ogólne "uruchom polecenie jako root". To jest nasza główna granica bezpieczeństwa.

---

## 5. Mapowanie na poziomy dostępu z mapy myśli

**Pełny** (onboarding):
1. zgoda zbiorcza z listą WSZYSTKICH capabilities i opisem po ludzku,
2. instalacja brokera (1 prompt admina),
3. macOS: kreator FDA (otwieramy panel ustawień, czekamy na nadanie, weryfikujemy),
4. efekt: doinstalowanie modułu nigdy nie pyta i nie restartuje — dokładnie jak w mapie myśli.

**Wybiórczy** (onboarding): tylko `fs-user`/`secrets` (nic nie wymagają). Przy instalacji modułu
z capability wymagającą podniesienia → ekran "ten moduł wymaga: X, Y [opis]" → zgoda → ewentualna
instalacja brokera (tu możliwy restart aplikacji — komunikujemy to PRZED, jak w mapie myśli).

**Stan uprawnienia** (per capability, trzymany w pliku stanu rdzenia):
`niepotrzebne → wymagane-nienadane → nadane → odrzucone` (+ `nadane-sesyjnie` na Linux/Win w trybie wybiórczym).
UI: sekcja **Ustawienia → Dostępy** z listą, statusami i przyciskiem "napraw" przy każdym.

**Macierz restartów:**
| Zdarzenie | Restart |
|---|---|
| Instalacja modułu (Pełny) | brak |
| Instalacja modułu bez podniesienia (Wybiórczy) | brak |
| Pierwsza instalacja brokera (Wybiórczy) | restart aplikacji |
| Zmiana poziomu dostępu Wybiórczy→Pełny | restart aplikacji |
| Operacje `boot` (GRUB, jądro) | zalecany restart systemu (komunikat po operacji) |

---

## 6. Zmiany w kodzie, które z tego wynikają (kolejność wdrożenia)

1. **Rozszerzenie manifestu modułu** (`module.json` + `data/modules.ts`): pole `capabilities`
   per OS. Manifest = jedyne źródło prawdy o tym, czego moduł może żądać.
2. **Rejestr uprawnień w rdzeniu** (Rust): enum capabilities, plik stanu nadań, komenda
   `get_permissions` / `request_permissions` dla frontendu.
3. **Broker Linux** najpierw (nasza maszyna testowa): katalog operacji + polityka polkit +
   ścieżka "Wybiórczy" przez pkexec. Windows/macOS jako szkielety z jasnym błędem "not implemented".
4. **Onboarding**: krok poziomu dostępu podpinamy do realnej instalacji brokera (Pełny) /
   pominięcia (Wybiórczy). Ekran zgód per moduł przy instalacji w trybie wybiórczym.
5. **Ustawienia → Dostępy**: widok stanu + naprawa.
6. Dopiero potem wracamy do kodowania modułów — każdy nowy moduł zaczyna od wpisu w macierzy
   (sekcja 3) i deklaracji w manifeście; moduły dotykające `fs-system`/`svc`/`boot` używają brokera.

Zasady niezmienne: podgląd przed każdą destrukcją; backup przed `boot`; auto punkt przywracania
przed operacjami krytycznymi na Windows; dziennik audytu operacji uprzywilejowanych; moduł widzi
tylko swoje zadeklarowane capabilities.
