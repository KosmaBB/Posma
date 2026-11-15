# World starter

A complete, minimal theme ("world") to copy and reshape. It handles every
view, places the tour's targets, uses the shared module interface and keeps
the specificity contract, so it runs as soon as it is registered.

```sh
cp -r templates/world core/src/worlds/mytheme
rm core/src/worlds/mytheme/README.md
sed -i 's/starter/mytheme/g' core/src/worlds/mytheme/*.css core/src/worlds/mytheme/*.tsx
```

Then register it — two files, three lines — and pick it in
**Ustawienia → Wygląd**. The full walkthrough, the token list and the rules
are in [Writing a theme](../../docs/writing-a-theme.md).
