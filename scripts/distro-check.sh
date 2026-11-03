#!/usr/bin/env bash
# Runs the Linux modules against the real package manager of each supported
# distribution, inside a throwaway container of it.
#
# This is where destructive success paths are allowed to run — removing a
# package, emptying a cache, taking out an old kernel. docs/building.md
# forbids doing that to your own machine; a container is the disposable
# machine it asks for instead.
#
# Usage: distro-check.sh [--kernels] [--grub] [--build] [--keep-images] [-v] [name ...]
#
#   (default)      detection, package cache, orphans, uninstaller, refusals,
#                  and one request to every module — on every distribution
#   --kernels      also installs real kernels and removes one where that is
#                  supported (apt, dnf); checks the refusal elsewhere
#   --grub         also installs GRUB's tools and checks layout detection,
#                  theme installation and the rollback of a failed rebuild
#   --build        also installs the build dependencies docs/building.md
#                  lists for that family and compiles the workspace there
#   --keep-images  leave pulled images in place (they are removed otherwise)
#   name ...       only distributions whose name contains one of these
#
# Needs docker, and the static target so one build runs on every image
# whatever its libc:  rustup target add x86_64-unknown-linux-musl
#
# What a container cannot show: a boot through the regenerated GRUB menu,
# the polkit prompt, and the window itself. Those need the real system.
set -uo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="x86_64-unknown-linux-musl"
bin_dir="$repo_root/target/$target/debug"

# name | image | expected manager | identity | docker flags
#
# `identity` is "ID:ID_LIKE" written over the image's own os-release. It is
# how a distribution that publishes no container image is stood in for: the
# image it is built from, announcing itself the way the derivative does.
# That exercises detection on the right userland; it is not that
# distribution, and the support table in docs/distributions.md says which
# rows are stand-ins.
#
# `immutable` and `none` are the two honest refusals: an image-based system
# whose packages are not ours to touch, and a package manager POSMA does
# not drive. Rows sharing an image are adjacent so it is pulled once.
#
# `no-webkit` marks a system with no WebKitGTK 4.1 in any of its
# repositories. The modules run there; the window cannot be built. --build
# checks that this is still so instead of failing on it.
DISTROS=(
    # ---- home ----
    "cachyos|cachyos/cachyos:latest|pacman||"
    "linux-mint|linuxmintd/mint22.3-amd64:latest|apt||"
    "debian|debian:13|apt||"
    "mx-linux|debian:13|apt|mx:debian|"
    "ubuntu|ubuntu:26.04|apt||"
    "ubuntu-24.04|ubuntu:24.04|apt||"
    "pop-os|ubuntu:24.04|apt|pop:ubuntu debian|"
    "zorin-os|ubuntu:24.04|apt|zorin:ubuntu debian|"
    "kde-neon|ubuntu:24.04|apt|neon:ubuntu debian|"
    "fedora|fedora:44|dnf||"
    "nobara|fedora:44|dnf|nobara:rhel centos fedora|"
    "bazzite|fedora:44|immutable|bazzite:fedora|--read-only"
    "arch|archlinux:latest|pacman||"
    "endeavouros|archlinux:latest|pacman|endeavouros:arch|"
    "garuda|archlinux:latest|pacman|garuda:arch|"
    "manjaro|manjarolinux/base:latest|pacman||"
    "steamos|ghcr.io/steamdeckhomebrew/holo-base:latest|immutable||--read-only"
    "opensuse-tumbleweed|opensuse/tumbleweed:latest|zypper||"
    "elementary-os|ghcr.io/elementary/docker:stable|apt||"
    "kali|kalilinux/kali-rolling:latest|apt||"
    "nixos|nixos/nix:latest|none||"
    # ---- server ----
    "ubuntu-server-22.04|ubuntu:22.04|apt||"
    "debian-12|debian:12|apt||"
    "almalinux-9|almalinux:9|dnf||no-webkit"
    "rocky-10|rockylinux/rockylinux:10|dnf||"
    # ---- outside the four families: must degrade, not break ----
    "void|ghcr.io/void-linux/void-glibc:latest|none||"
    "alpine|alpine:latest|none||"
)

