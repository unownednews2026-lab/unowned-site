/* Gemini news desk: free (Google Gemini free tier + GitHub Actions). Runs every hour.
   It keeps the site fresh on its own: it publishes new developments, but only from established outlets (tools/outlets.json),
   only after a second, independent Gemini check of every item, and marks them "desk": "backup" so the Claude desk re-checks
   them when it is running again. Founder decision 2026-10-29: content must stay fresh even when the Claude plan runs out.
   Runs inside the hourly "Freshness check" workflow. Needs the GEMINI_API_KEY secret; without it, it does nothing. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { headlinesSince } from "./signals.mjs";

const KEY = process.env.GEMINI_API_KEY;
const REPO = process.env.GITHUB_REPOSITORY;
// Tried in order; the first one that answers is used. Older models get retired, so the newest come first.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.8-flash-lite", "gemini-flash-lite-latest"].filter(Boolean);
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const say = (m) => console.log(`backup desk: ${m}`);

if (!KEY) { say("no GEMINI_API_KEY secret yet; skipping"); process.exit(0); }

/* Since 2026-10-29 this Gemini desk is the MAIN hourly desk (founder decision: save the Claude plan for building the platform).
   The Claude desk runs twice a day as editor: it re-checks every "desk": "backup" item and digs deeper. */

const OUTLETS = JSON.parse(readFileSync("tools/outlets.json", "utf8")).domains;
const trusted = (host) => { const h = host.replace(/^www\./, ""); return OUTLETS.some((d) => h === d || h.endsWith("." + d)); };

/* 3. Stories with fresh headlines (max 3, most headlines first). */
const files = readdirSync("content/stories").filter((f) => f.endsWith(".json"));
const stories = files.map((f) => ({ f, s: JSON.parse(readFileSync(`content/stories/${f}`, "utf8")) }));
const hot = [];
for (const x of stories) {
  const h = await headlinesSince(x.s).catch(() => []);
  if (h.length) hot.push({ ...x, h });
}
hot.sort((a, b) => b.h.length - a.h.length);
if (!hot.length) say("no fresh headlines for any story");

async function gemini(prompt) {
  for (const m of MODELS) {
    let r = null;
    for (let tries = 0; tries < 2; tries++) {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
      });
      if (r.status !== 429 || tries) break;
      say(`model ${m}: busy (429), waiting a minute`); await new Promise((x) => setTimeout(x, 60000));   // per-minute limit
    }
    if (!r.ok) { say(`model ${m}: HTTP ${r.status} ${((await r.text()).match(/"message": "([^"]{0,160})/) || [])[1] || ""}`); continue; }
    const j = await r.json();
    say(`model ${m} answered`);
    return (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  }
  return "";
}

/* Resolve each link for real; keep only ones that load, using the final article address. */
async function resolve(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 400 || /vertexaisearch|google\.com\/url/.test(r.url)) return null;
    return r.url;
  } catch { return null; }
}

const UNSAFE = /\bnamed (by|as)\b|\bidentified (by|as)\b|\b(behead|dismember|decapitat|gore|graphic video)/i;
const words = (t) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) || []);
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const report = [];
const published = [];

