#!/bin/sh
# Wrapper so the preview tool can launch the Angular dev server without relying on
# a global `npm`/`ng` on PATH (this machine's npm PATH symlink was broken; see README).
set -e
cd "$(dirname "$0")/../angular-app"
exec node_modules/.bin/ng serve --port 4200