# Every module that runs on Linux and builds without a C toolchain. The
# vault is the one left out: it compiles SQLite.
MODULES=(system-info temp-clean big-files duplicates disk-map shredder metadata browser-hygiene
    health-monitor autostart desktop-theme grub-editor journald-trim kernel-mgr pkg-cache
    uninstaller linux-broker)

kernels=no grub=no build=no keep=no verbose=no
filters=()
for arg in "$@"; do
    case "$arg" in
        --kernels) kernels=yes ;;
        --grub) grub=yes ;;
        --build) build=yes ;;
        --keep-images) keep=yes ;;
        -v) verbose=yes ;;
        -*) echo "nieznany argument: $arg" >&2; exit 2 ;;
        *) filters+=("$arg") ;;
    esac
done

if ! rustup target list --installed | grep -qx "$target"; then
    echo "Brakuje celu $target. Uruchom: rustup target add $target" >&2
    exit 2
fi
package_flags=()
for m in "${MODULES[@]}"; do package_flags+=(-p "$m"); done
echo "Building ${#MODULES[@]} modules ($target)"
cargo build --target "$target" "${package_flags[@]}" --manifest-path "$repo_root/Cargo.toml" || exit 2

scratch="$(mktemp -d)"
cid=""
cleanup() {
    [ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1
    rm -rf "$scratch"
}
trap cleanup EXIT

pass=0 fail=0
ok() {
    pass=$((pass + 1))
    [ "$verbose" = yes ] && echo "    ok    $1"
    return 0
}
bad() {
    fail=$((fail + 1))
    echo "    FAIL  $1"
    [ -n "${2:-}" ] && echo "          ${2:0:600}"
    return 0
}
note() { echo "    note  $1"; }
has() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else bad "$1 — expected: $3" "$2"; fi; }
lacks() { if [[ "$2" != *"$3"* ]]; then ok "$1"; else bad "$1 — unexpected: $3" "$2"; fi; }
num() { sed -n "s/.*\"$1\":\([0-9][0-9]*\).*/\1/p" <<<"$2" | head -1; }

as_root() { timeout 1500 docker exec -u 0:0 "$cid" sh -c "$1"; }
# One request line in, one response line out — the protocol every module
# and the broker speak. $1 is who asks: the broker runs as root, the
# modules as an ordinary account.
ask() { printf '%s\n' "$3" | timeout 600 docker exec -i -u "$1" -e HOME=/home/tester "$cid" "/posma/$2" 2>&1 | head -c 400000; }
user() { ask 1000:1000 "$@"; }
broker() { ask 0:0 linux-broker "$1"; }

# Installs tree by name and jq as a dependency nothing needs: one package
# the uninstaller must list, one orphan the cleanup must find. (Not nano:
# Debian ranks it "important", and the uninstaller rightly hides those.)
prepare_packages() {
    case "$1" in
        apt) as_root 'rm -f /etc/apt/apt.conf.d/docker-clean; export DEBIAN_FRONTEND=noninteractive
                apt-get update -qq && apt-get install -y -qq --no-install-recommends jq tree && apt-mark auto jq' ;;
        # A container image may ship its whole base system marked as
        # dependencies (Manjaro's does). An installed system does not, so
        # what the image came with is marked as wanted first.
        pacman) as_root '(pacman-key --init && pacman-key --populate) >/dev/null 2>&1
                shipped=$(pacman -Qdtq); [ -z "$shipped" ] || pacman -D --asexplicit $shipped >/dev/null
                pacman -Syu --noconfirm && pacman -S --noconfirm --needed --asdeps jq && pacman -S --noconfirm --needed tree' ;;
        dnf) as_root 'dnf install -y jq tree && { dnf mark dependency jq -y 2>/dev/null || dnf mark remove jq; }' ;;
        zypper) as_root 'zypper -n install jq tree && echo jq >> /var/lib/zypp/AutoInstalled' ;;
    esac >"$scratch/prepare.log" 2>&1
}

