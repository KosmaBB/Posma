# access/

*[English version →](README.md)*

`catalog.json` to jedyne źródło prawdy dla systemu uprawnień.

Zanim powstał ten katalog, te same fakty były zapisane w czterech miejscach
— w katalogu w Rust, w katalogu w TypeScript, w `module.json` każdego modułu
i na liście modułów w interfejsie — i zdążyły się rozjechać. Pięć modułów
figurowało w interfejsie jako proszące o uprawnienia, których ich własny
kod wprost nie używa.

## Co w nim jest

| Sekcja | Odpowiada na pytanie |
|---|---|
| `capabilities` | O co w ogóle można poprosić, co to znaczy prostym językiem i czy wymaga podniesienia uprawnień |
| `modules` | O które uprawnienia może prosić każdy moduł |
| `operations` | Która operacja uprzywilejowana należy do którego modułu i ile kosztuje |

## Kto go czyta

- **Rust** — osadza go przy kompilacji przez `include_str!`, więc
  zniekształcony katalog wykłada build, a nie aplikację.
- **TypeScript** — importuje go bezpośrednio. Interfejs nigdy nie powtarza
  opisu uprawnienia; wyszukuje go.
- **Testy** — `cargo test -p core` porównuje katalog z każdym `module.json`
  na dysku, więc moduł i katalog nie mogą się różnić.

## Zmienianie

Dodanie uprawnienia modułowi oznacza edycję dwóch plików: tego katalogu i
`module.json` tego modułu. Testy nie przejdą, jeśli zmienisz tylko jeden.

To powielenie jest celowe. Manifest modułu musi być samodzielny, bo moduł
napisany przez kogoś innego przychodzi z własnym, a katalog nic o nim nie
wie — katalog obejmuje moduły dostarczane z POSMA, a sprawdzenie pilnuje,
żeby oba zapisy mówiły to samo.

## Po co moduł w ogóle coś deklaruje

Rdzeń odmawia operacji uprzywilejowanej, której moduł nigdy nie
zadeklarował potrzebnego uprawnienia, bez względu na to, co przyznał
użytkownik. Przyznanie `boot` daje edytorowi GRUB pozwolenie na zmianę
konfiguracji rozruchu; nie daje go modułowi, który nigdy o nie nie prosił.
