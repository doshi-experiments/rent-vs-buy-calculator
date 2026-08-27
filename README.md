# Rent vs Buy — Canada & the United States

A self-contained rent-versus-buy calculator that runs on either country's rules.
Six tabs:

- **Rent vs. buy** — net worth either way over your horizon, after costs and taxes
- **Appreciation calculator** — compound growth between two values
- **Payment comparison** — up to five prices or mortgage amounts against one set of conditions, side by side
- **Prepayment** — extra payments or a target amortization, against the opportunity cost of investing the difference instead
- **Two properties** — two homes compared in full, including suite income and renovations, with the work funded from investments or a line of credit
- **Investment property** — buy and rent out, with up to six units, cap rate, cash-on-cash, DSCR and depreciation

## Canada or the United States

The switch at the top right is not a currency-and-labels swap — the mortgage
mathematics differs, and so does the tax:

| | Canada | United States |
|---|---|---|
| Compounding | semi-annual | monthly |
| Term | 5 years, then renews at a rate you set | fixed for the life of the loan |
| Breaking early | three months' interest | no penalty |
| Mortgage insurance | CMHC, financed into the principal | PMI, monthly, cancels at 78% LTV of the **original** price |
| Minimum down | 5% / 10% tiers, nothing insurable at $1.5M+ | 3% conventional |
| Interest deduction | none | itemized, capped at $750k of acquisition debt |
| Gain on your home | fully exempt | §121: $250k single, $500k joint, after two years |
| Registered accounts | FHSA and the Home Buyers' Plan | not modelled |
| Rental losses | deductible against other income | §469 passive limits, suspended to sale |

Switching country **resets every tab to that country's defaults** — a $1.45M
Vancouver price beside a 6.5% thirty-year fixed is not a scenario anyone wants.
Only the time period and the household carry over, and there is an undo.

Links made before the toggle existed carry no region code, parse as Canada, and
give the number they always gave. A Canadian link is byte-identical to what it
was.

No backend, no accounts, no analytics — every calculation runs in your browser, and nothing you type ever leaves the device.

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

## Routing and SEO

**`src/routes.json` is the single source of truth for the tabs.** It holds
each tab's id, label, URL path, `<h1>`, `<title>`, meta description and
no-JS lead paragraph. `App.jsx` imports it for routing; `build.sh` reads it
to emit one real HTML file per route. Adding a tab means adding one row
there — nothing else needs to know the list.

Treat `path` values as permanent. Changing one orphans every link and every
bit of search ranking pointing at it.

### Why each tab is a real URL

Tabs used to live in the fragment (`#tab=prepay`), which search engines do
not index — six calculators collapsed into one indexable page. Now
`build.sh` renders `src/static/index.template.html` once per route into its
own directory (`dist/prepayment/index.html` and so on), substituting the
`{{...}}` placeholders, so each tab has its own title, description,
canonical and `<h1>`. Old `#tab=` links still work: the app rewrites one to
its path on arrival, keeping the inputs in the hash.

Because those pages are served from subdirectories, every asset reference in
the template is **root-absolute** (`/app.js`, not `app.js`) — a relative one
resolves to `/prepayment/app.js` and 404s. Same reason `main.jsx` registers
`/sw.js` with an explicit root scope.

`not_found_handling` is `"404-page"`, not `"single-page-application"`. The
SPA catch-all answered *every* unknown URL with the app under a `200`, which
Search Console reports as a soft 404; now unknown paths get `dist/404.html`
with a real 404 status, and the app renders a matching not-found view rather
than silently showing the rent-vs-buy tab.

### The `<h1>` is the breadcrumb, not the verdict

Each tab's big headline is a computed figure — "Buying leaves you $225,787
richer" — which changes with every keystroke and contains no keywords, so it
is a `<p>`. The small breadcrumb line above it is the `<h1>`, rendered via
`<Eyebrow as="h1">`. Semantic level and font size are deliberately
unrelated here. There must be exactly one `<h1>` per tab.

### The rest

`robots.txt` lives in `src/static/`; `sitemap.xml` is **generated** by
`build.sh` from `routes.json` with a fresh `lastmod`, so don't hand-edit it.
The service worker caches each route under its own path — serving one shared
shell would give `/prepayment/` the home page's title and canonical.

The social-preview image is `og-image.png`, base64-encoded into
`icons.b64.json` alongside the app icons — the repo's convention for keeping
binaries out of diffs — and decoded into `dist/` at build time. It's a
static 1200×630 card built from the app's own palette and fonts; regenerate
it (any screenshot tool at that resolution) if the tab list or tagline
changes enough to make it stale.

The FAQ JSON-LD in `routes.json` is emitted on the home page only, since its
answers describe the whole tool rather than any one tab.

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

`simulate()` in `src/App.jsx` is the owner-occupier calculation, and
`simulateRental()` beside it is the investment-property one. Everything between
the `/* MODEL:START */` and `/* MODEL:END */` markers is pure and DOM-free, so
it can be sliced out and run in Node — which is how it is tested, there being no
test framework in the repo.

Country rules live in one `REGIONS` object as a profile of small functions:
`monthlyRate`, `transferTax`, `mortgageInsurance`, `minDownPct`, `gainExclusion`
and so on. The model picks a profile once — `const R = REGIONS[p.us ? "us" : "ca"]`
— and never branches on country again. Adding a third region means adding a
profile, not editing the loop.

The region flag is **a boolean, `us`**, and that is deliberate. The state
coercion loop runs every non-boolean field through `num()`, which strips
non-numerics and falls back to `0`; a string `region: "us"` would silently
become `0` and run the entire Canadian model behind US labels. `simulate()`
throws if `p.us` is not a boolean rather than falling back to a default, because
a `REGIONS[p.region] || REGIONS.ca` would turn that coercion bug into quietly
wrong numbers.