check_packages() {
    local manager="$1" scan apps before after other hint

    # The image as shipped, before anything is installed: whatever it
    # reports as orphans has to be a list of names and nothing else.
    scan="$(user pkg-cache '{"cmd":"scan"}')"
    lacks "orphan list holds only package names" "$(grep -o '"orphans":\[[^]]*\]' <<<"$scan")" ' '
    # Where the image marks its base system as dependencies, sweeping
    # "orphans" would take the system with it. pacman holds its own
    # packages back; the broker must come away having removed nothing.
    if [ "$manager" = pacman ] && [[ "$scan" == *'"base"'* ]]; then
        has "a base system listed as orphans is not swept away" "$(broker '{"op":"pkg_autoremove","source":"pacman"}')" '"success":false'
        if as_root 'pacman -Q base >/dev/null 2>&1'; then ok "base system is still installed"; else bad "base system is still installed"; fi
    fi

    if ! prepare_packages "$manager"; then
        bad "could not install the test packages (mirror or network?)" "$(tail -3 "$scratch/prepare.log")"
        return
    fi

    scan="$(user pkg-cache '{"cmd":"scan"}')"
    has "orphan is reported" "$scan" '"jq"'
    before="$(num cache_bytes "$scan")"
    if [ "${before:-0}" -gt 0 ]; then ok "cache is measured ($before B)"; else note "this image empties its own cache after every transaction — nothing to measure"; fi

    apps="$(user uninstaller '{"cmd":"list_apps"}')"
    has "explicit package is listed under $manager" "$(grep -o '"id":"tree"[^}]*' <<<"$apps")" "\"source\":\"$manager\""
    lacks "dependency is not listed" "$apps" '"id":"jq"'
    for core in glibc bash systemd "$manager"; do lacks "core package $core is not offered" "$apps" "\"id\":\"$core\""; done

    hint="$(user health-monitor '{"cmd":"smart","device":"/dev/sda"}')"
    case "$manager" in
        apt) has "install hint" "$hint" 'sudo apt install smartmontools' ;;
        pacman) has "install hint" "$hint" 'sudo pacman -S smartmontools' ;;
        *) has "install hint" "$hint" "sudo $manager install smartmontools" ;;
    esac

    other=apt
    [ "$manager" = apt ] && other=pacman
    has "another system's manager is refused" "$(broker "{\"op\":\"pkg_cache_clean\",\"source\":\"$other\"}")" 'odmowa'
    has "flag-like package name is refused" "$(broker "{\"op\":\"pkg_remove\",\"source\":\"$manager\",\"id\":\"--force\"}")" 'nieprawid'

    has "broker removes a package" "$(broker "{\"op\":\"pkg_remove\",\"source\":\"$manager\",\"id\":\"tree\"}")" '"success":true'
    lacks "removed package is gone" "$(user uninstaller '{"cmd":"list_apps"}')" '"id":"tree"'
    has "broker removes orphans" "$(broker "{\"op\":\"pkg_autoremove\",\"source\":\"$manager\"}")" '"success":true'
    lacks "orphans are gone" "$(user pkg-cache '{"cmd":"scan"}')" '"jq"'
    has "broker empties the cache" "$(broker "{\"op\":\"pkg_cache_clean\",\"source\":\"$manager\"}")" '"success":true'
    after="$(num cache_bytes "$(user pkg-cache '{"cmd":"scan"}')")"
    if [ "${before:-0}" -eq 0 ]; then :
    elif [ "${after:-$before}" -lt "$before" ]; then ok "cache shrank ($before -> $after B)"
    else bad "cache shrank" "before=$before after=$after"; fi
}

