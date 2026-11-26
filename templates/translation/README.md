# Translation template

*[Polska wersja →](README.pl.md)*

`template.json` holds every key of POSMA's interface with its English text.
Copy it under your language's code and translate the values:

```sh
cp templates/translation/template.json core/src/i18n/de.json
node scripts/check-translations.mjs core/src/i18n/de.json
```

Then choose the language in **Settings → Language**. The format, plural
forms, style and how to send it in are in
[Writing a translation](../../docs/writing-a-translation.md).

The template is generated from `core/src/i18n/en.json`; do not edit it by
hand. After a change to `en.json`, rebuild it with
`node scripts/check-translations.mjs --write-template`.
