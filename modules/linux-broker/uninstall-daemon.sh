#!/usr/bin/env bash
# Reverses install-daemon.sh: stops+disables the service and removes the
# installed binary, unit file, owner-uid file and socket. After this,
# core/src-tauri/src/broker.rs automatically falls back to per-call pkexec
# (it tries the daemon socket first, pkexec second) — no code changes
# needed on either side of installing/uninstalling.
#
# Usage: sudo ./uninstall-daemon.sh
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
    echo "Uruchom przez sudo: sudo $0" >&2
    exit 1
fi

systemctl disable --now posma-broker.service 2>/dev/null || true
rm -f /etc/systemd/system/posma-broker.service
rm -f /opt/posma/linux-broker
rmdir /opt/posma 2>/dev/null || true
rm -f /etc/posma/broker-owner-uid
rmdir /etc/posma 2>/dev/null || true
rm -f /run/posma-broker.sock
systemctl daemon-reload

echo "Usunięto posma-broker.service i powiązane pliki."