check_kernels() {
    local manager="$1" pair old new scan
    case "$manager" in
        apt) pair="$(as_root 'export DEBIAN_FRONTEND=noninteractive
                vs=$(apt-cache search --names-only "^linux-image-[0-9][0-9a-z.+~-]*-(amd64|generic)$" | cut -d" " -f1 | grep -v -e unsigned -e dbg -e cloud -e "-rt-" -e "$(uname -r)" | sort -V)
                old=$(echo "$vs" | head -1); new=$(echo "$vs" | tail -1)
                # One after the other, older first, as updates arrive on a real
                # system: Debian points /vmlinuz at whichever was installed
                # last, and that one is locked along with the highest version.
                for k in $old $new; do apt-get install -y -qq --no-install-recommends $k >/dev/null 2>&1; done; echo "$old $new"' | tail -1)" ;;
        dnf) pair="$(as_root 'vs=$(dnf repoquery kernel-core --qf "%{version}-%{release}\n" 2>/dev/null | grep . | sort -V | uniq)
                old=$(echo "$vs" | head -1); new=$(echo "$vs" | tail -1); arch=$(uname -m)
                dnf install -y --setopt=install_weak_deps=False kernel-core-$old kernel-core-$new >/dev/null 2>&1; echo "kernel-core-$old.$arch kernel-core-$new.$arch"' | tail -1)" ;;
        pacman) as_root 'pacman -S --noconfirm --needed linux >/dev/null 2>&1'; pair="linux linux" ;;
        zypper) as_root 'zypper -n install --no-recommends kernel-default >/dev/null 2>&1'; pair="kernel-default kernel-default" ;;
    esac
    old="${pair%% *}" new="${pair##* }"
    scan="$(user kernel-mgr '{"cmd":"scan"}')"
    has "installed kernel is listed" "$scan" "\"package\":\"$new"
    has "unknown kernel is refused" "$(broker '{"op":"remove_kernel","package":"linux-image-0.0.0-none"}')" '"success":false'

    if [ "$manager" = pacman ] || [ "$manager" = zypper ]; then
        has "scan says why nothing is removable" "$scan" '"removal_unavailable":"'
        local listed
        listed="$(grep -o "\"package\":\"$new[^\"]*" <<<"$scan" | head -1 | cut -d'"' -f4)"
        has "broker refuses where kernels do not accumulate" "$(broker "{\"op\":\"remove_kernel\",\"package\":\"$listed\"}")" '"success":false'
        return
    fi
    if [ "$old" = "$new" ]; then
        note "only one kernel version in this repository — removal of an older one not exercised"
    else
        has "older kernel is listed" "$scan" "\"package\":\"$old\""
        has "newest kernel is locked" "$(grep -o "\"package\":\"$new\"[^}]*" <<<"$scan")" '"is_latest":true'
        has "broker refuses the newest" "$(broker "{\"op\":\"remove_kernel\",\"package\":\"$new\"}")" 'najnowsze'
        has "broker removes the older one" "$(broker "{\"op\":\"remove_kernel\",\"package\":\"$old\"}")" '"success":true'
        lacks "removed kernel is gone" "$(user kernel-mgr '{"cmd":"scan"}')" "\"package\":\"$old\""
    fi
    has "the last kernel cannot be removed" "$(broker "{\"op\":\"remove_kernel\",\"package\":\"$new\"}")" '"success":false'
}

