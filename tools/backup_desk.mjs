/* Backup news desk: free (Google Gemini free tier + GitHub Actions), used only when the Claude news desk has missed runs.
   It never publishes. It drafts updates for stories with fresh headlines and opens a "HOLD: Backup desk" pull request
   for the founder or the Claude desk to check and publish.
   Runs inside the hourly "Freshness check" workflow. Needs the GEMINI_API_KEY secret; without it, it does nothing. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { headlinesSince } from "./signals.mjs";

const KEY = process.env.GEMINI_API_KEY;
const REPO = process.env.GITHUB_REPOSITORY;
// Tried in order; the first one that answers is used. Older models get retired, so the newest come first.
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.8-flash-lite", "gemini-flash-lite-latest"].filter(Boolean);
const MISSED_HOURS = 4;
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const say = (m) => console.log(`backup desk: ${m}`);

if (!KEY) { say("no GEMINI_API_KEY secret yet; skipping"); process.exit(0); }

/* 1. Is the Claude desk running? It comments on issue #2 after every run. */
const since = new Date(Date.now() - MISSED_HOURS * 36e5).toISOString();
const recentLogs = JSON.parse(sh(`gh api "repos/${REPO}/issues/2/comments?since=${since}&per_page=5"`));
if (recentLogs.length && process.env.BACKUP_FORCE !== "true") { say(`Claude desk logged a run in the last ${MISSED_HOURS} hours; nothing to do`); process.exit(0); }

/* 2. Only one backup draft at a time. */
const open = JSON.parse(sh(`gh api "repos/${REPO}/pulls?state=open&per_page=100"`)).filter((p) => p.title.startsWith("HOLD: Backup desk"));
if (open.length) { say(`backup draft #${open[0].number} is still waiting for review; skipping`); process.exit(0); }

/* 3. Stories with fresh headlines (max 3, most headlines first). */
const files = readdirSync("content/stories").filter((f) => f.endsWith(".json"));
const stories = files.map((f) => ({ f, s: JSON.parse(readFileSync(`content/stories/${f}`, "utf8")) }));
const hot = [];
for (const x of stories) {
  const h = await headlinesSince(x.s).catch(() => []);
  if (h.length) hot.push({ ...x, h });
}
hot.sort((a, b) => b.h.length - a.h.length);
if (!hot.length) { say("no fresh headlines for any story"); process.exit(0); }

async function gemini(prompt) {
  for (const m of MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2 } }),
    });
    if (!r.ok) { say(`model ${m}: HTTP ${r.status} ${((await r.text()).match(/"message": "([^"]{0,160})/) || [])[1] || ""}`); continue; }
    const j = await r.json();
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

