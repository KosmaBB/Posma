#!/usr/bin/env bash
# One-time installer for the POSMA privileged broker daemon (Access_plan.md
# §5 "Pełny" — installs once, no repeated pkexec prompts after this). Must
# be run with sudo; only the user who ran it (not root) is ever allowed to
# talk to the installed daemon afterward — see the SO_PEERCRED check in
# src/main.rs, which is the real access control, not file permissions.
#
# Usage: sudo ./install-daemon.sh
#
# Reverse with ./uninstall-daemon.sh — until installed (or after removing),
# core/src-tauri/src/broker.rs falls back to per-call pkexec automatically,
# no code changes needed either way.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Uruchom przez sudo: sudo $0" >&2
    exit 1
fi

if [ -z "${SUDO_USER:-}" ]; then
    echo "Nie wykryto SUDO_USER — uruchom przez 'sudo', nie jako zalogowany root." >&2
    exit 1
fi

owner_uid="$(id -u "$SUDO_USER")"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
broker_bin="$repo_root/target/debug/linux-broker"

if [ ! -x "$broker_bin" ]; then
    echo "Brak $broker_bin — najpierw zbuduj: cargo build -p linux-broker" >&2
    exit 1
fi

echo "Instaluję brokera dla uid=$owner_uid ($SUDO_USER)..."

systemctl stop posma-broker.service 2>/dev/null || true

install -Dm755 "$broker_bin" /opt/posma/linux-broker
install -Dm644 "$repo_root/modules/linux-broker/posma-broker.service" /etc/systemd/system/posma-broker.service
install -d -m755 /etc/posma
echo "$owner_uid" > /etc/posma/broker-owner-uid
chmod 644 /etc/posma/broker-owner-uid

systemctl daemon-reload
systemctl enable --now posma-broker.service

echo "Zainstalowano i uruchomiono posma-broker.service (uid=$owner_uid)."
systemctl status --no-pager posma-broker.service || true