check_grub() {
    local manager="$1" dir=/boot/grub scan write
    # Only where the image really has none: on Ubuntu the kernel packages
    # installed by --kernels bring GRUB's defaults file with them.
    if ! as_root 'test -f /etc/default/grub'; then
        has "no GRUB, and the editor says so" "$(user grub-editor '{"cmd":"scan"}')" '"unavailable":"'
    fi
    # /etc/default/grub is written by the installer on Debian and Fedora
    # rather than shipped in a package, so a container has to supply it.
    local defaults='[ -f /etc/default/grub ] || printf "GRUB_DEFAULT=0\nGRUB_TIMEOUT=5\n" > /etc/default/grub'
    case "$manager" in
        apt) as_root "export DEBIAN_FRONTEND=noninteractive; apt-get install -y -qq --no-install-recommends grub2-common >/dev/null 2>&1; $defaults; mkdir -p /boot/grub" ;;
        pacman) as_root "pacman -S --noconfirm --needed grub >/dev/null 2>&1; $defaults; mkdir -p /boot/grub" ;;
        dnf) dir=/boot/grub2; as_root "dnf install -y grub2-tools >/dev/null 2>&1; $defaults; mkdir -p /boot/grub2" ;;
        zypper) dir=/boot/grub2; as_root "zypper -n install --no-recommends grub2 >/dev/null 2>&1; $defaults; mkdir -p /boot/grub2" ;;
    esac
    scan="$(user grub-editor '{"cmd":"scan"}')"
    has "GRUB is found" "$scan" '"unavailable":null'
    has "themes directory is $dir/themes" "$scan" "\"themes_dir\":\"$dir/themes\""

    as_root 'mkdir -p /tmp/posma-theme && echo "title-text: test" > /tmp/posma-theme/theme.txt'
    has "theme is installed" "$(broker '{"op":"install_directory","source_dir":"/tmp/posma-theme","dest_name":"posma-test","activate_content":null,"activate_path":null,"keep_backups":3}')" '"success":true'
    if as_root "test -f $dir/themes/posma-test/theme.txt"; then ok "theme landed in $dir/themes"; else bad "theme landed in $dir/themes"; fi

    # grub-mkconfig runs this file as root: a command in it must never
    # reach the disk, let alone run.
    has "a command in the defaults file is refused" "$(broker '{"op":"write_system_file","path":"/etc/default/grub","content":"GRUB_TIMEOUT=$(touch /tmp/posma-ran)\n","keep_backups":3}')" 'odmowa'
    if as_root 'test -e /tmp/posma-ran'; then bad "nothing was run"; else ok "nothing was run"; fi

    # A container has no disk for grub-probe to find, so the rebuild is
    # expected to fail here — which is the rollback path, run with this
    # distribution's own tool. If it succeeds, the new value must be there.
    local original
    original="$(as_root 'cat /etc/default/grub')"
    write="$(broker '{"op":"write_system_file","path":"/etc/default/grub","content":"GRUB_DEFAULT=0\nGRUB_TIMEOUT=7\n","keep_backups":3}')"
    if [[ "$write" == *'"success":true'* ]]; then
        has "config is written" "$(as_root 'cat /etc/default/grub')" 'GRUB_TIMEOUT=7'
        note "menu rebuild succeeded inside the container"
    else
        has "failed rebuild is reported as rolled back" "$write" 'przywr'
        if [ "$(as_root 'cat /etc/default/grub')" = "$original" ]; then ok "previous config is back"; else bad "previous config is back" "$(as_root 'cat /etc/default/grub')"; fi
    fi
    if as_root 'ls /var/backups/posma/grub/backup.* >/dev/null 2>&1'; then ok "backup was taken first"; else bad "backup was taken first"; fi
}

