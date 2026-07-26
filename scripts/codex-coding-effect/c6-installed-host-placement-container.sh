#!/bin/sh
set -eu
umask 022

test "$(uname -s)" = "Linux"
test "$(uname -m)" = "x86_64"
test ! -e /work/goodmemory
test ! -e /work/codex
test ! -e /work/home
test ! -e /work/home-baseline
test ! -e /work/capture
test ! -e /work/instrumented-bin
test ! -e /work/workspace
test ! -e /work/capture.json

mkdir -p \
  /work/goodmemory/consumer \
  /work/goodmemory/package \
  /work/goodmemory/cache \
  /work/codex/consumer \
  /work/codex/cache \
  /work/home \
  /work/capture \
  /work/workspace
: > /work/empty-global.npmrc
: > /work/empty-user.npmrc

export HOME=/work/home
export GOODMEMORY_HOME=/work/home
export GOODMEMORY_BUN_BINARY=/usr/local/bin/bun
export NPM_CONFIG_GLOBALCONFIG=/work/empty-global.npmrc
export NPM_CONFIG_USERCONFIG=/work/empty-user.npmrc
export npm_config_update_notifier=false
export LANG=C.UTF-8
export NO_COLOR=1

cp /closure/consumer/package.json /work/goodmemory/consumer/package.json
cp /closure/consumer/package-lock.json /work/goodmemory/consumer/package-lock.json
cp /closure/package/goodmemory-0.7.0.tgz /work/goodmemory/package/goodmemory-0.7.0.tgz
cp /codex-fixture/package.json /work/codex/consumer/package.json
cp /codex-fixture/package-lock.json /work/codex/consumer/package-lock.json

seeded=0
for archive in /closure/offline/tarballs/*.tgz; do
  test -f "$archive"
  npm cache add "$archive" --cache /work/goodmemory/cache >/dev/null
  seeded=$((seeded + 1))
done
test "$seeded" = 105

cd /work/goodmemory/consumer
npm ci \
  --offline \
  --ignore-scripts \
  --omit=dev \
  --include=optional \
  --install-strategy=hoisted \
  --no-audit \
  --no-fund \
  --cache /work/goodmemory/cache
cmp \
  /closure/consumer/package-lock.json \
  /work/goodmemory/consumer/package-lock.json

npm cache add /codex-tarballs/openai-codex-0.145.0.tgz \
  --cache /work/codex/cache >/dev/null
npm cache add /codex-tarballs/openai-codex-0.145.0-linux-x64.tgz \
  --cache /work/codex/cache >/dev/null

cd /work/codex/consumer
npm ci \
  --offline \
  --ignore-scripts \
  --omit=dev \
  --include=optional \
  --install-strategy=hoisted \
  --no-audit \
  --no-fund \
  --cache /work/codex/cache
cmp \
  /codex-fixture/package-lock.json \
  /work/codex/consumer/package-lock.json

node /runner/canary.mjs
