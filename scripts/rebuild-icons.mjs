/* Rasterises src/static/icon.svg into src/static/icons.b64.json.
 *
 * The repo deliberately holds no binaries — the PNGs live as base64 in a JSON
 * blob and build.sh decodes them. That is fine until the icon's colours
 * change, at which point the PNGs are stale and there is no way to regenerate
 * them by hand.
 *
 * There is no image library on this machine, but there is a browser, so
 * Chrome does the rasterising over CDP — the same mechanism test/e2e.mjs
 * already uses to drive the app.
 *
 *   node scripts/rebuild-icons.mjs
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/* name -> [size, maskable]. A maskable icon must keep its art inside the
   safe zone, so it is drawn smaller on a full-bleed ground. */
const ICONS = {
  "favicon.png": [32, false],
  "apple-touch-icon.png": [180, false],
  "icon-192.png": [192, false],
  "icon-512.png": [512, false],
  "icon-maskable-512.png": [512, true],
};

const svg = readFileSync(join(ROOT, "src/static/icon.svg"), "utf8");

const page = (size, maskable) => `<!doctype html><meta charset="utf-8">
<style>
  html,body{margin:0;padding:0;background:transparent}
  body{width:${size}px;height:${size}px;overflow:hidden}
  svg{display:block;width:${maskable ? Math.round(size * 0.72) : size}px;
      height:${maskable ? Math.round(size * 0.72) : size}px;
      margin:${maskable ? Math.round(size * 0.14) : 0}px}
  .bleed{position:fixed;inset:0;background:#FFFFFF;z-index:-1}
</style>
${maskable ? '<div class="bleed"></div>' : ""}
${svg}`;

const PORT = 8811 + Math.floor(Math.random() * 300);
const server = createServer((req, res) => {
  const m = /^\/(\d+)-(0|1)$/.exec(req.url);
  res.writeHead(200, { "content-type": "text/html" });
  res.end(m ? page(Number(m[1]), m[2] === "1") : "no");
});
await new Promise((r) => server.listen(PORT, r));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(os.tmpdir(), "ms-icon-"));
const chrome = spawn(CHROME, ["--headless=new", "--disable-gpu", "--no-first-run",
  "--no-default-browser-check", "--hide-scrollbars",
  "--remote-debugging-port=" + (PORT + 1), "--user-data-dir=" + profile, "about:blank"],
  { stdio: "ignore" });

let wsUrl = null;
for (let i = 0; i < 80 && !wsUrl; i++) {
  await sleep(250);
  try {
    const list = await (await fetch(`http://127.0.0.1:${PORT + 1}/json/list`)).json();
    const t = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl);
    if (t) wsUrl = t.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => {
  const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });

await send("Page.enable");

const out = {};
for (const [name, [size, maskable]] of Object.entries(ICONS)) {
  await send("Emulation.setDeviceMetricsOverride",
    { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/${size}-${maskable ? 1 : 0}` });
  await sleep(400);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  out[name] = shot.data;
  console.log(`  ${name.padEnd(24)} ${size}x${size}${maskable ? "  maskable" : ""}  ` +
              `${(Buffer.from(shot.data, "base64").length / 1024).toFixed(1)} KB`);
}

writeFileSync(join(ROOT, "src/static/icons.b64.json"), JSON.stringify(out, null, 0) + "\n");
console.log("src/static/icons.b64.json rewritten");

ws.close(); chrome.kill(); server.close();
process.exit(0);
