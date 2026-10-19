# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Rent vs. buy calculator (Canada and the US) at rent-vs-buy.rishabhdoshi.com: React 18, Recharts and Tailwind, six tools as six real routes, installable and offline. `README.md` is long and authoritative for the model, routing and deploy. Author commits as `doshi-experiments <311927837+doshi-experiments@users.noreply.github.com>`.

## Never publish PII or sensitive information

Nothing personal or sensitive goes to GitHub, under any circumstances, without Rishabh's direct approval of that specific content. That covers files, commit messages, branch names, pull requests, issues, comments, release notes, screenshots and test fixtures, and it applies even while a repository is private: every repository on this account is public or will be.

- Personal data: names other than Rishabh's public name (household members, pets, friends), email addresses, phone numbers, home addresses, the city or neighbourhood the household lives in, dates of birth, health or care providers.
- Financial data: account or card numbers, balances, real transactions, statements, payees and merchant strings, amounts and dates from real data, which banks or cards are held, anything from bank exports or Actual Budget.
- Secrets and infrastructure: `.env` contents, API keys, tokens, passwords, private hostnames and IP addresses, Tailscale names, Home Assistant entity names and user ids, chat ids.
- Anything copied from a real export, inbox, database or log. A file named "example" or "sample" must be invented, not trimmed from real data.

Commit identity: author and commit only as `doshi-experiments <311927837+doshi-experiments@users.noreply.github.com>`. Run `git config user.email` before the first commit in any checkout, and never put a personal address in a `Co-authored-by` trailer.

Commit messages and pull request text are as public as the code. Describe what changed and why, not the real data that prompted it: no real merchants, amounts, transaction dates, account names or people, even as examples.

Use synthetic fixtures instead. Before every commit and push, check the staged diff, any new untracked files and the message itself for this kind of content. If something looks sensitive, or you are unsure, stop and ask; do not commit it, push it or open a pull request with it. Earlier approval of a different change does not cover this one. Git history is permanent: a leak can only be removed by rewriting history and recreating the repository.

## Commands

```sh
npm ci
npm run build          # ./build.sh → dist/ (not committed): one HTML page per route, sitemap, service worker
npm run serve          # http://localhost:8099; service workers need localhost or HTTPS
```

There is no test framework. The financial models (`simulate`, `simulateRental`, `simulatePrepay`, `comparePayments`) sit between `/* MODEL:START */` and `/* MODEL:END */` in `src/App.jsx` and must stay free of React, the DOM and `window`, so they can be tested by slicing them out:

```sh
sed -n '/MODEL:START/,/MODEL:END/p' src/App.jsx > /tmp/model.js   # append assertions, then
node /tmp/model.js
```

CI builds and re-verifies `src/design-system/release.json`. The design-system repository's `test:calculator` drives all six routes at four widths in both appearances.

## Architecture

- `src/routes.json` is the single source for tabs: `build.sh` renders one page per route and generates `sitemap.xml` from it. Country rules live in the `REGIONS` object in `App.jsx`.
- Colours come from `resolveTokens()` in `palette()` in `App.jsx`. Owning: `buy` (text, `action-link`), `buyLine` (strokes and swatches, `chart-2`), `buyFill` (the apply button, `action-gradient`). Renting: `rent` (`chart-1`, ink). `src/design.css` holds app layout over the shared components.
- The app depends on the committed design-system tarball (also named in the `Dockerfile`) and commits a hashed snapshot in `src/design-system/`. Never edit either; upgrade through the design-system repository's central `npm run rollout`.

## Invariants that are easy to break

- `src/sw.template.js` precaches a fixed list. Every entry must exist in `dist/`: `cache.addAll` rejects on one 404, the new worker never installs, and returning visitors stay on the old version. Update it whenever font or texture files change.
- `build.sh` must copy `src/design-system/fonts/` and `src/design-system/felt/` into `dist/`.
- `#root` must not paint a background, or it hides the shared felt texture on `body`.
- Owning text uses `action-link`; the gradient and `chart-2` are for fills and strokes only.
- Keep the shared `sheet-theme` cookie and `/design-system/prepaint.js` in `<head>` intact.
- The app's own source contains no binaries; icons are base64 in `src/static/icons.b64.json`.
