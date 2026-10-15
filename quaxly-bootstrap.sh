#!/bin/sh
set -eu
cd /home/container
# Keep the manual-update launcher after its one-time migration.
if [ -f .astral-updates/state.json ] && [ -f scripts/manual-update.js ] && [ -f .astral-updates/manual-launcher-v2 ]; then
  exec node index.js
fi
stage=$(mktemp -d /home/container/.astral-update.XXXXXX)
trap 'rm -rf "$stage"' EXIT HUP INT TERM
echo 'GitHubからBotを取得中...'
curl -fsSL --retry 2 --connect-timeout 15 --max-time 30 https://api.github.com/repos/astraldao/astral_discord/git/ref/heads/main -o "$stage/head.json"
commit=$(node --input-type=module -e 'import {readFileSync} from "node:fs"; const sha=JSON.parse(readFileSync(process.argv[1],"utf8")).object?.sha; if(!/^[a-f0-9]{40}$/.test(sha??""))process.exit(1); console.log(sha)' "$stage/head.json")
curl -fL --retry 2 --connect-timeout 15 --max-time 300 --speed-time 45 --speed-limit 1024 \
  "https://codeload.github.com/astraldao/astral_discord/tar.gz/$commit" \
  -o "$stage/source.tar.gz"
mkdir "$stage/source"
tar --no-same-owner -xzf "$stage/source.tar.gz" --strip-components=1 -C "$stage/source"
test -f "$stage/source/package-lock.json"
test -f "$stage/source/src/index.js"
node --check "$stage/source/index.js"
node --check "$stage/source/scripts/supervisor.js"
# Copy only application files; keep host secrets, settings and voice runtime.
for item in src scripts dictionaries assets test; do
  cp -R "$stage/source/$item" .
done
for item in index.js package.json package-lock.json setup-voicevox.sh start.sh README.md .gitignore .env.example; do
  cp "$stage/source/$item" "$item"
done
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
sh setup-voicevox.sh
printf '%s\n' "$commit" > .astral-commit
# An explicit first install/migration selects the downloaded source, preserving saved data.
# Recover an interrupted migration before resetting its source pointer.
node --input-type=module - "$commit" <<'JS'
import {readState,writeState} from './scripts/auto-update.js';
import {recoverTransition} from './scripts/supervisor.js';
import {writeFile} from 'node:fs/promises';
const root=process.cwd(),old=await recoverTransition(root,await readState(root));
await writeState(root,{sha:process.argv[2],release:null,previous:old.release,failed:null});
await writeFile('.astral-updates/manual-launcher-v2','2\n',{mode:0o600});
JS
echo 'Botを起動します。'
node index.js
