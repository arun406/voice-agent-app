#!/bin/sh
# Copies the built Angular app into the Cordova project's www/ folder.
set -e
cd "$(dirname "$0")/.."

SRC="angular-app/dist/angular-app/browser"
DEST="cordova-app/www"

if [ ! -d "$SRC" ]; then
  echo "Build output not found at $SRC — run 'npm run build' in angular-app first." >&2
  exit 1
fi

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R "$SRC"/. "$DEST"/
echo "Synced $SRC -> $DEST"
