/*
 * Makes the share image (1200x630) for any story that doesn't have one yet:
 *   node tools/og.mjs            (only missing images)
 *   node tools/og.mjs --all      (rebuild all)
 * Needs Playwright with a Chromium build available (not used by the site build itself).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const all = process.argv.includes("--all");
const root = resolve(".");
const font = (f) => `data:font/woff2;base64,${readFileSync(join(root, "static/assets/fonts", f)).toString("base64")}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join("content/stories", f), "utf8")));
const todo = stories.filter((s) => all || !existsSync(`static/assets/og-${s.slug}.png`));
if (!todo.length) { console.log("All stories already have share images."); process.exit(0); }

const browser = await chromium.launch({ executablePath: existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
for (const st of todo) {
  const line = st.ogLine || st.kicker;
  await page.setContent(`<!doctype html><html><head><style>
@font-face { font-family: AN; font-weight: 700; src: url(${font("archivo-narrow-latin-700-normal.woff2")}); }
@font-face { font-family: NS; font-weight: 400; src: url(${font("noto-sans-latin-400-normal.woff2")}); }
@font-face { font-family: NS; font-weight: 600; src: url(${font("noto-sans-latin-600-normal.woff2")}); }
@font-face { font-family: PM; font-weight: 500; src: url(${font("ibm-plex-mono-latin-500-normal.woff2")}); }
html, body { margin: 0; width: 1200px; height: 630px; background: #17202a; color: #f4f6f8; }
.c { box-sizing: border-box; height: 630px; padding: 56px 64px; display: flex; flex-direction: column; }
.mark { font-family: AN; font-weight: 700; font-size: 44px; } .mark span { color: #6aaedc; }
.kick { margin-top: auto; font-family: PM; font-size: 22px; letter-spacing: .06em; text-transform: uppercase; color: #9aa7b4; }
.kick b { background: #f4f6f8; color: #17202a; padding: 3px 10px; border-radius: 4px; margin-right: 12px; font-weight: 500; }
h1 { font-family: AN; font-weight: 700; font-size: 84px; line-height: 1.02; margin: 18px 0 0; max-width: 1050px; }
p { font-family: NS; font-size: 26px; line-height: 1.35; color: #b6c1cc; margin: 22px 0 0; max-width: 1000px; }
.foot { margin-top: auto; display: flex; justify-content: space-between; font-family: NS; font-size: 26px; }
.live { color: #ec8a72; } .live:before { content: ""; display: inline-block; width: 14px; height: 14px; border-radius: 50%; background: #ec8a72; margin-right: 12px; }
.url { color: #6aaedc; }
</style></head><body><div class="c">
<div class="mark">Un<span>owned</span></div>
<div class="kick"><b>${esc(st.region || "")}</b>Story tracker</div>
<h1>${esc(st.title)}</h1>
<p>${esc(line === st.kicker ? "Timeline, disputed claims and sources, updated as it happens" : line)}</p>
<div class="foot"><span class="live">${esc(st.status)}</span><span class="url">unownednews.com</span></div>
</div></body></html>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `static/assets/og-${st.slug}.png` });
  console.log("Made", `static/assets/og-${st.slug}.png`);
}
await browser.close();
