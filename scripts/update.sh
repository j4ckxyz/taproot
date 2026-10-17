#!/usr/bin/env sh
# Updates a Node (non-Docker) install to the latest version on the current branch.
# Your data in DATA_DIR is untouched; a backup is taken automatically before any database upgrade.
set -e
cd "$(dirname "$0")/.."
before=$(node -p "require('./package.json').version")
git pull --ff-only
npm ci
npm run build
after=$(node -p "require('./package.json').version")
echo ""
echo "Taproot $before -> $after. Restart the server to finish (e.g. systemctl restart taproot)."
