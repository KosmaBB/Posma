#!/usr/bin/env bash
# Builds every crate under modules/ and copies its binary into
# core/src-tauri/binaries/<module>-<target-triple>, the naming Tauri's
# externalBin sidecar resolution requires.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target_triple="$(rustc -vV | sed -n 's/^host: //p')"
profile="${1:-debug}"

cargo_build_flag=""
if [ "$profile" = "release" ]; then
    cargo_build_flag="--release"
fi

mkdir -p "$repo_root/core/src-tauri/binaries"

for module_dir in "$repo_root"/modules/*/; do
    module_name="$(basename "$module_dir")"
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
done
