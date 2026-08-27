#!/usr/bin/env bash
# Builds dist/ from scratch. Everything in dist/ is generated — never edit it by hand.
set -e

BUILD=$(date -u +%Y%m%d%H%M%S)
echo "Building $BUILD"

rm -rf dist
mkdir -p dist/fonts

# 1. static shell
cp src/static/index.html src/static/manifest.webmanifest src/static/_headers src/static/icon.svg \
   src/static/robots.txt src/static/sitemap.xml dist/

# 2. icons, decoded from the checked-in base64 (keeps the repo free of binaries)
node -e "
const fs=require('fs');
const icons=JSON.parse(fs.readFileSync('src/static/icons.b64.json','utf8'));
for (const [name,b64] of Object.entries(icons)) fs.writeFileSync('dist/'+name, Buffer.from(b64,'base64'));
console.log('  icons: '+Object.keys(icons).length);
"

# 3. fonts, straight from the IBM Plex packages
for fam in Sans Mono Serif; do
  for w in Regular Medium SemiBold; do
    src=$(find node_modules/@ibm/plex-$(echo $fam | tr 'A-Z' 'a-z') -name "IBMPlex${fam}-${w}-Latin1.woff2" 2>/dev/null | head -1)
    if [ -n "$src" ]; then cp "$src" "dist/fonts/IBMPlex${fam}-${w}.woff2"; else echo "  !! missing IBMPlex${fam}-${w}"; fi
  done
done
echo "  fonts: $(ls dist/fonts | wc -l | tr -d ' ')"

VERSION=$(node -p "require('./package.json').version")
npx esbuild --bundle src/main.jsx --outfile=dist/app.js \
  --jsx=automatic --minify --define:process.env.NODE_ENV='"production"' \
  --define:__APP_VERSION__='"'$VERSION'"' --define:__BUILD_STAMP__='"'$BUILD'"' \
  --log-level=warning
npx tailwindcss -c tailwind.config.js -i src/tw.css -o dist/tw.out.css --minify 2>/dev/null
cat src/fonts.css dist/tw.out.css > dist/app.css
rm -f dist/tw.out.css

# 5. service worker, stamped so returning visitors pick up the new version
sed "s/__BUILD__/$BUILD/" src/sw.template.js > dist/sw.js
echo "$BUILD" > dist/version.txt

echo "dist/ ready — $(du -sh dist | cut -f1), $(find dist -type f | wc -l | tr -d ' ') files"
