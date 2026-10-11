#!/bin/sh
set -eu
cd /home/container
stage=$(mktemp -d /home/container/.astral-update.XXXXXX)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
echo 'GitHubからBotを取得中...'
curl -fL --retry 2 --connect-timeout 15 --max-time 300 --speed-time 45 --speed-limit 1024 \
  https://codeload.github.com/astraldao/astral_discord/tar.gz/refs/heads/main \
  -o "$stage/source.tar.gz"
mkdir "$stage/source"
tar --no-same-owner -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/source"
test -f "$stage/source/package-lock.json"
test -f "$stage/source/src/index.js"
# Copy only application files; keep host secrets, settings and voice runtime.
for item in src scripts dictionaries assets test; do
  cp -R "$stage/source/$item" .
done
for item in index.js package.json package-lock.json setup-voicevox.sh start.sh README.md .gitignore .env.example; do
  cp "$stage/source/$item" "$item"
done
npm ci --omit=dev --no-audit --no-fund
sh setup-voicevox.sh
echo 'Botを起動します。'
node index.js
