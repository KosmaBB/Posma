#!/usr/bin/env bash
# Builds the modules that belong on this system and copies each binary into
# core/src-tauri/binaries/<module>-<target-triple>, the naming Tauri's
# externalBin sidecar resolution requires.
#
# Which modules belong here comes from each module.json's "platforms" field,
# so a macOS build does not carry the GRUB editor and a Linux one does not
# carry Time Machine. Brokers have no manifest — one per system, matched by
# name.
#
# Usage: sync-sidecars.sh [debug|release] [--universal]
#
#   --universal   macOS only. Builds every module for both Intel and Apple
#                 silicon and joins them with lipo, so one bundle runs on
#                 either machine. Without it only the host architecture is
#                 built, which is what `tauri dev` needs and is much faster.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
host_triple="$(rustc -vV | sed -n 's/^host: //p')"

profile="debug"
universal="no"
for arg in "$@"; do
    case "$arg" in
        debug|release) profile="$arg" ;;
        --universal)   universal="yes" ;;
        *) echo "nieznany argument: $arg" >&2; exit 1 ;;
    esac
done

case "$(uname -s)" in
    Linux)  host_os="linux" ;;
    Darwin) host_os="macos" ;;
    MINGW*|MSYS*|CYGWIN*) host_os="windows" ;;
    *) echo "nieznany system: $(uname -s)" >&2; exit 1 ;;
esac

if [ "$universal" = "yes" ] && [ "$host_os" != "macos" ]; then
    echo "--universal działa tylko na macOS" >&2
    exit 1
fi

MAC_TARGETS=(x86_64-apple-darwin aarch64-apple-darwin)

# Which triples each module gets built for.
if [ "$universal" = "yes" ]; then
    targets=("${MAC_TARGETS[@]}")
else
    targets=("$host_triple")
fi

cargo_build_flag=""
if [ "$profile" = "release" ]; then
    cargo_build_flag="--release"
fi

# A missing target produces a linker error several minutes in; checking up
# front costs nothing and says what to run.
for t in "${targets[@]}"; do
    if [ "$t" != "$host_triple" ] && ! rustup target list --installed | grep -qx "$t"; then
        echo "Brakuje celu $t. Uruchom: rustup target add $t" >&2
        exit 1
    fi
done

binaries_dir="$repo_root/core/src-tauri/binaries"
mkdir -p "$binaries_dir"

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

# Where cargo leaves a binary. Cargo omits the target directory level when
# building for the host without an explicit --target.
built_path() {
    local target="$1" name="$2"
    if [ "$target" = "$host_triple" ] && [ "$universal" = "no" ]; then
        echo "$repo_root/target/$profile/$name"
    else
        echo "$repo_root/target/$target/$profile/$name"
    fi
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

    for target in "${targets[@]}"; do
        echo "Building module: $module_name ($profile, $target)"
        target_flag=""
        if [ "$target" != "$host_triple" ] || [ "$universal" = "yes" ]; then
            target_flag="--target $target"
        fi
        cargo build -p "$module_name" $cargo_build_flag $target_flag \
            --manifest-path "$repo_root/Cargo.toml"

        src_bin="$(built_path "$target" "$module_name")"
        dest_bin="$binaries_dir/$module_name-$target"
        if [ -f "$src_bin.exe" ]; then
            cp "$src_bin.exe" "$dest_bin.exe"
        else
            cp "$src_bin" "$dest_bin"
            chmod +x "$dest_bin"
        fi
        echo "  -> $dest_bin"
    done

    # One binary carrying both architectures. Tauri looks for this name when
    # building --target universal-apple-darwin; the per-architecture copies
    # above stay so `tauri dev` on either machine still resolves.
    if [ "$universal" = "yes" ]; then
        fat="$binaries_dir/$module_name-universal-apple-darwin"
        lipo -create -output "$fat" \
            "$binaries_dir/$module_name-x86_64-apple-darwin" \
            "$binaries_dir/$module_name-aarch64-apple-darwin"
        chmod +x "$fat"
        echo "  -> $fat (universal)"
    fi

    built=$((built + 1))
done

echo "Gotowe: $built zbudowanych, $skipped pominiętych (system: $host_os, cele: ${targets[*]})"
