#!/usr/bin/env bash
# Builds dist/ from scratch. Everything in dist/ is generated — never edit it by hand.
set -e

BUILD=$(date -u +%Y%m%d%H%M%S)
echo "Building $BUILD"

rm -rf dist
mkdir -p dist/fonts

# 1. static shell
cp src/static/index.html src/static/manifest.webmanifest src/static/_headers src/static/icon.svg dist/

# 2. icons, decoded from the checked-in base64 (keeps the repo free of binaries)
node -e "
const fs=require('fs');
const icons=JSON.parse(fs.readFileSync('src/static/icons.b64.json','utf8'));
for (const [name,b64] of Object.entries(icons)) fs.writeFileSync('dist/'+name, Buffer.from(b64,'base64'));
console.log('  icons: '+Object.keys(icons).length);
"

# 3. Feltwork — the shared design system. Emits feltwork.css, the three
#    variable faces, the felt texture and the SVG filter defs into dist/.
if [ -x node_modules/.bin/feltwork ]; then
  FW="node_modules/.bin/feltwork"
elif [ -f ../feltwork/bin/feltwork.mjs ]; then
  FW="node ../feltwork/bin/feltwork.mjs"
else
  echo "  !! feltwork not found — run 'npm install'" >&2; exit 1
fi
$FW build --out dist >/dev/null
echo "  fonts: $(ls dist/fonts | wc -l | tr -d ' ')"

VERSION=$(node -p "require('./package.json').version")
npx esbuild --bundle src/main.jsx --outfile=dist/app.js \
  --jsx=automatic --minify --define:process.env.NODE_ENV='"production"' \
  --define:__APP_VERSION__='"'$VERSION'"' --define:__BUILD_STAMP__='"'$BUILD'"' \
  --log-level=warning
# Tailwind is gone. It was supplying ~30 layout utilities and its Preflight
# reset from a config with no theme; Feltwork's base.css carries the reset and
# App.jsx defines the same class names on the 8px rail. One less build step,
# one less dependency, and the spacing now snaps.
cat dist/feltwork.css > dist/app.css
rm -f dist/feltwork.css

# 5. service worker, stamped so returning visitors pick up the new version
sed "s/__BUILD__/$BUILD/" src/sw.template.js > dist/sw.js
echo "$BUILD" > dist/version.txt

echo "dist/ ready — $(du -sh dist | cut -f1), $(find dist -type f | wc -l | tr -d ' ') files"
