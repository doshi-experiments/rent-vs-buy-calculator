#!/usr/bin/env bash
# Builds dist/ from scratch. Everything in dist/ is generated — never edit it by hand.
set -e

BUILD=$(date -u +%Y%m%d%H%M%S)
echo "Building $BUILD"

rm -rf dist
mkdir -p dist/fonts

# 1. static shell
cp src/static/manifest.webmanifest src/static/_headers src/static/icon.svg \
   src/static/robots.txt dist/

# 1b. one real HTML file per route, plus a real 404 and the sitemap.
#     Each tab gets its own URL, title, description, canonical and <h1>
#     rather than living in a URL fragment search engines cannot see.
node -e "
const fs=require('fs'), path=require('path');
const cfg=JSON.parse(fs.readFileSync('src/routes.json','utf8'));
const tpl=fs.readFileSync('src/static/index.template.html','utf8');
const {origin, routes, faq}=cfg;
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');
const today=new Date().toISOString().slice(0,10);

// Every page links to every other, so a crawler landing anywhere reaches all six.
const navFor=cur=>routes.filter(r=>r.id!==cur)
  .map(r=>'<a href=\"'+r.path+'\">'+esc(r.h1)+'</a>').join(' &middot; ');

const render=(r)=>{
  const canonical=origin+r.path;
  const app={
    '@context':'https://schema.org','@type':'WebApplication',
    name:r.h1, url:canonical, description:r.description,
    applicationCategory:'FinanceApplication',
    operatingSystem:'Any (runs in the browser)',
    offers:{'@type':'Offer',price:'0',priceCurrency:'USD'},
    featureList:routes.map(x=>x.h1),
    isPartOf:{'@type':'WebSite',name:'Rent vs Buy Calculator',url:origin+'/'}
  };
  // The FAQ answers describe the whole tool, so they belong on the home page only.
  const graph=r.path==='/'
    ? [app,{'@context':'https://schema.org','@type':'FAQPage',mainEntity:faq.map(f=>({
        '@type':'Question',name:f.q,acceptedAnswer:{'@type':'Answer',text:f.a}}))}]
    : [app];
  const jsonld=JSON.stringify(graph.length===1?graph[0]:graph,null,2);
  return tpl
    .replace(/{{TITLE}}/g, esc(r.title))
    .replace(/{{DESCRIPTION}}/g, esc(r.description))
    .replace(/{{CANONICAL}}/g, canonical)
    .replace(/{{ORIGIN}}/g, origin)
    .replace(/{{H1}}/g, esc(r.h1))
    .replace(/{{LEAD}}/g, esc(r.lead))
    .replace(/{{NAVLINKS}}/g, navFor(r.id))
    .replace('{{JSONLD}}', jsonld);
};

for (const r of routes){
  const dir = r.path==='/' ? 'dist' : path.join('dist', r.path.replace(/^\/|\/\$/g,''));
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'), render(r));
}

// Unknown URLs get a real 404 instead of the app shell under a 200, which
// is what Search Console flags as a soft 404.
const nf=render({path:'/404',h1:'Page not found',
  title:'Page not found — Rent vs. Buy Calculator',
  description:'That page does not exist. Pick a calculator below.',
  lead:'That page does not exist on this site.'})
  .replace('<link rel=\"canonical\" href=\"'+origin+'/404\">','<meta name=\"robots\" content=\"noindex\">');
fs.writeFileSync('dist/404.html', nf);

const urls=routes.map(r=>'  <url>\n    <loc>'+origin+r.path+'</loc>\n'+
  '    <lastmod>'+today+'</lastmod>\n    <changefreq>monthly</changefreq>\n'+
  '    <priority>'+(r.path==='/'?'1.0':'0.8')+'</priority>\n  </url>').join('\n');
fs.writeFileSync('dist/sitemap.xml',
  '<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n'+
  '<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n'+urls+'\n</urlset>\n');

console.log('  pages: '+routes.length+' + 404, sitemap: '+routes.length+' urls');
"

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
ROUTE_LIST=$(node -p "JSON.stringify(require('./src/routes.json').routes.map(r=>r.path.replace(/\/+\$/,'')||'/'))")
sed -e "s/__BUILD__/$BUILD/" -e "s|__ROUTES__|$ROUTE_LIST|" src/sw.template.js > dist/sw.js
echo "$BUILD" > dist/version.txt

echo "dist/ ready — $(du -sh dist | cut -f1), $(find dist -type f | wc -l | tr -d ' ') files"
