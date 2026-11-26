# Szablon świata

*[English version →](README.md)*

Kompletny, minimalny motyw („świat”) do skopiowania i przerobienia.
Obsługuje każdy widok, rozstawia cele samouczka, używa wspólnego interfejsu
modułów i trzyma się zasad specyficzności, więc działa od razu po
zarejestrowaniu.

```sh
cp -r templates/world core/src/worlds/mytheme
rm core/src/worlds/mytheme/README*.md
sed -i 's/starter/mytheme/g' core/src/worlds/mytheme/*.css core/src/worlds/mytheme/*.tsx
```

Potem go zarejestruj — dwa pliki, trzy linie — i wybierz w
**Ustawienia → Wygląd**. Pełny opis, lista tokenów i zasady są w
[Pisaniu motywu](../../docs/pl/writing-a-theme.md).