/* Recent articles about a story from GDELT (free, no key): real article addresses, so nothing is invented. */
async function articles(s, h) {
  const watchQ = (JSON.parse(readFileSync("tools/watch.json", "utf8"))[s.slug] || s.title.replace(/'s\b/g, "")).split(/\s+/).slice(0, 4).join(" ");
  const titleQ = s.title.replace(/'s\b/g, "").replace(/\b(the|and|of|fight|movement)\b/gi, "").replace(/\s+/g, " ").trim();
  let out = await articlesFor(watchQ, s);
  if (!out.length && titleQ !== watchQ) out = await articlesFor(titleQ, s);   // second way in, if the first finds nothing readable
  // Third way in: the Google News headlines themselves point at articles; try the ones from established outlets.
  if (!out.length) for (const x of (h || []).filter((x) => x.domain && trusted(x.domain)).slice(0, 4)) {
    const a = await readArticle(x.link, x.domain, x.title);
    if (a && !out.some((o) => o.domain === a.domain)) out.push(a);
  }
  return out;
}
async function readArticle(url, domain, title) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
    const host = new URL(r.url).hostname.replace(/^www\./, "");
    if (!trusted(host)) return null;
    const html = await r.text();
    const text = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map((p) => p.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&[lr]dquo;/g, '"').replace(/\s+/g, " ").trim()).filter((t) => t.length > 60).join("\n").slice(0, 5000);
    return text.length > 500 ? { url: r.url, domain: host, title, text } : null;
  } catch { return null; }
}
async function articlesFor(q, s) {
  const since = Date.parse(s.updatedAt || s.updated);
  let list = [];
  // GDELT allows one request every 5 seconds.
  for (let attempt = 0; attempt < 2 && !list.length; attempt++) {
    await new Promise((r) => setTimeout(r, 6000));
    try {
      const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=25&timespan=2d&sort=datedesc`, { signal: AbortSignal.timeout(25000) });
      list = ((await r.json()).articles || []).filter((a) => Date.parse(a.seendate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z")) > since);
      break;
    } catch (e) { say(`${s.slug}: GDELT unavailable (${e.message.slice(0, 60)})`); }
  }
  // Fallback: Bing News RSS, whose links carry the real article address.
  if (!list.length) {
    try {
      const xml = await (await fetch(`https://www.bing.com/news/search?q=${encodeURIComponent(q)}&format=rss&setlang=en`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) })).text();
      for (const it of xml.split("<item>").slice(1)) {
        const link = (it.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "";
        const url = decodeURIComponent((link.replace(/&amp;/g, "&").match(/[?&]url=([^&]+)/) || [])[1] || link);
        const pub = Date.parse((it.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [])[1] || "");
        const title = ((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").replace(/&amp;/g, "&");
        if (/^https?:\/\//.test(url) && pub > since) list.push({ url, title, domain: new URL(url).hostname });
      }
      say(`${s.slug}: ${list.length} article(s) from Bing News`);
    } catch (e) { say(`${s.slug}: Bing News unavailable (${e.message.slice(0, 60)})`); }
  }
  const out = [];
  for (const a of list) {
    if (out.length >= 5) break;
    if (out.some((o) => o.domain === a.domain.replace(/^www\./, ""))) continue;   // one article per outlet
    if (!trusted(a.domain)) continue;                                               // established outlets only
    try {
      const html = await (await fetch(a.url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) })).text();
      const text = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map((p) => p.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&[lr]dquo;/g, '"').replace(/\s+/g, " ").trim()).filter((t) => t.length > 60).join("\n").slice(0, 5000);
      if (text.length > 500) out.push({ url: a.url, domain: a.domain.replace(/^www\./, ""), title: a.title, text });
    } catch {}
  }
  return out;
}

for (const { f, s, h } of hot.slice(0, 3)) {
  const newest = [...s.events].sort((a, b) => b.date.localeCompare(a.date))[0];
  const recent = [...s.events].sort((a, b) => (b.added || b.date).localeCompare(a.added || a.date)).slice(0, 6);
  const arts = await articles(s, h);
  if (!arts.length) { report.push(`- ${s.slug}: fresh headlines, but no readable articles found`); continue; }
  const prompt = `You help a careful, neutral news tracker called Unowned. Story: "${s.title}". ${s.dek}

Already published (newest first):
${recent.map((e) => `- ${e.date} [${e.label}] ${e.text}`).join("\n")}

New articles (numbered):
${arts.map((a, i) => `[${i + 1}] ${a.domain}: ${a.title}\n${a.text}`).join("\n\n")}

Using ONLY these articles, list developments that are genuinely NEW (not already published above).
Return ONLY a JSON object, no other text: {"items":[{"date":"YYYY-MM-DD","label":"confirmed|reported|disputed|alleged","text":"...","articles":[1,2]}]}
Rules:
- At most 3 items, only real developments (court decisions, arrests, official statements, protests, figures). Return {"items":[]} if nothing is new or the articles are not about this story.
- "date": the day the development happened, as stated in the article.
- "text": one or two neutral sentences in English, paraphrased, attributed ("police say", "the ministry says", "<outlet> reports"), under 60 words. No opinion, no graphic detail.
- NEVER name private people (anyone arrested, charged, injured, killed, victims, witnesses, minors, ordinary protesters). Describe them instead ("a 24-year-old man"). Only public officials, politicians and organisations may be named.
- "articles": the numbers of the articles that report it. "confirmed" only if two of them did their own reporting (not the same wire story); one article = "reported"; conflicting accounts = "disputed" with both sides; one side's claim = "alleged".`;
  const out = await gemini(prompt);
  let items = [];
  try { items = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).items || []; } catch { say(`${s.slug}: could not read the reply`); }
  const added = [];
  for (const it of items.slice(0, 2)) {
    const why = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || "") || it.date < newest.date.slice(0, 8) + "01" || it.date > now.slice(0, 10)) why.push("bad date");
    if (!["confirmed", "reported", "disputed", "alleged"].includes(it.label)) why.push("bad label");
    if (!it.text || it.text.length > 450) why.push("text missing or too long");
    if (UNSAFE.test(it.text || "")) why.push("may name a private person or contain graphic detail");
    if (s.events.some((e) => overlap(e.text, it.text || "") > 0.6)) why.push("already published");
    const cited = [...new Set(it.articles || [])].map((n) => arts[n - 1]).filter(Boolean);
    if (!cited.length) why.push("no article cited");
    if (!why.length) {
      // Second, independent check: is every claim in the item stated in the cited articles, and is it safe to publish?
      const verdict = await gemini(`You are a strict fact-checker for a neutral news site. Check ONE proposed item against the articles it cites.

Proposed item: "${it.text}"

Cited articles:
${cited.map((a, i) => `[${i + 1}] ${a.domain}: ${a.title}\n${a.text}`).join("\n\n")}

Answer ONLY with JSON: {"ok": true|false, "reason": "..."}. "ok" is true ONLY if ALL of these hold:
1. Every fact in the item is clearly stated in the cited articles (numbers, dates, names and who said what match).
2. Claims are attributed to whoever made them; nothing is stated as fact that the articles only report as a claim.
3. It names no private person (anyone arrested, charged, injured, killed, a victim, witness, minor or ordinary protester). Public officials, politicians, movement leaders and organisations are fine.
4. It is neutral (no opinion or loaded words), has no graphic detail, and is not hateful, sexual or defamatory.
5. It is about the story "${s.title}" and is a real development, not commentary or opinion.`);
      let v = {};
      try { v = JSON.parse(verdict.slice(verdict.indexOf("{"), verdict.lastIndexOf("}") + 1)); } catch {}
      if (v.ok !== true) why.push(`fact-check: ${String(v.reason || "no clear yes").slice(0, 120)}`);
    }
    if (why.length) { report.push(`- ${s.slug}: skipped "${(it.text || "").slice(0, 80)}…" (${why.join(", ")})`); continue; }
    // Labels are capped: "confirmed" needs two different established outlets; disputed/alleged stay as given.
    let label = it.label;
    if (label === "confirmed" && new Set(cited.map((a) => a.domain)).size < 2) label = "reported";
    const keys = cited.map((a, i) => { const k = `bk${now.replace(/\D/g, "").slice(4, 12)}${added.length}${i}`; s.sources[k] = [a.domain, a.url]; return k; });
    const group = s.sourceGroups[s.sourceGroups.length - 1];
    (Array.isArray(group) ? group[1] : group.keys || group.sources || []).push(...keys);
    s.events.push({ date: it.date, phase: s.phases[s.phases.length - 1].id, label, added: now, text: it.text.trim(), sources: keys, desk: "backup" });
    added.push({ label, text: it.text.trim(), cited });
  }
  if (!added.length) continue;
  s.events.sort((a, b) => a.date.localeCompare(b.date));
  s.updated = now.slice(0, 10); s.updatedAt = now;
  writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
  sh(`node tools/fmt.js content/stories/${f}`);
  published.push(s.slug);
  report.push(`### ${s.title}\n` + added.map((a) => `- **${a.label}**: ${a.text}\n  Sources: ${a.cited.map((x) => `[${x.domain}](${x.url})`).join(", ")}`).join("\n"));
}