# The dependency lists here are the ones docs/building.md gives — this is
# what keeps that page true.
check_build() {
    local manager="$1" name="$2" flags="$3" deps
    if [ "$flags" = "no-webkit" ]; then
        as_root 'dnf install -y -q epel-release >/dev/null 2>&1; dnf config-manager --set-enabled crb >/dev/null 2>&1'
        has "WebKitGTK 4.1 is still not packaged here" "$(as_root 'dnf -q provides "pkgconfig(webkit2gtk-4.1)" 2>&1')" 'No matches found'
        note "no WebKitGTK 4.1 in this distribution or EPEL — the modules run, the window cannot be built"
        return
    fi
    case "$manager" in
        apt) deps='export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq --no-install-recommends libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev build-essential curl wget file libssl-dev libxdo-dev' ;;
        pacman) deps='pacman -Syu --noconfirm --needed webkit2gtk-4.1 base-devel curl wget file openssl appmenu-gtk-module libappindicator-gtk3 librsvg xdotool' ;;
        # RHEL and its rebuilds carry WebKitGTK 4.1 in EPEL, not in the
        # distribution itself; Fedora has no EPEL and needs none.
        dnf) deps='[ -f /etc/fedora-release ] || { dnf install -y epel-release && dnf config-manager --set-enabled crb; }
                dnf install -y webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel gcc gcc-c++ make' ;;
        # By capability: the package was webkit2gtk3-devel and is now
        # webkitgtk3-devel, and the name it provides did not change.
        zypper) deps='zypper -n install "pkgconfig(webkit2gtk-4.1)" libopenssl-devel curl wget file libappindicator3-1 librsvg-devel gcc gcc-c++ make' ;;
    esac
    if ! as_root "$deps" >"$scratch/deps.log" 2>&1; then
        bad "build dependencies install" "$(grep -iE 'error|unable|no match|not found|nothing provides' "$scratch/deps.log" | tail -4)"
        return
    fi
    ok "build dependencies install"
    has "WebKitGTK 4.1 is present" "$(as_root 'pkg-config --modversion webkit2gtk-4.1 2>&1')" '.'
    note "WebKitGTK $(as_root 'pkg-config --modversion webkit2gtk-4.1 2>&1'), glibc $(as_root 'ldd --version 2>&1 | head -1' | grep -o '[0-9.]*$')"
    # The host's toolchain, mounted read-only and run as the host user so
    # nothing in the checkout or in ~/.cargo ends up owned by root.
    if timeout 3000 docker exec -u "$(id -u):$(id -g)" -e HOME=/tmp -e CARGO_HOME=/cargo \
        -e CARGO_TARGET_DIR="/src/target/distro-check/$name" \
        -e PATH="/toolchain/bin:/usr/local/bin:/usr/bin:/bin" -w /src "$cid" \
        cargo build --workspace --locked >"$scratch/build.log" 2>&1; then
        ok "workspace compiles and links"
    else
        bad "workspace compiles and links" "$(grep -E '^error|not found|cannot find' "$scratch/build.log" | head -5)"
    fi
    rm -rf "$repo_root/target/distro-check/$name"
}

run_distro() {
    local name="$1" image="$2" manager="$3" identity="$4" flags="$5" scan
    local run_args=(-d --entrypoint "" -v "$bin_dir:/posma:ro")
    if [ -n "$identity" ]; then
        printf 'NAME="%s"\nID=%s\nID_LIKE="%s"\n' "$name" "${identity%%:*}" "${identity#*:}" >"$scratch/os-release-$name"
        run_args+=(-v "$scratch/os-release-$name:/etc/os-release:ro")
    fi
    if [ "$flags" = "--read-only" ]; then
        run_args+=(--read-only --tmpfs /tmp --tmpfs /run --tmpfs "/home/tester:uid=1000,gid=1000")
    fi
    if [ "$build" = yes ]; then
        local toolchain
        toolchain="$(rustc --print sysroot)"
        run_args+=(-v "$repo_root:/src" -v "$toolchain:/toolchain:ro" -v "${CARGO_HOME:-$HOME/.cargo}:/cargo")
    fi

    cid="$(docker run "${run_args[@]}" "$image" sleep 86400 2>"$scratch/run.log")" || {
        bad "container starts" "$(cat "$scratch/run.log")"
        cid=""
        return
    }
    # An account for uid 1000 where the image has none: dnf looks its own
    # user up by name and will not run for a bare number.
    as_root 'grep -q "^[^:]*:[^:]*:1000:" /etc/passwd || echo "tester:x:1000:1000::/home/tester:/bin/sh" >> /etc/passwd
             mkdir -p /home/tester && chown 1000:1000 /home/tester' 2>/dev/null

    # One request to every module: whatever the system, each must answer.
    local probe
    for probe in 'system-info {"cmd":"get_info"}' 'system-info {"cmd":"profile"}' 'temp-clean {"cmd":"scan"}' 'big-files {"cmd":"scan"}' \
        'duplicates {"cmd":"scan"}' 'disk-map {"cmd":"scan"}' 'browser-hygiene {"cmd":"scan"}' \
        'health-monitor {"cmd":"snapshot"}' 'health-monitor {"cmd":"list_disks"}' 'autostart {"cmd":"scan"}' \
        'desktop-theme {"cmd":"scan"}' 'grub-editor {"cmd":"scan"}' 'journald-trim {"cmd":"usage"}' \
        'kernel-mgr {"cmd":"scan"}' 'uninstaller {"cmd":"list_apps"}' 'uninstaller {"cmd":"scan"}'; do
        has "${probe%% *} answers ${probe#* }" "$(user "${probe%% *}" "${probe#* }")" '"ok":true'
    done
    has "broker reports its capabilities" "$(broker '{"op":"capabilities"}')" '"os":"linux"'

    scan="$(user pkg-cache '{"cmd":"scan"}')"
    case "$manager" in
        none | immutable)
            has "no package manager is claimed" "$scan" '"manager":null'
            if [ "$manager" = immutable ]; then has "says the system is immutable" "$scan" 'niemutowalny'
            else has "says the manager is not one it drives" "$scan" 'Nie rozpoznano'; fi
            has "broker refuses package work" "$(broker '{"op":"pkg_cache_clean","source":"apt"}')" '"success":false'
            has "broker refuses kernel work" "$(broker '{"op":"remove_kernel","package":"linux"}')" '"success":false'
            has "kernel list explains itself" "$(user kernel-mgr '{"cmd":"scan"}')" '"removal_unavailable":"'
            has "GRUB editor explains itself" "$(user grub-editor '{"cmd":"scan"}')" '"unavailable":"'
            ;;
        *)
            has "manager is detected as $manager" "$scan" "\"manager\":\"$manager\""
            has "profile names the family $manager" "$(user system-info '{"cmd":"profile"}')" "\"family\":\"$manager\""
            # A family os-release declares outranks the user's answer, for
            # the modules exactly as for the broker.
            local other=apt
            [ "$manager" = apt ] && other=pacman
            has "a declared family is not overridden" \
                "$(printf '%s\n' '{"cmd":"profile"}' | timeout 60 docker exec -i -u 1000:1000 -e HOME=/home/tester \
                    -e POSMA_PKG_MANAGER="$other" "$cid" /posma/system-info 2>&1)" "\"family\":\"$manager\""
            check_packages "$manager"
            [ "$kernels" = yes ] && check_kernels "$manager"
            [ "$grub" = yes ] && check_grub "$manager"
            [ "$build" = yes ] && check_build "$manager" "$name" "$flags"
            ;;
    esac

    docker rm -f "$cid" >/dev/null 2>&1
    cid=""
}

