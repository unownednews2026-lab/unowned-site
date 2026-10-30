/* News signals: no AI, no cost. For each story, asks Google News (RSS) for headlines published since the story was last
   updated, and writes a short table to the "News signals" issue. The news desk reads it first and spends its searches
   only on stories with fresh headlines (or stale ones), which keeps it well inside the Claude plan.
   Usage (in GitHub Actions): node tools/signals.mjs > signals.md */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pathToFileURL } from "node:url";

const watch = existsSync("tools/watch.json") ? JSON.parse(readFileSync("tools/watch.json", "utf8")) : {};
const unent = (s) => s.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

/* Google News headlines about a story published after its last update, newest first. Throws if Google News can't be reached. */
export async function headlinesSince(s) {
  const q = watch[s.slug] || s.title.replace(/'s\b/g, "");
  const since = Date.parse(s.updatedAt || s.updated);
  // Search Google News in the story's own country edition, so local established outlets (CBC, The Hindu, News24…) show up.
  const ed = { Canada: ["en-CA", "CA"], India: ["en-IN", "IN"], "South Africa": ["en-ZA", "ZA"], "United Kingdom": ["en-GB", "GB"], Australia: ["en-AU", "AU"] }[s.region] || ["en-US", "US"];
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:2d")}&hl=${ed[0]}&gl=${ed[1]}&ceid=${ed[1]}:en`;
  const xml = await (await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } })).text();
  const fresh = [];
  for (const it of xml.split("<item>").slice(1)) {
    const title = unent((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
    const pub = Date.parse((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
    const link = unent((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "");
    const src = it.match(/<source url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/) || [];
    let domain = ""; try { domain = new URL(src[1] || "").hostname.replace(/^www\./, ""); } catch {}
    if (pub > since) fresh.push({ title, pub, link, outlet: unent(src[2] || ""), domain });
  }
  return fresh.sort((a, b) => b.pub - a.pub);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));
  const rows = [];
  for (const s of stories) {
    let fresh = [], err = "";
    try { fresh = await headlinesSince(s); } catch (e) { err = String(e.message || e); }
    rows.push({ slug: s.slug, n: fresh.length, ageH: Math.round((Date.now() - Date.parse(s.updatedAt || s.updated)) / 36e5), err, top: fresh.slice(0, 3) });
  }
  console.log(`Updated ${new Date().toISOString().slice(0, 16)}Z (automatic, no AI). Headlines on Google News newer than each story's last update.\n`);
  console.log("| story | new headlines | story last updated | newest headlines |\n|---|---|---|---|");
  for (const r of rows.sort((a, b) => b.n - a.n)) {
    const top = r.err ? `check failed: ${r.err}` : r.top.map((t) => `${new Date(t.pub).toISOString().slice(5, 16).replace("T", " ")}: ${t.title.replace(/\|/g, "/")}`).join("<br>");
    console.log(`| ${r.slug} | ${r.err ? "?" : r.n} | ${r.ageH}h ago | ${top} |`);
  }
}
