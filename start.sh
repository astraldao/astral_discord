#!/bin/sh
set -eu
cd "$(dirname "$0")"
npm ci --omit=dev --no-audit --no-fund
exec node index.js