/* Recent articles about a story from GDELT (free, no key): real article addresses, so nothing is invented. */
async function articles(s, h) {
  const q = (JSON.parse(readFileSync("tools/watch.json", "utf8"))[s.slug] || s.title.replace(/'s\b/g, "")).split(/\s+/).slice(0, 4).join(" ");
  const since = Date.parse(s.updatedAt || s.updated);
  let list = [];
  try {
    const r = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=25&timespan=2d&sort=datedesc`, { signal: AbortSignal.timeout(20000) });
    list = ((await r.json()).articles || []).filter((a) => Date.parse(a.seendate.replace(/^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)Z$/, "$1-$2-$3T$4:$5:$6Z")) > since);
  } catch (e) { say(`${s.slug}: GDELT unavailable (${e.message})`); }
  const out = [];
  for (const a of list) {
    if (out.length >= 5) break;
    if (out.some((o) => o.domain === a.domain)) continue;      // one article per outlet
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
  for (const it of items.slice(0, 3)) {
    const why = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || "") || it.date < newest.date.slice(0, 8) + "01") why.push("bad date");
    if (!["confirmed", "reported", "disputed", "alleged"].includes(it.label)) why.push("bad label");
    if (!it.text || it.text.length > 450) why.push("text missing or too long");
    if (UNSAFE.test(it.text || "")) why.push("may name a private person or contain graphic detail");
    if (s.events.some((e) => overlap(e.text, it.text || "") > 0.6)) why.push("already published");
    const srcs = [...new Set(it.articles || [])].map((n) => arts[n - 1]).filter(Boolean).map((a) => ({ outlet: a.domain, url: a.url }));
    if (!srcs.length) why.push("no article cited");
    if (why.length) { report.push(`- ${s.slug}: skipped "${(it.text || "").slice(0, 80)}…" (${why.join(", ")})`); continue; }
    let label = it.label;
    if (label === "confirmed" && srcs.length < 2) label = "reported";
    const keys = srcs.map((x, i) => { const k = `bk${now.replace(/\D/g, "").slice(4, 12)}${added.length}${i}`; s.sources[k] = [x.outlet, x.url]; return k; });
    const group = s.sourceGroups[s.sourceGroups.length - 1];
    (Array.isArray(group) ? group[1] : group.keys || group.sources || []).push(...keys);
    s.events.push({ date: it.date, phase: s.phases[s.phases.length - 1].id, label, added: now, text: it.text.trim(), sources: keys });
    added.push({ label, text: it.text.trim(), srcs });
  }
  if (!added.length) continue;
  s.events.sort((a, b) => a.date.localeCompare(b.date));
  s.updated = now.slice(0, 10); s.updatedAt = now;
  writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
  sh(`node tools/fmt.js content/stories/${f}`);
  report.push(`### ${s.title}\n` + added.map((a) => `- **${a.label}**: ${a.text}\n  Sources: ${a.srcs.map((x) => `[${x.outlet}](${x.url})`).join(", ")}`).join("\n"));
}

const changed = sh("git status --porcelain content/stories");
if (!changed) { say("nothing new worth drafting"); console.log(report.join("\n")); process.exit(0); }
const build = sh("node build.mjs 2>&1 || true");
if (/LABEL CHECK: \d+ item/.test(build) || /Error/.test(build)) report.push(`\nBuild check: ${build.split("\n").filter((l) => /LABEL|Error|  - /.test(l)).join("; ")}`);

const branch = `backup/${now.slice(0, 16).replace(/[-:T]/g, "").replace(/^(\d{8})/, "$1-")}`;
sh(`git config user.name "Unowned" && git config user.email "Unownednews2026@gmail.com"`);
sh(`git checkout -q -b ${branch} && git add content/stories && git commit -q -m "Backup desk draft: ${now}" && git push -q origin ${branch}`);
const body = `Drafted by the free backup desk (Google Gemini) because the Claude news desk has not logged a run for ${MISSED_HOURS}+ hours.

**Not published. Every item must be checked before it goes live.** Sources are real articles found through GDELT and read by the backup desk; labels were capped (one article = "reported").

${report.join("\n\n")}

To publish: check each item against its sources, fix or delete anything wrong, then retitle this pull request without "HOLD:" and merge it. The Claude news desk does this automatically once it is running again.`;
writeFileSync("/tmp/pr.md", body);
try {
  const pr = JSON.parse(sh(`gh api repos/${REPO}/pulls -f title="HOLD: Backup desk draft ${now.slice(0, 16).replace("T", " ")} UTC" -f head=${branch} -f base=main -F body=@/tmp/pr.md`));
  say(`opened #${pr.number}`);
} catch (e) {
  // If GitHub doesn't let workflows open pull requests, leave an issue pointing at the branch instead.
  writeFileSync("/tmp/pr.md", body + `\n\nBranch: https://github.com/${REPO}/compare/main...${branch}`);
  sh(`gh issue create --title "HOLD: Backup desk draft ${now.slice(0, 16).replace("T", " ")} UTC" --body-file /tmp/pr.md`);
  say("opened an issue (pull requests from workflows are turned off)");
}