/* 24-hour safety net: a story with fresh headlines from established outlets but no update for 20+ hours gets a short,
   attributed headline item ("<Outlet> reports: ..."), so real news never waits more than a day. The Claude desk rewrites it later. */
for (const { f, h } of hot) {
  const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8"));
  if (published.includes(s.slug) || Date.now() - Date.parse(s.updatedAt || s.updated) < 20 * 36e5) continue;
  const pick = (h || []).find((x) => x.domain && trusted(x.domain) && !/^(opinion|comment|editorial|analysis|letters?|column|explainer|podcast)\b|\b(opinion|editorial)\s*[:|]/i.test(x.title) && x.link && x.title && !UNSAFE.test(x.title) && !s.events.some((e) => overlap(e.text, x.title) > 0.5));
  if (!pick) { report.push(`- ${s.slug}: no update for 20+ hours, but no headline from an established outlet to use`); continue; }
  const headline = pick.title.replace(/\s+-\s+[^-]+$/, "").trim();            // Google News adds " - Outlet" at the end
  const outlet = pick.outlet || pick.domain;
  const check = await gemini(`A neutral news site will publish this exactly: ${outlet} reports: "${headline}"
It belongs to the story "${s.title}". Answer ONLY with JSON {"ok": true|false, "reason": "..."}. "ok" is true only if the headline is clearly about this story, names no private person (anyone arrested, charged, injured, killed, a victim, witness, minor or ordinary protester; public officials, politicians, movement leaders and organisations are fine), has no graphic detail, and is not opinion, hateful, sexual or defamatory.`);
  let v = {}; try { v = JSON.parse(check.slice(check.indexOf("{"), check.lastIndexOf("}") + 1)); } catch {}
  if (v.ok !== true) { report.push(`- ${s.slug}: headline fallback skipped (${String(v.reason || "no clear yes").slice(0, 100)})`); continue; }
  const k = `bk${now.replace(/\D/g, "").slice(4, 12)}h`;
  s.sources[k] = [outlet, pick.link];
  const group = s.sourceGroups[s.sourceGroups.length - 1];
  (Array.isArray(group) ? group[1] : group.keys || group.sources || []).push(k);
  s.events.push({ date: new Date(pick.pub).toISOString().slice(0, 10), phase: s.phases[s.phases.length - 1].id, label: "reported", added: now, text: `${outlet} reports: "${headline}"`, sources: [k], desk: "backup", headline: true });
  s.events.sort((a, b) => a.date.localeCompare(b.date));
  s.updated = now.slice(0, 10); s.updatedAt = now;
  writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
  sh(`node tools/fmt.js content/stories/${f}`);
  published.push(s.slug);
  report.push(`### ${s.title} (headline safety net)\n- **reported**: ${outlet} reports: "${headline}"\n  Source: ${pick.link}`);
}

