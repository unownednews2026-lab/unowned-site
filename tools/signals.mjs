/* News signals: no AI, no cost. For each story, asks Google News (RSS) for headlines published since the story was last
   updated, and writes a short table to the "News signals" issue. The news desk reads it first and spends its searches
   only on stories with fresh headlines (or stale ones), which keeps it well inside the Claude plan.
   Usage (in GitHub Actions): node tools/signals.mjs > signals.md */
import { readFileSync, readdirSync, existsSync } from "node:fs";
const watch = existsSync("tools/watch.json") ? JSON.parse(readFileSync("tools/watch.json", "utf8")) : {};
const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));
const unent = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const rows = [];
for (const s of stories) {
  const q = watch[s.slug] || s.title.replace(/'s\b/g, "");
  const since = Date.parse(s.updatedAt || s.updated);
  let fresh = [], err = "";
  try {
    const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=en-US&gl=US&ceid=US:en`;
    const xml = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
    for (const it of xml.split("<item>").slice(1)) {
      const title = unent((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
      const pub = Date.parse((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
      if (pub > since) fresh.push({ title, pub });
    }
  } catch (e) { err = String(e.message || e); }
  fresh.sort((a, b) => b.pub - a.pub);
  const ageH = Math.round((Date.now() - since) / 36e5);
  rows.push({ slug: s.slug, n: fresh.length, ageH, err, top: fresh.slice(0, 3) });
}
const now = new Date().toISOString().slice(0, 16) + "Z";
console.log(`Updated ${now} (automatic, no AI). Headlines on Google News newer than each story's last update.\n`);
console.log("| story | new headlines | story last updated | newest headlines |\n|---|---|---|---|");
for (const r of rows.sort((a, b) => b.n - a.n)) {
  const top = r.err ? `check failed: ${r.err}` : r.top.map((t) => `${new Date(t.pub).toISOString().slice(5, 16).replace("T", " ")}: ${t.title.replace(/\|/g, "/")}`).join("<br>");
  console.log(`| ${r.slug} | ${r.err ? "?" : r.n} | ${r.ageH}h ago | ${top} |`);
}
