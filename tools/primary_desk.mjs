/* Primary-source desk (free AI, hourly). Reads what the people in our stories publish themselves — government press
   offices, ministries and official bodies, and the movements' own channels — and turns new, relevant items into
   strictly graded, clearly attributed updates. Sources are listed per story in tools/primary_sources.json, and only
   accounts and sites we have confirmed belong to that body are listed ("verified" says how we know).

   GRADING, enforced in code (an AI suggestion can only lower a grade, never raise it):
   - Nothing from a single primary source is ever "confirmed": that needs two independent news reports.
   - Official statement about the body's own action or decision ("the ministry announced…")  → reported
   - Movement's announcement of its own action ("the party says it will march on…")          → reported
   - Any claim about someone else, accusation, figure about events, or allegation             → alleged
   - Photos or video posted by a movement                     → "From the ground", alleged, with what is not verified
   - Deaths, injuries, abuse or accusations against people    → never published automatically: sent to the editor
   Every item says who said it and where ("said in a statement", "said on YouTube"), goes through the same code checks
   as news items (names, numbers, quotes must be in the source), a second AI fact-check, and is reviewed by the editor
   ("desk": "backup"). Items are marked "via": "official" or "social" so the site can label them. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { ungrounded } from "./grounding.mjs";
import { ask, problems as llmProblems, SECOND_CHECK, GITHUB_PROVIDER } from "./llm.mjs";

const DRY = process.argv.includes("--dry");                  // list what would be read, publish nothing
const REPO = process.env.GITHUB_REPOSITORY;
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const say = (m) => console.log(`primary desk: ${m}`);
const now = new Date().toISOString().slice(0, 19) + "Z";
const DAY = 864e5;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const SENSITIVE = /\b(killed|dead|death|deaths|died|dies|murder\w*|rape\w*|sexual|suicide|shot|lynch\w*|injur\w*|wounded|tortur\w*|abuse\w*|accused of|charged with|arrested)\b/i;
const CLAIMWORDS = /\b(accus\w*|alleg\w*|blam\w*|claim\w*|fraud|rigg\w*|theft|chori|lie|lies|lied|conspiracy|illegal|unconstitutional|crackdown|brutal\w*|attack\w*|violat\w*|stole|stolen|fake|false)\b/i;
const unent = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x, t) => unent((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
const get = async (url, ms = 20000) => { const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };

/* Page text: direct, then the free reader service for sites built with scripts. */
async function pageText(url) {
  try { const html = await get(url); const t = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map(unent).filter((x) => x.length > 40).join("\n"); if (t.length > 300) return t.slice(0, 6000); } catch {}
  try { const t = (await get(`https://r.jina.ai/${url}`, 30000)).split("\n").map((x) => x.trim()).filter((x) => x.length > 40 && !/^(Title|URL Source|Published Time|Markdown Content):/.test(x)).join("\n"); return t.slice(0, 6000); } catch { return ""; }
}

