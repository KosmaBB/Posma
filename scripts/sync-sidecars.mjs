#!/usr/bin/env node
// Builds the modules that belong on this system and copies each binary into
// core/src-tauri/binaries/posma-<module>-<target-triple>, the naming Tauri's
// externalBin sidecar resolution requires. The prefix is because a Linux
// package installs sidecars into /usr/bin, where a bare `vault` or
// `metadata` would collide with other packages' commands.
//
// Node rather than bash because Node is already required to build the app,
// on every system: on Windows `bash` in a script usually resolves to WSL,
// which would build the Linux modules.
//
// Which modules belong here comes from each module.json's "platforms" field,
// so a macOS build does not carry the GRUB editor and a Linux one does not
// carry Time Machine. Brokers have no manifest — one per system, matched by
// name.
//
// Usage: node scripts/sync-sidecars.mjs [debug|release] [--universal]
//
//   --universal   macOS only. Builds every module for both Intel and Apple
//                 silicon and joins them with lipo, so one bundle runs on
//                 either machine. Without it only the host architecture is
//                 built, which is what `tauri dev` needs and is much faster.
import { execFileSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const read = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' })
const fail = (message) => {
  console.error(message)
  process.exit(1)
}

let profile = 'debug'
let universal = false
for (const arg of process.argv.slice(2)) {
  if (arg === 'debug' || arg === 'release') profile = arg
  else if (arg === '--universal') universal = true
  else fail(`nieznany argument: ${arg}`)
}

const hostOs = { linux: 'linux', darwin: 'macos', win32: 'windows' }[process.platform]
if (!hostOs) fail(`nieznany system: ${process.platform}`)
if (universal && hostOs !== 'macos') fail('--universal działa tylko na macOS')

const hostTriple = read('rustc', ['-vV']).match(/^host: (.+)$/m)[1].trim()
const targets = universal ? ['x86_64-apple-darwin', 'aarch64-apple-darwin'] : [hostTriple]

// A missing target produces a linker error several minutes in; checking up
// front costs nothing and says what to run.
const foreign = targets.filter((t) => t !== hostTriple)
if (foreign.length) {
  const installed = read('rustup', ['target', 'list', '--installed']).split(/\r?\n/)
  for (const t of foreign) if (!installed.includes(t)) fail(`Brakuje celu ${t}. Uruchom: rustup target add ${t}`)
}

const binariesDir = join(repoRoot, 'core/src-tauri/binaries')
mkdirSync(binariesDir, { recursive: true })

// True when this module is meant to run on the machine doing the build.
function belongsHere(name) {
  if (name.endsWith('-broker')) return name === `${hostOs}-broker`
  const manifest = join(repoRoot, 'modules', name, 'module.json')
  // A module without a manifest is built rather than skipped: guessing that
  // it is unwanted would silently drop it from the bundle.
  if (!existsSync(manifest)) return true
  return JSON.parse(readFileSync(manifest, 'utf8')).platforms.includes(hostOs)
}

const all = readdirSync(join(repoRoot, 'modules'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
const wanted = all.filter(belongsHere)
for (const name of all) if (!wanted.includes(name)) console.log(`Skipping (not for ${hostOs}): ${name}`)

// One cargo invocation per target for the lot: one per module spent about
// four seconds re-resolving the same dependency graph even with nothing to do.
for (const target of targets) {
  console.log(`Building ${wanted.length} modules (${profile}, ${target})`)
  run('cargo', [
    'build',
    ...wanted.flatMap((m) => ['-p', m]),
    ...(profile === 'release' ? ['--release'] : []),
    ...(target !== hostTriple || universal ? ['--target', target] : []),
    '--manifest-path',
    join(repoRoot, 'Cargo.toml'),
  ])
}

// Where cargo leaves a binary. Cargo omits the target directory level when
// building for the host without an explicit --target.
const builtPath = (target, name) =>
  target === hostTriple && !universal ? join(repoRoot, 'target', profile, name) : join(repoRoot, 'target', target, profile, name)

for (const name of wanted) {
  for (const target of targets) {
    const src = builtPath(target, name)
    const exe = existsSync(`${src}.exe`) ? '.exe' : ''
    const dest = join(binariesDir, `posma-${name}-${target}${exe}`)
    copyFileSync(src + exe, dest)
    if (!exe) chmodSync(dest, 0o755)
  }

  // One binary carrying both architectures. Tauri looks for this name when
  // building --target universal-apple-darwin; the per-architecture copies
  // above stay so `tauri dev` on either machine still resolves.
  if (universal) {
    const fat = join(binariesDir, `posma-${name}-universal-apple-darwin`)
    run('lipo', ['-create', '-output', fat, ...targets.map((t) => join(binariesDir, `posma-${name}-${t}`))])
    chmodSync(fat, 0o755)
    console.log(`  -> ${fat} (universal)`)
  }
}

console.log(`Gotowe: ${wanted.length} zbudowanych, ${all.length - wanted.length} pominiętych (system: ${hostOs}, cele: ${targets.join(' ')})`)
