# Writing a translation

*[Polska wersja →](pl/writing-a-translation.md)*

POSMA keeps the text of its interface in one JSON file per language, in
`core/src/i18n/`. `pl.json` is the original and holds every key. `en.json`
is complete too, and it is what POSMA shows wherever another language has no
text yet. A new language is one more file in that folder: no code, nothing
to register.

> **Today and at 1.0.** A translation is compiled into the app: a file in
> `core/src/i18n/` ships in the next build. The whole interface reads these
> files, numbers included (1,5 GB in Polish, 1.5 GB in English). Two things
> stay as they are: the names of the worlds and looks (Katalog, Gęsto,
> Strumień…), which are names, and the messages the modules write
> themselves (a scan's errors), which are still Polish. Installing community
> translations from inside the app is planned with the community hub.

## Start from the template

```sh
cp templates/translation/template.json core/src/i18n/de.json
```

The file name is the language code: `de.json`, `fr.json`, `es.json`,
`pt-BR.json` for a regional variant. The template holds every key with its
English text, so the app runs the moment the file is there. Translate the
values one by one; anything you have not reached yet still reads in English.

Pick your language in **Settings → Language**. A system already set to that
language gets it on first launch by itself.

## The format

```json
{
  "language.name": "Deutsch",
  "nav.dashboard": "Übersicht",
  "settings.system": "System: {name}",
  "settings.refresh.every": { "one": "Jede Sekunde", "other": "Alle {n} Sekunden" }
}
```

- **The key, on the left, stays as it is.** Only the text on the right is
  yours. Keys are grouped by what they belong to: `nav.*` the navigation,
  `folder.*` the module folders, `risk.*` the risk tags, `module.<id>.name`,
  `.desc` and `.action` each module, `settings.*` the Settings page.
- **`language.name`** is your language's name in your language. It is what
  the language picker shows.
- **`{name}`, `{n}` and the like are filled in by POSMA**: a system's name, a
  count, a path. Keep every one, spelled exactly as in English, and move it
  wherever your grammar needs it.
- **Counts take plural forms.** Where the English has an object instead of
  text, give one entry per plural form your language has. The forms are the
  [CLDR plural categories](https://www.unicode.org/cldr/charts/latest/supplemental/language_plural_rules.html):
  English and German use `one` and `other`; Polish, Czech and Russian also
  `few` and `many`; Arabic all six (`zero`, `one`, `two`, `few`, `many`,
  `other`); Japanese and Chinese only `other`, or plain text. `other` is always
  required. `{n}` is the number itself.
- **A missing line shows the English text.** That is the way to leave
  something for later. An empty `""` is never right: the check rejects it.

## Style

- Speak to the person the way the rest of the app does: directly, briefly,
  in the second person, without exclamation marks.
- Program and product names stay as they are: POSMA, Vault, Winget, GRUB,
  systemd, S.M.A.R.T., Time Machine, apt, pacman, flatpak.
- The risk tags are warnings, and they sit in a small badge: keep *Safe*,
  *Careful* and *Critical* short.
- Module names appear in narrow lists and tiles. Aim for about the length of
  the English.
- Translate from the English. Where you are unsure what a sentence means,
  the Polish file is the original.

## Check it

```sh
node scripts/check-translations.mjs core/src/i18n/de.json
```

It reports a file that is not valid JSON, a key POSMA does not have (a typo,
or a key that was removed), a missing or extra `{placeholder}`, plural forms
that do not exist or lack `other`, and empty text. It also lists the keys
not translated yet. CI runs it on every file in `core/src/i18n/`.

To see the result in the app, run it as [Building and development](building.md)
describes and choose your language in Settings.

## Send it

Open a pull request with your one file. Nothing else needs to change. If a
second speaker of the language read it through, say so in the description.

## Keeping it up to date

New versions add keys. Run the check: keys you have not translated yet show
up in its list, and until you add them POSMA shows them in English. A key
that was removed is reported as one POSMA does not have; delete that line.

## For developers: adding text

- Interface text never goes into code. Add the key to `pl.json` and
  `en.json`, then show it with `t()`:

  ```ts
  import { t } from '../i18n'

  t('settings.access')                     // plain text
  t('settings.system', { name: p.name })   // with a placeholder
  t('settings.refresh.every', { n: 5 })    // plural forms, chosen by n
  ```

- A table outside a component, such as `riskLabel`, reads the language when
  it is created, unless each entry is a getter: `get low() { return t('risk.low') }`.
- Numbers go through `formatNumber(n, options)` from the same module, never
  a fixed locale such as `'pl-PL'`, so the decimal mark follows the language.
- Name keys `area.thing`, with a variant as a third part
  (`module.pkg-cache.name.family`), all lower case.
- After changing `en.json`, rebuild the template:
  `node scripts/check-translations.mjs --write-template`. CI fails while the
  template is out of date.
