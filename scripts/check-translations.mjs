#!/usr/bin/env node
// Checks translation files against core/src/i18n/pl.json, which holds every key.
//
//   node scripts/check-translations.mjs                 every file in core/src/i18n, and the template
//   node scripts/check-translations.mjs path/de.json    one file of your own
//   node scripts/check-translations.mjs --write-template
//                                                      rebuild templates/translation/template.json from en.json
//
// Exits 1 when a file would show wrong text. A key a community file lacks is
// only listed: POSMA shows the English text there instead.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'core/src/i18n')
const templatePath = join(root, 'templates/translation/template.json')
const FORMS = new Set(['zero', 'one', 'two', 'few', 'many', 'other'])
const read = (file) => JSON.parse(readFileSync(file, 'utf8'))
const reference = read(join(dir, 'pl.json'))

function template() {
  const en = read(join(dir, 'en.json'))
  const text = { ...en, 'language.name': 'The name of your language, written in it: Deutsch, Español, Français' }
  return JSON.stringify(text, null, 2) + '\n'
}

if (process.argv[2] === '--write-template') {
  writeFileSync(templatePath, template())
  console.log(`wrote ${templatePath}`)
  process.exit(0)
}

/** The {names} a text fills in, across all its plural forms. */
function names(entry) {
  const texts = typeof entry === 'string' ? [entry] : Object.values(entry)
  return new Set(texts.flatMap((text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1])))
}

function problemsIn(file) {
  const code = basename(file, '.json')
  const errors = []
  const untranslated = []
  try {
    Intl.getCanonicalLocales(code)
  } catch {
    errors.push(`the file name must be a language code, such as de.json or pt-BR.json (not "${code}")`)
  }
  let catalog
  try {
    catalog = read(file)
  } catch (e) {
    return { errors: [...errors, `not valid JSON: ${e.message}`], untranslated }
  }
  for (const key of Object.keys(reference)) if (!(key in catalog)) untranslated.push(key)
  for (const [key, entry] of Object.entries(catalog)) {
    if (!(key in reference)) {
      errors.push(`${key}: POSMA has no such key (a typo, or a key that was removed)`)
      continue
    }
    if (typeof entry === 'object' && entry !== null && !Array.isArray(entry)) {
      if (typeof entry.other !== 'string') errors.push(`${key}: plural forms need an "other" form`)
      for (const [form, text] of Object.entries(entry)) {
        if (!FORMS.has(form)) errors.push(`${key}: "${form}" is not a plural form (zero, one, two, few, many, other)`)
        else if (typeof text !== 'string' || text.trim() === '') errors.push(`${key}.${form}: empty`)
      }
    } else if (typeof entry !== 'string') {
      errors.push(`${key}: must be text, or an object of plural forms`)
      continue
    } else if (entry.trim() === '') {
      errors.push(`${key}: empty — translate it, or delete the line to show the English text`)
    }
    const want = names(reference[key])
    const got = names(entry)
    for (const name of want) if (!got.has(name)) errors.push(`${key}: {${name}} is missing`)
    for (const name of got) if (!want.has(name)) errors.push(`${key}: {${name}} is not something POSMA fills in`)
  }
  // English is what every other language falls back to, so it must be whole.
  if (code === 'en') errors.push(...untranslated.map((key) => `missing: ${key}`))
  return { errors, untranslated: code === 'en' ? [] : untranslated }
}

const args = process.argv.slice(2)
const files = args.length
  ? args
  : readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'pl.json').map((f) => join(dir, f))

let failed = false
for (const file of files) {
  const { errors, untranslated } = problemsIn(file)
  failed ||= errors.length > 0
  console.log(`${errors.length ? 'FAIL' : 'ok  '} ${file}`)
  for (const e of errors) console.log(`       ${e}`)
  if (untranslated.length) console.log(`       ${untranslated.length} not translated yet, shown in English: ${untranslated.join(', ')}`)
}

if (!args.length) {
  let current = ''
  try {
    current = readFileSync(templatePath, 'utf8')
  } catch {}
  const fresh = current === template()
  failed ||= !fresh
  console.log(`${fresh ? 'ok  ' : 'FAIL'} ${templatePath}`)
  if (!fresh) console.log('       out of date with en.json: run node scripts/check-translations.mjs --write-template')
}

process.exit(failed ? 1 : 0)