/* Every story was checked for news this run, so refresh "Checked for news" (only every 4 hours, to keep rebuilds low). */
const newestCheck = stories.map(({ f }) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8"))).flatMap((s) => [s.updatedAt, s.checkedAt]).filter(Boolean).sort().pop() || "";
const stamp = published.length || Date.now() - Date.parse(newestCheck) > 4 * 36e5;
if (stamp) for (const { f } of stories) {
  const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8"));
  if (published.includes(s.slug)) continue;
  s.checkedAt = now;
  writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
  sh(`node tools/fmt.js content/stories/${f}`);
}

if (!sh("git status --porcelain content/stories")) { say("nothing to publish"); console.log(report.join("\n")); process.exit(0); }
const build = sh("node build.mjs 2>&1 || true");
if (/LABEL CHECK: \d+ item/.test(build) || /Error/.test(build)) {
  // Never publish a build that fails our own checks.
  say(`build check failed; not publishing: ${build.split("\n").filter((l) => /LABEL|Error|  - /.test(l)).join("; ").slice(0, 400)}`);
  process.exit(0);
}
sh(`git config user.name "Unowned" && git config user.email "Unownednews2026@gmail.com"`);
sh(`git add content/stories && git commit -q -m "${published.length ? `Backup desk: ${published.join(", ")}` : "Checked for news (backup desk)"} — ${now}"`);
for (let i = 0; i < 3; i++) {
  try { sh("git pull -q --rebase origin main && git push -q origin HEAD:main"); break; }
  catch (e) { if (i === 2) { say(`push failed: ${String(e.message).slice(0, 200)}`); process.exit(0); } await new Promise((r) => setTimeout(r, 10000)); }
}
say(published.length ? `published: ${published.join(", ")}` : "refreshed checked-for-news stamps");

// Log in a separate issue (issue #2 is the Claude desk's own log, which this desk reads to see if Claude is running).
writeFileSync("/tmp/log.md", `${now} — ${published.length ? "published" : "no new developments from established outlets"}\n\n${report.join("\n\n") || "(nothing to report)"}`);
try {
  const n = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Backup desk log")][0].number // empty'`);
  if (n) sh(`gh issue comment ${n} --body-file /tmp/log.md`);
  else sh(`gh issue create --title "Backup desk log" --body-file /tmp/log.md`);
} catch {}
