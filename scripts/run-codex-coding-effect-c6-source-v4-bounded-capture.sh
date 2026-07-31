#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(/usr/bin/dirname -- "$0")" && /bin/pwd -P)
WORKER="$SCRIPT_DIR/codex-coding-effect/c6-source-v4-bounded-activation.ts"
PINNED_BUN="/Users/hjqcan/workspace/GoodMemory-c6-runtime/toolchains/bun-v1.3.12-darwin-aarch64/bun-darwin-aarch64/bun"

if [ "${GOODMEMORY_C6_GITHUB_TOKEN+x}" = "x" ]; then
  exec /usr/bin/env -i \
    GOODMEMORY_C6_GITHUB_TOKEN="$GOODMEMORY_C6_GITHUB_TOKEN" \
    "$PINNED_BUN" \
    --config=/dev/null \
    --no-env-file \
    --no-install \
    --no-addons \
    "$WORKER" "$@"
fi

exec /usr/bin/env -i \
  "$PINNED_BUN" \
  --config=/dev/null \
  --no-env-file \
  --no-install \
  --no-addons \
  "$WORKER" "$@"
