#!/bin/bash
# Builds "Pencil Sketch.app" (universal: Apple silicon + Intel) and installs it in /Applications.
# The UI files (web/) are copied into the app, so run this again after every change to web/.
# Needs only swiftc (Xcode command-line tools). No Xcode project, no npm.
#   NO_INSTALL=1 ./mac/build.sh    build into build/ only (used by CI and mac/package.sh)
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="Pencil Sketch"
APP="build/$NAME.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources" build/obj
for arch in arm64 x86_64; do
  swiftc -O -target "$arch-apple-macos12.0" -o "build/obj/PencilSketch-$arch" mac/PencilSketch.swift -framework Cocoa -framework WebKit
done
lipo -create build/obj/PencilSketch-arm64 build/obj/PencilSketch-x86_64 -output "$APP/Contents/MacOS/PencilSketch"
cp mac/Info.plist "$APP/Contents/Info.plist"
cp mac/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp -R web "$APP/Contents/Resources/web"
rm -f "$APP/Contents/Resources/web/blank.html"
find "$APP" -name .DS_Store -delete
codesign --force --deep --sign - "$APP"
echo "Built $APP"
if [ "${NO_INSTALL:-}" = "1" ]; then exit 0; fi
pkill -x PencilSketch 2>/dev/null || true
rm -rf "/Applications/$NAME.app"
cp -R "$APP" "/Applications/$NAME.app"
# let Launchpad / Spotlight / "Open With" notice the new build
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/$NAME.app" 2>/dev/null || true
echo "Installed /Applications/$NAME.app"
