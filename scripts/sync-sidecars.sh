#!/usr/bin/env bash
# Builds the modules that belong on this system and copies each binary into
# core/src-tauri/binaries/<module>-<target-triple>, the naming Tauri's
# externalBin sidecar resolution requires.
#
# Which modules belong here comes from each module.json's "platforms" field,
# so a macOS build does not carry the GRUB editor and a Linux one does not
# carry Time Machine. Brokers have no manifest — one per system, matched by
# name.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_triple="$(rustc -vV | sed -n 's/^host: //p')"
profile="${1:-debug}"

case "$(uname -s)" in
    Linux)  host_os="linux" ;;
    Darwin) host_os="macos" ;;
    MINGW*|MSYS*|CYGWIN*) host_os="windows" ;;
    *) echo "nieznany system: $(uname -s)" >&2; exit 1 ;;
esac

cargo_build_flag=""
if [ "$profile" = "release" ]; then
    cargo_build_flag="--release"
fi

mkdir -p "$repo_root/core/src-tauri/binaries"

# True when this module is meant to run on the machine doing the build.
belongs_here() {
    local dir="$1" name="$2"

    case "$name" in
        *-broker) [ "$name" = "${host_os}-broker" ] && return 0 || return 1 ;;
    esac

    local manifest="$dir/module.json"
    # A module without a manifest is built rather than skipped: guessing that
    # it is unwanted would silently drop it from the bundle.
    [ -f "$manifest" ] || return 0

    grep -q "\"$host_os\"" "$manifest"
}

built=0
skipped=0
for module_dir in "$repo_root"/modules/*/; do
    module_name="$(basename "$module_dir")"

    if ! belongs_here "${module_dir%/}" "$module_name"; then
        echo "Skipping (not for $host_os): $module_name"
        skipped=$((skipped + 1))
        continue
    fi

    echo "Building module: $module_name ($profile)"
    cargo build -p "$module_name" $cargo_build_flag --manifest-path "$repo_root/Cargo.toml"

    src_bin="$repo_root/target/$profile/$module_name"
    dest_bin="$repo_root/core/src-tauri/binaries/$module_name-$target_triple"
    if [ -f "$src_bin.exe" ]; then
        cp "$src_bin.exe" "$dest_bin.exe"
    else
        cp "$src_bin" "$dest_bin"
        chmod +x "$dest_bin"
    fi
    echo "  -> $dest_bin"
    built=$((built + 1))
done

echo "Gotowe: $built zbudowanych, $skipped pominiętych (system: $host_os)"