wanted() {
    [ "${#filters[@]}" -eq 0 ] && return 0
    local f
    for f in "${filters[@]}"; do [[ "$1" == *"$f"* ]] && return 0; done
    return 1
}

selected=()
for row in "${DISTROS[@]}"; do wanted "${row%%|*}" && selected+=("$row"); done

summary=()
total_fail=0
declare -A pulled_here=()
for i in "${!selected[@]}"; do
    IFS='|' read -r name image manager identity flags <<<"${selected[$i]}"
    echo "== $name  ($image${identity:+, as ${identity%%:*}}${flags:+, $flags})"
    docker image inspect "$image" >/dev/null 2>&1 || pulled_here["$image"]=1
    pass=0 fail=0
    if docker pull -q "$image" >/dev/null 2>"$scratch/pull.log"; then
        run_distro "$name" "$image" "$manager" "$identity" "$flags"
    else
        bad "image is pulled" "$(tail -1 "$scratch/pull.log")"
    fi
    echo "   $pass passed, $fail failed"
    summary+=("$(printf '%-22s %-10s %3d ok %3d failed' "$name" "$manager" "$pass" "$fail")")
    total_fail=$((total_fail + fail))

    # Drop the image once the last row using it is done — together they are
    # several times what a development machine has spare.
    next_image=""
    [ $((i + 1)) -lt "${#selected[@]}" ] && next_image="$(cut -d'|' -f2 <<<"${selected[$((i + 1))]}")"
    if [ "$keep" = no ] && [ -n "${pulled_here[$image]:-}" ] && [ "$next_image" != "$image" ]; then
        docker rmi "$image" >/dev/null 2>&1
    fi
done

echo
printf '%s\n' "${summary[@]}"
[ "$total_fail" -eq 0 ]
