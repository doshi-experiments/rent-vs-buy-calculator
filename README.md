# Rent vs Buy — Lower Mainland

A self-contained rent-versus-buy calculator for Metro Vancouver and the wider Lower Mainland. No backend, no accounts, no analytics — every calculation runs in your browser, and nothing you type ever leaves the device.

Installs as an app on a phone and a laptop, works with no signal once installed, and every set of inputs is a shareable link.

---

## Deploy it

The repo is connected to Cloudflare Pages. **Push to `main` and it deploys** — usually live in about a minute. Check progress under Workers & Pages → your project → Deployments.

### Cloudflare build settings

If you're wiring this up fresh, or something looks wrong:

| Setting | Value |
|---|---|
| Framework preset | None |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | *(leave blank)* |
| Node version | 18 or newer |

`dist/` is **not** in the repo — it's generated on every build. Don't commit it.

### Rolling back

Deployments → find a good one → **Rollback to this deployment**. Instant, and it doesn't touch your Git history.

## Install it as an app

### iPhone / iPad

Open the site in **Safari** (this does not work in Chrome on iOS), tap **Share → Add to Home Screen**. You get an icon, a full-screen app with no browser chrome, and offline access.

### Android

Open in Chrome. You'll get an **Install app** prompt, or use **⋮ → Add to Home screen**.

### macOS

- **Safari** — File → Add to Dock
- **Chrome / Edge** — ⋮ → Cast, save & share → Install page as app

### Windows

- **Chrome / Edge** — the install icon appears in the address bar, or ⋮ → Apps → Install this site as an app

Once installed it launches from Spotlight, the Start menu, or the dock like anything else, in its own window.

---

## Sharing scenarios

Change any input and the address bar updates to match. Only the values you changed are stored, so links stay short:

```
https://yoursite.pages.dev/#p=1250000&sr=2600&h=7
```

That's a $1.25M place, $2,600 suite, 7-year horizon. Everything else stays at its default.

The **Copy link** button at the top right copies the current view. Text it to yourself and it opens on your phone with exactly those numbers — which is the closest thing to sync you need when there's no server involved.

Because only non-default values are written, links made today keep working if the calculator gains new inputs later. Anything missing from the link falls back to its default.

**Reset** clears both the inputs and the URL.

---

## Why HTTPS matters here

Service workers — the thing that makes this work offline and installable — only run in a "secure context." That means HTTPS, or `localhost`.

A static host gives you this for free. If you ever move it to a home server on plain `http://192.168.x.x`, it will still load, but phones will refuse to install it properly and it will stop working the moment you leave your wifi. If you want to self-host and keep offline support, put it behind [Tailscale Serve](https://tailscale.com/kb/1312/serve) or any reverse proxy with a real certificate.

---

## Working on it locally

Needs Node 18+.

```bash
npm install
npm run build      # regenerates dist/ from scratch
npm run serve      # preview at http://localhost:8099
```

Preview on `localhost` specifically — service workers only run in a secure context, so that's where offline behaviour actually works.

### Where things live

```
src/App.jsx            the whole app, including the model
src/main.jsx           entry point, registers the service worker
src/sw.template.js     offline cache; __BUILD__ is stamped at build time
src/fonts.css          @font-face rules
src/tw.css             Tailwind entry
src/static/            index.html, manifest, icon.svg, _headers
src/static/icons.b64.json   PNG icons, base64-encoded
build.sh               produces dist/
```

**The repo deliberately contains no binary files.** Fonts are copied out of the `@ibm/plex-*` npm packages at build time, and the PNG icons are decoded from `src/static/icons.b64.json`. That keeps diffs readable and lets any tool that only writes text — including Claude — maintain the whole project.

To change the icon, edit `src/static/icon.svg`, then regenerate the PNGs:

```bash
node -e "
const sharp=require('sharp'),fs=require('fs');
const sizes={'icon-192.png':192,'icon-512.png':512,'icon-maskable-512.png':512,'apple-touch-icon.png':180,'favicon.png':32};
(async()=>{const out={};for(const[n,s]of Object.entries(sizes))out[n]=(await sharp('src/static/icon.svg').resize(s,s).png().toBuffer()).toString('base64');
fs.writeFileSync('src/static/icons.b64.json',JSON.stringify(out,null,0));})();
"
```

(`npm i -D sharp` first; it's not a normal dependency because icons rarely change.)

### The model

`simulate()` in `src/App.jsx` is the entire calculation. The BC-specific rules sit just above it as separate functions: `bcPTT`, `cmhcPct`, `minDownPct`, `homeOwnerGrant`, and `monthlyRate` for semi-annual compounding.

If you add an input, give it a short code in the `KEYS` map so it survives in shared links. Only values that differ from the defaults get written to the URL, so old links keep working when new inputs appear.

## Optional: Docker

Included for completeness, though a static host is simpler:

```bash
docker compose up -d      # http://localhost:8099
```

Read the note at the top of the `Dockerfile` first — plain HTTP costs you the offline install.

---

## A reminder about the numbers

Defaults reflect Metro Vancouver in July 2026 — roughly a $1.45M detached benchmark, a 4.24% five-year fixed, 0.36% property tax, $3,200 rent and a $1,900 suite. Those move. The rate and the appreciation assumption are worth revisiting before you lean on any answer.

The result is most sensitive to home appreciation, and that input is a guess about the future rather than a fact about the present. The sensitivity strip is there for that reason: at 1% appreciation instead of 3%, the default scenario flips from strongly favouring buying to strongly favouring renting. Treat the headline number as one scenario among several, not a verdict.

This is a model, not financial advice.
