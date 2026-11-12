#!/bin/bash
# Packs build/Pencil Sketch.app into build/PencilSketch-mac.dmg (app + a shortcut to /Applications).
# Run after: NO_INSTALL=1 ./mac/build.sh
set -euo pipefail
cd "$(dirname "$0")/.."
APP="build/Pencil Sketch.app"
[ -d "$APP" ] || { echo "build the app first: NO_INSTALL=1 ./mac/build.sh" >&2; exit 1; }
STAGE="build/dmg"
rm -rf "$STAGE" build/PencilSketch-mac.dmg
mkdir -p "$STAGE"
cp -R "$APP" "$STAGE/"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "Pencil Sketch" -srcfolder "$STAGE" -ov -format UDZO build/PencilSketch-mac.dmg >/dev/null
rm -rf "$STAGE"
echo "Wrote build/PencilSketch-mac.dmg"