The BC rules sit just above as separate functions — `bcPTT`, `cmhcPct`,
`minDownPct`, `homeOwnerGrant`, and `monthlyRate` for semi-annual compounding —
and the profile only references them.

`comparePayments()` drives the payment-comparison tab off the same rules, so a price there gets the same minimum-down check and CMHC premium it would get on the first tab.

The two-property tab runs `simulate()` twice and compares the two `advantage` figures — each property measured against the **same** renting alternative. Comparing the two `buy` figures directly would be wrong: when a home costs more per month than renting, that surplus accrues to the renter's portfolio, so two homes that both cost more than rent would both end with an empty buyer portfolio and the monthly difference between them would vanish from the result. This is why the rent inputs are shared rather than per-property.

The tab's funding model is one pot: **total available cash**. Each property takes its down payment, transfer tax and legal costs out of the pot on day one; the remainder is invested, and the renting alternative invests the whole pot. Renovations are then drawn from the leftover as the work happens — taxed only on gains accrued by each draw, since sales consume basis pro rata — or ride a line of credit at a settable rate, leaving the investments untouched. If the pot doesn't cover closing, the tab says so rather than silently pretending.

Under the hood these are optional `simulate()` parameters (`keepInvested`, `remodelFromPortfolio`, `remodelFromLOC`, `locRatePct`) that default to off, so the other tabs are unchanged.

### The investment tab

`simulateRental()` is a separate model rather than a flag on `simulate()`. The
rent-vs-buy spine routes a monthly surplus between *two household* portfolios;
a rental has no renting household, so the counterfactual is one portfolio seeded
with the cash to close and fed whatever the property costs to carry.

Net operating income is `EGI − OpEx`, **excluding debt service and
depreciation**. Folding the mortgage into operating expenses is the classic
error and it corrupts cap rate, DSCR and cash-on-cash simultaneously.

Depreciation is mandatory in the US (27.5-year straight line, recaptured at 25%
whether or not it was claimed) and optional in Canada, where CCA is off by
default: it comes back as ordinary income at your full marginal rate while the
gain it shelters is only half taxed, and s.1100(11) means it cannot create or
increase a rental loss.

Units follow the `CMP_SLOTS` precedent — six fixed slots, blanks dropping out,
no dynamic add and remove. The "same rent for every unit" toggle **derives**
from unit 1 rather than writing into the other slots, so switching it back
restores the per-unit figures exactly.

### The prepayment tab

`simulatePrepay()` compares two households with the same mortgage and the same
monthly outflow: one sends extra money to the lender and pays the loan off
early, the other pays only the regular amount and invests the difference.
Both finish debt-free by the **original** amortization date — the prepayer
just gets there sooner, then redirects the freed-up payment into the market
for whatever's left of the term.

The comparison only means something if both households spend identically
every month. That budget, `outAt(m)`, is defined off the do-nothing side's
own balance (`investPmtAt`, built first as `investRun`) and never off the
prepaying side's, so nothing downstream can make the two schedules drift
apart — the outflow match is asserted, not merely hoped for. In Canada, where
the payment resets every `ppTermYears` at a new rate, this also gets the
behaviour right: the prepayer's freed-up cash automatically absorbs their own
renewal surplus rather than reverting to whatever a smaller balance would
newly require, which is what actually happens if you decline the lender's
offer of a lower payment at renewal.

The headline is the **hurdle rate** — the annual return above which investing
the extras beats prepaying. It's found by bisecting on the two sides' final
after-tax portfolio values, both of which are cheap to re-evaluate once the
month-by-month schedules are built once. The US mortgage-interest deduction is
modelled opt-in, crediting each side its own refund off its own average
balance (never the difference to one side, which gets the spread right but
the chart levels wrong); the Canadian prepayment privilege is a warning, never
a block, and is exempt for lumps landing on a renewal month, since a payout
made at renewal attracts no penalty at all.

If you add an input, give it a short code in the `KEYS` map so it survives in shared links. Only values that differ from the defaults get written to the URL, so old links keep working when new inputs appear. The open tab travels in the URL too, as `tab=` — handled outside the `KEYS` map, and ignored by parsers that don't know it.

## Optional: Docker

Included for completeness, though a static host is simpler:

```bash
docker compose up -d      # http://localhost:8099
```

Read the note at the top of the `Dockerfile` first — plain HTTP costs you the offline install.

---

## A reminder about the numbers

Canadian defaults reflect Metro Vancouver in July 2026 — roughly a $1.45M detached benchmark, a 4.24% five-year fixed, 0.36% property tax, $3,200 rent and a $1,900 suite. US defaults are a rough national picture: $450k, a 6.5% thirty-year fixed, 1.1% property tax and $2,100 rent. Those move, and the US ones vary far more by state than a single number can carry. The rate and the appreciation assumption are worth revisiting before you lean on any answer.

One US result surprises people and is worth stating plainly: at most prices the
mortgage interest deduction is worth **nothing**. The calculator compares
itemizing against the standard deduction on *both* sides, the renter's as well
as the owner's, and only credits owning with the deduction a renter would not
already have had. Crediting the owner alone is the usual mistake and it invents
$5–8k a year of benefit that does not exist.

The result is most sensitive to home appreciation, and that input is a guess about the future rather than a fact about the present. The sensitivity strip is there for that reason: at 1% appreciation instead of 3%, the default scenario flips from strongly favouring buying to strongly favouring renting. Treat the headline number as one scenario among several, not a verdict.

This is a model, not financial advice.
