#!/bin/sh
# Rebuilds tts-worker.js from src/tts-worker.src.js. Only needed if the voice
# engine itself is changed. Usage: sh build.sh /path/to/folder-with-node_modules
# (that folder needs: npm install --ignore-scripts kokoro-js@1.2.1 @breezystack/lamejs esbuild)
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; N="$1"
echo 'export default {};' > "$N/empty.js"; cp "$HERE/src/tts-worker.src.js" "$N/entry.js"
(cd "$N" && node_modules/.bin/esbuild entry.js --bundle --format=esm --platform=browser --minify --legal-comments=none --alias:path=./empty.js --alias:fs/promises=./empty.js --outfile="$HERE/tts-worker.js")
rm -f "$N/entry.js" "$N/empty.js"
