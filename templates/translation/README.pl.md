# Wzór tłumaczenia

*[English version →](README.md)*

`template.json` ma wszystkie klucze interfejsu POSMA z angielskim tekstem.
Skopiuj go pod kodem swojego języka i przetłumacz wartości:

```sh
cp templates/translation/template.json core/src/i18n/de.json
node scripts/check-translations.mjs core/src/i18n/de.json
```

Potem wybierz język w **Ustawienia → Język**. Format, formy liczby mnogiej,
styl i sposób wysłania tłumaczenia opisuje
[Pisanie tłumaczenia](../../docs/pl/writing-a-translation.md).

Wzór powstaje z `core/src/i18n/en.json`; nie edytuj go ręcznie. Po zmianie
`en.json` odbuduj go przez
`node scripts/check-translations.mjs --write-template`.
