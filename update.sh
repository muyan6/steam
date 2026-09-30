#!/usr/bin/env bash
# Compatibility entry point: the backend updater stages only server code.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec bash "$ROOT/server/update.sh" "$@"