/* Each source type returns [{url, title, date, text}] (newest first). */
async function readSource(src) {
  if (src.type === "rss") {
    const xml = await get(src.url);
    return xml.split(/<item[\s>]|<entry[\s>]/).slice(1).map((it) => ({
      url: tag(it, "link") || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
      title: tag(it, "title"), date: new Date(tag(it, "pubDate") || tag(it, "published") || tag(it, "updated") || tag(it, "dc:date") || 0).toISOString(),
      text: tag(it, "description") || tag(it, "content:encoded") || tag(it, "summary") || tag(it, "content"),
    }));
  }
  if (src.type === "youtube") {
    let id = src.channelId;
    if (!id) { const html = await get(`https://www.youtube.com/@${src.handle}`); id = (html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || [])[1]; }
    if (!id) throw new Error("channel id not found");
    const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
    return xml.split("<entry>").slice(1).map((it) => ({ url: (it.match(/<link rel="alternate" href="([^"]+)"/) || [])[1], title: tag(it, "title"), date: tag(it, "published"), text: tag(it, "media:description"), video: true }));
  }
  if (src.type === "sitemap") {
    const xml = await get(src.url);
    return xml.split("<url>").slice(1).map((it) => ({ url: tag(it, "loc"), title: "", date: tag(it, "lastmod") ? new Date(tag(it, "lastmod")).toISOString() : "", text: "" }))
      .filter((x) => x.url && (!src.pathMatch || x.url.includes(src.pathMatch)) && x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  }
  if (src.type === "telegram") {
    const html = await get(`https://t.me/s/${src.channel}`);
    return html.split('class="tgme_widget_message ').slice(1).map((b) => ({
      url: `https://t.me/${(b.match(/data-post="([^"]+)"/) || [])[1] || src.channel}`, title: "",
      date: (b.match(/datetime="([^"]+)"/) || [])[1] || "", text: unent((b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1]),
      video: /tgme_widget_message_(video|photo)/.test(b),
    })).reverse();
  }
  if (src.type === "bluesky") {
    const j = JSON.parse(await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${src.handle}&limit=20`));
    return (j.feed || []).filter((f) => !f.reason).map((f) => ({ url: `https://bsky.app/profile/${src.handle}/post/${f.post.uri.split("/").pop()}`, title: "", date: f.post.record.createdAt, text: f.post.record.text || "", video: !!f.post.embed }));
  }
  if (src.type === "web") {   // a listing page of statements: links whose address matches pathMatch
    const html = await get(src.url), base = new URL(src.url), seen = new Set(), out = [];
    for (const m of html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      let u; try { u = new URL(m[1], base).href; } catch { continue; }
      const title = unent(m[2]);
      if (seen.has(u) || title.length < 20 || (src.pathMatch && !u.includes(src.pathMatch))) continue;
      seen.add(u); out.push({ url: u, title, date: "", text: "" });
    }
    return out.slice(0, 12);
  }
  throw new Error(`unknown source type ${src.type}`);
}

const registry = existsSync("tools/primary_sources.json") ? JSON.parse(readFileSync("tools/primary_sources.json", "utf8")) : {};
const seenPath = "content/primary-seen.json";
const seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, "utf8")) : {};
const published = [], report = [], queue = [];
const newestDev = (s) => s.events.filter((e) => e.label !== "pending").reduce((m, e) => (e.date > m ? e.date : m), "");

for (const f of readdirSync("content/stories").filter((x) => x.endsWith(".json"))) {
  const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8"));
  const sources = registry[s.slug] || [];
  if (!sources.length) continue;
  const since = Math.max(Date.now() - 2 * DAY, Date.parse(newestDev(s) + "T00:00:00Z") || 0);
  let added = 0;
  for (const src of sources) {
    let items = [];
    try { items = await readSource(src); } catch (e) { report.push(`- ${s.slug}: ${src.who} (${src.type}) could not be read: ${String(e.message).slice(0, 80)}`); continue; }
    const fresh = items.filter((x) => x.url && !seen[x.url] && (!x.date || Date.parse(x.date) > since) && (!src.match || new RegExp(src.match, "i").test(`${x.title} ${x.text}`)));
    say(`${s.slug}: ${src.who}: ${items.length} item(s), ${fresh.length} new and relevant`);
    if (DRY) { for (const x of fresh.slice(0, 3)) say(`   ${x.date?.slice(0, 16) || "?"} ${x.title || x.text.slice(0, 80)} ${x.url}`); continue; }
    for (const x of fresh.slice(0, 2)) {
      if (added >= 2) break;
      seen[x.url] = now;
      if (!x.text || x.text.length < 200) x.text = `${x.text}\n${await pageText(x.url)}`.trim();
      if (x.text.length < 60) continue;
      const via = src.kind === "official" ? "official" : "social";
      const where = src.type === "youtube" ? "on YouTube" : src.type === "telegram" ? "on Telegram" : src.type === "bluesky" ? "on Bluesky" : via === "official" ? "in a statement" : "on its website";
      const out = await ask(`You write for a strict, neutral news site. Below is a ${via === "official" ? "statement published by an official body" : "post published by a movement or organisation"}: ${src.who}. It may be in any language; write in English.
Story: "${s.title}". Return ONLY JSON: {"relevant": true|false, "date": "YYYY-MM-DD", "kind": "own_action"|"claim"|"footage", "text": "..."}
- relevant: true only if it reports something NEW and specific about this story (not background, not promotion).
- kind: "own_action" = the publisher announces or describes its OWN decision, action or plan; "claim" = it says something about others, accuses anyone, or gives figures about events; "footage" = mainly photos/video of an event.
- text: one or two neutral sentences, at most 60 words, saying WHO said it and WHERE, e.g. "${src.who.replace(/\s*\(.*\)$/, "")} said ${where} that …". Never state their claims as fact. No names of private people. No graphic detail.
- date: the day of the statement or event.

Title: ${x.title}
Published: ${x.date || "unknown"}
Text: ${x.text.slice(0, 4000)}`, { temperature: 0.1, log: () => {} });
      let it = {}; try { it = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch {}
      if (it.relevant !== true || !it.text) { report.push(`- ${s.slug}: ${src.who}: not relevant or unreadable (${(x.title || x.url).slice(0, 70)})`); continue; }
      const miss = ungrounded(it.text, [{ title: x.title, text: x.text, domain: src.who }], `${s.title} ${s.region || ""} ${src.who} said statement YouTube Telegram Bluesky website`);
      if (miss.length) { report.push(`- ${s.slug}: ${src.who}: skipped "${it.text.slice(0, 70)}…" (${miss.slice(0, 2).join("; ")})`); continue; }
      const chk = await ask(`Independent fact-check. Source (${src.who}):\n${x.title}\n${x.text.slice(0, 4000)}\n\nProposed item: "${it.text}"\n\nIs every fact in the item stated in the source, attributed to ${src.who} (not presented as established fact), and dated correctly? Answer ONLY JSON {"ok": true|false, "reason": "..."}`, { temperature: 0, prefer: SECOND_CHECK, log: () => {} });
      let v = {}; try { v = JSON.parse(chk.slice(chk.indexOf("{"), chk.lastIndexOf("}") + 1)); } catch {}
      if (v.ok !== true) { report.push(`- ${s.slug}: ${src.who}: skipped "${it.text.slice(0, 70)}…" (fact-check: ${String(v.reason || "no clear yes").slice(0, 100)})`); continue; }
      if (SENSITIVE.test(it.text) || SENSITIVE.test(x.title)) { queue.push(`**${s.slug}** — from ${src.who} (${via}), sensitive, needs the editor: "${it.text}"\n  Source: ${x.url}`); report.push(`- ${s.slug}: sent to the editor (sensitive): "${it.text.slice(0, 70)}…"`); continue; }
      // The grade, decided in code. Own announcements are "reported" (we can confirm they said it, from their own channel);
      // anything about others is "alleged". Never "confirmed" from a single primary source.
      const label = it.kind === "own_action" && !CLAIMWORDS.test(it.text) ? "reported" : "alleged";
      const date = /^\d{4}-\d{2}-\d{2}$/.test(it.date || "") && it.date <= now.slice(0, 10) ? it.date : (x.date || now).slice(0, 10);
      const key = `pr${now.replace(/\D/g, "").slice(4, 12)}${published.length}`;
      s.sources[key] = [`${src.who}${via === "official" ? "" : ""}`, x.url];
      const g = s.sourceGroups[s.sourceGroups.length - 1];
      (Array.isArray(g) ? g[1] : g.keys || g.sources).push(key);
      if (it.kind === "footage" && via === "social") {
        s.ground = s.ground || [];
        s.ground.push({ date, platform: src.type === "youtube" ? "YouTube" : src.type === "telegram" ? "Telegram" : src.type === "bluesky" ? "Bluesky" : "Website", who: src.who, shows: it.text, label: "alleged", check: `Posted by ${src.who}; ${src.verified}. Not independently verified: the date, place and context of the footage.`, sources: [key], desk: "backup", via });
      } else {
        s.events.push({ date, phase: s.phases[s.phases.length - 1].id, label, added: now, text: it.text.trim(), sources: [key], desk: "backup", via });
        s.events.sort((a, b) => a.date.localeCompare(b.date));
      }
      s.updated = now.slice(0, 10); s.updatedAt = now;
      writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
      sh(`node tools/fmt.js content/stories/${f}`);
      published.push(s.slug); added++;
      report.push(`### ${s.title}\n- **${label}** (${via === "official" ? "official statement" : "social / own channel"}): ${it.text}\n  Source: ${x.url}`);
    }
  }
}
if (DRY) process.exit(0);
writeFileSync(seenPath, JSON.stringify(Object.fromEntries(Object.entries(seen).filter(([, t]) => Date.now() - Date.parse(t) < 30 * DAY)), null, 2));

if (queue.length) try {
  writeFileSync("/tmp/pqueue.md", `${now} (primary-source desk)\n\n${queue.join("\n\n")}`);
  const q = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Editor queue")][0].number // empty'`);
  if (q) sh(`gh issue comment ${q} --body-file /tmp/pqueue.md`);
} catch {}

if (!sh("git status --porcelain content/stories content/primary-seen.json")) { say("nothing new"); process.exit(0); }
if (published.length) {
  const build = sh("node build.mjs 2>&1 || true");
  if (/LABEL CHECK: \d+ item/.test(build) || /Error/.test(build)) { say("build check failed; not publishing"); process.exit(0); }
}
sh(`git config user.name "Unowned" && git config user.email "Unownednews2026@gmail.com"`);
sh(`git add content/stories content/primary-seen.json && git commit -q -m "${published.length ? `Primary sources: ${[...new Set(published)].join(", ")}` : "Primary sources checked"} — ${now}"`);
for (let i = 0; i < 3; i++) {
  try { sh("git pull -q --rebase origin main && git push -q origin HEAD:main"); break; }
  catch (e) { if (i === 2) { say(`push failed: ${String(e.message).slice(0, 200)}`); process.exit(0); } await new Promise((r) => setTimeout(r, 10000)); }
}
if (report.length) try {
  writeFileSync("/tmp/plog.md", `${now} — primary-source desk${Object.keys(llmProblems).length ? ` — provider problems: ${Object.entries(llmProblems).map(([k, v]) => `${k} (${v})`).join("; ")}` : ""}\n\n${report.join("\n\n")}`);
  const n = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Backup desk log")][0].number // empty'`);
  if (n) sh(`gh issue comment ${n} --body-file /tmp/plog.md`);
} catch {}
