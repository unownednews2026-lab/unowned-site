/* Gemini news desk: free (Google Gemini free tier + GitHub Actions). Runs every hour.
   It keeps the site fresh on its own: it publishes new developments, but only from established outlets (tools/outlets.json),
   only after a second, independent Gemini check of every item, and marks them "desk": "backup" so the Claude desk re-checks
   them when it is running again. Founder decision 2026-10-29: content must stay fresh even when the Claude plan runs out.
   Runs inside the hourly "Freshness check" workflow. Needs the GEMINI_API_KEY secret; without it, it does nothing. */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { headlinesSince } from "./signals.mjs";
const readFails = [];   // why articles could not be read, for the run log
import { ask, used as llmUsed, problems as llmProblems, GITHUB_PROVIDER, SECOND_CHECK } from "./llm.mjs";

const KEY = process.env.GEMINI_API_KEY;
const REPO = process.env.GITHUB_REPOSITORY;
// Tried in order; the first one that answers is used. Older models get retired, so the newest come first.
// Writing uses Google's strongest model that answers on the free tier (Pro first); checks use the fast model.
const WRITER = [process.env.GEMINI_WRITER, "gemini-3.8-flash", "gemini-flash-latest"].filter(Boolean);
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-3.8-flash-lite", "gemini-flash-lite-latest"].filter(Boolean);
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const say = (m) => console.log(/busy|: \d{3}|no answer|timeout|error/.test(m) ? `::notice::backup desk: ${m}` : `backup desk: ${m}`);
// Any unexpected error is reported on the run page (as a note, so it never sends a failure email).
for (const ev of ["uncaughtException", "unhandledRejection"]) process.on(ev, (e) => {
  console.log(`::warning::backup desk crashed: ${String(e && (e.stack || e.message || e)).replace(/\n/g, " | ").slice(0, 900)}`);
  process.exit(0);
});

if (!KEY && !process.env.GITHUB_TOKEN) { say("no AI provider available; skipping"); process.exit(0); }

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

const modelsUsed = llmUsed;
// Writing tries Gemini first; the fact-check starts with a DIFFERENT provider (GitHub Models), so a second model checks the first.
async function gemini(prompt, models = MODELS) {
  return ask(prompt, { temperature: 0.2, prefer: models === MODELS ? GITHUB_PROVIDER : 0, log: say });
}

/* Code checks that need no AI: quotes, numbers and names in an item must appear in the articles it cites.
   This catches the commonest model mistakes (a changed figure, a made-up quote, a name from nowhere). */
const MONTHS_DAYS = /^(january|february|march|april|may|june|july|august|september|october|november|december|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i;
function ungrounded(text, cited, extra = "") {
  const fold = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[’‘]/g, "'");
  const corpus = fold(cited.map((a) => `${a.title} ${a.text}`).join(" ") + " " + extra);
  const flat = corpus.replace(/[^a-z0-9]+/g, " ");
  const digits = corpus.replace(/(\d)[,\s.](?=\d{3}\b)/g, "$1");
  const bad = [];
  for (const q of String(text).match(/[“"]([^”"]{12,})[”"]/g) || []) {
    const words = fold(q).replace(/[^a-z0-9]+/g, " ").trim();
    if (words.split(" ").length >= 3 && !flat.includes(words)) bad.push(`quote not in the articles: ${q.slice(0, 60)}`);
  }
  for (const n of String(text).match(/\d[\d,.]*\d|\d+/g) || []) {
    const v = n.replace(/[,.](?=\d{3}\b)/g, "");
    if (v.length >= 2 && !digits.includes(v) && !digits.includes(n)) bad.push(`number not in the articles: ${n}`);
  }
  const sentences = String(text).split(/(?<=[.!?])\s+/);
  for (const sent of sentences) {
    const words = sent.split(/\s+/).slice(1);                      // skip the sentence's first word
    for (const w of words) {
      const t = w.replace(/^[^\p{L}]+|[^\p{L}'’-]+$/gu, "").replace(/['’]s$/, "");
      if (t.length < 4 || !/^\p{Lu}/u.test(t) || MONTHS_DAYS.test(t)) continue;
      if (!flat.includes(fold(t).replace(/[^a-z0-9]+/g, " ").trim())) bad.push(`name not in the articles: ${t}`);
    }
  }
  // Copying: 15 or more words in a row taken straight from an article is not paraphrase (quotes excepted).
  const own = fold(String(text).replace(/[“"][^”"]*[”"]/g, " ")).replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  for (let i = 0; i + 15 <= own.length; i++) if (flat.includes(" " + own.slice(i, i + 15).join(" ") + " ")) { bad.push("copies a long passage word for word"); break; }
  return [...new Set(bad)];
}

/* Resolve each link for real; keep only ones that load, using the final article address. */
async function resolve(url) {
  try {
    const r = await fetch(url, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
    if (r.status >= 400 || /vertexaisearch|google\.com\/url/.test(r.url)) return null;
    return r.url;
  } catch { return null; }
}

// Sensitive developments are never published by Gemini alone: they go to the Claude editor's queue instead.
const SENSITIVE = /\b(killed|dead|death|deaths|died|dies|murder\w*|rape\w*|sexual|suicide|shot dead|lynch\w*|accused of|charged with|alleged(ly)? (abuse|assault|corruption|fraud))\b/i;
const queue = [];
const UNSAFE = /\bnamed (by|as)\b|\bidentified (by|as)\b|\b(behead|dismember|decapitat|gore|graphic video)/i;
const words = (t) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) || []);
const overlap = (a, b) => { const A = words(a), B = words(b); let n = 0; for (const w of A) if (B.has(w)) n++; return n / Math.max(1, Math.min(A.size, B.size)); };
const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const report = [];
const published = [];

/* Recent articles about a story from GDELT (free, no key): real article addresses, so nothing is invented. */
async function articles(s, h) {
  const wv = JSON.parse(readFileSync("tools/watch.json", "utf8"))[s.slug];
  const watchQ = ((typeof wv === "object" && wv ? wv.en : wv) || s.title.replace(/'s\b/g, "")).split(" OR ")[0].replace(/"/g, "").split(/\s+/).slice(0, 4).join(" ");
  const titleQ = s.title.replace(/'s\b/g, "").replace(/\b(the|and|of|fight|movement)\b/gi, "").replace(/\s+/g, " ").trim();
  let out = await articlesFor(watchQ, s);
  if (!out.length && titleQ !== watchQ) out = await articlesFor(titleQ, s);   // second way in, if the first finds nothing readable
  // Third way in: the Google News headlines themselves point at articles; try the ones from established outlets.
  if (out.length < 3) for (const x of (h || []).filter((x) => x.domain && trusted(x.domain)).slice(0, 5)) {
    if (out.length >= 5) break;
    const a = await readArticle(x.link, x.domain, x.title);
    if (a && !out.some((o) => o.domain === a.domain)) out.push(a);
  }
  return out;
}
/* Google News links don't redirect on their own; ask Google News for the real article address (the same call its web page makes). */
async function realUrl(url) {
  const id = (url.match(/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/) || [])[1];
  if (!id) return url;
  try {
    const page = await (await fetch(`https://news.google.com/articles/${id}`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) })).text();
    const sig = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
    if (!sig || !ts) return null;
    const req = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, "US:en", null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sig]), null, "generic"]]];
    const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Mozilla/5.0" },
      body: "f.req=" + encodeURIComponent(JSON.stringify(req)), signal: AbortSignal.timeout(15000),
    });
    const m = (await r.text()).match(/\\"garturlres\\",\\"(https?:[^\\"]+)\\"/);
    return m ? m[1] : null;
  } catch { return null; }
}
async function readArticle(url, domain, title) {
  try {
    url = await realUrl(url);
    if (!url) { readFails.push(`${domain}: link not resolved`); return null; }
    let final = url, text = "", status = 0;
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36", "Accept-Language": "en" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
      status = r.status; final = r.url;
      if (r.ok) {
        const html = await r.text();
        text = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map((p) => p.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;|&[lr]dquo;/g, '"').replace(/\s+/g, " ").trim()).filter((t) => t.length > 60).join("\n").slice(0, 6000);
      }
    } catch (e) { status = e.name === "TimeoutError" ? "timeout" : "error"; }
    const host = new URL(final).hostname.replace(/^www\./, "");
    if (!trusted(host)) { readFails.push(`${host}: not an established outlet`); return null; }
    // Many news sites block plain requests or build the page with scripts. A free reader service (r.jina.ai) fetches
    // the page as a browser would and returns its text; we only use it for established outlets.
    if (text.length <= 500) {
      try {
        const r = await fetch(`https://r.jina.ai/${final}`, { headers: { "X-Return-Format": "text", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
        if (r.ok) text = (await r.text()).split("\n").map((t) => t.replace(/\s+/g, " ").trim()).filter((t) => t.length > 60 && !/^(Title|URL Source|Published Time|Markdown Content):/.test(t)).join("\n").slice(0, 6000);
        else status = `${status}; reader ${r.status}`;
      } catch (e) { status = `${status}; reader ${e.name === "TimeoutError" ? "timeout" : "error"}`; }
    }
    if (text.length > 500) return { url: final, domain: host, title, text };
    readFails.push(`${host}: ${status || "too little text"}`);
    return null;
  } catch { readFails.push(`${domain}: error`); return null; }
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
    if (out.length >= 6) break;
    if (out.some((o) => o.domain === a.domain.replace(/^www\./, ""))) continue;   // one article per outlet
    if (!trusted(a.domain)) continue;                                               // established outlets only
    const art = await readArticle(a.url, a.domain.replace(/^www\./, ""), a.title);   // same reader, with the fallback
    if (art) out.push(art);
  }
  return out;
}

for (const { f, s, h } of hot.slice(0, 3)) {
  const newest = [...s.events].sort((a, b) => b.date.localeCompare(a.date))[0];
  const recent = [...s.events].sort((a, b) => (b.added || b.date).localeCompare(a.added || a.date)).slice(0, 6);
  const arts = await articles(s, h);
  console.log(`::notice::${s.slug}: ${h.length} headline(s), ${h.filter((x) => x.domain && trusted(x.domain)).length} from established outlets, ${arts.length} readable article(s)`);
  if (!arts.length) { report.push(`- ${s.slug}: fresh headlines, but no readable articles found (${[...new Set(readFails.splice(0))].slice(0, 4).join("; ") || "no article links"})`); continue; }
  const prompt = `You help a careful, neutral news tracker called Unowned. Story: "${s.title}". ${s.dek}

Already published (newest first):
${recent.map((e) => `- ${e.date} [${e.label}] ${e.text}`).join("\n")}

New articles (numbered):
${arts.map((a, i) => `[${i + 1}] ${a.domain}: ${a.title}\n${a.text}`).join("\n\n")}

Using ONLY these articles, write the developments that are genuinely NEW (not already published above), to the standard of a careful wire-service editor.
Return ONLY a JSON object, no other text: {"items":[{"date":"YYYY-MM-DD","label":"confirmed|reported|disputed|alleged","text":"...","articles":[1,2]}]}
Rules:
- At most 2 items: the most important real developments (court decisions, arrests, official statements, protests, figures, policy changes). Prefer one rich item over two thin ones. Return {"items":[]} if nothing is new or the articles are not about this story. Background or history is NOT a development.
- Combine everything the articles say about the same development into one item, and cite every article that reports it.
- Both sides: if the articles carry a response from the other side (government and protesters, police and organisers, company and critics), include it in the same item in one short clause. Never present one side's claim as fact.
- Figures: if outlets or sides give different numbers, give both with who says what ("police say 300, organisers say 2,000").
- "date": the day the development happened, as stated in the articles.
- "text": two neutral sentences in English at most, under 70 words, paraphrased, with attribution ("police say", "the ministry says", "<outlet> reports"). The first sentence must stand alone as a headline. No opinion, no loaded words, no graphic detail.
- NEVER name private people (anyone arrested, charged, injured, killed, victims, witnesses, minors, ordinary protesters). Describe them instead ("a 24-year-old man"). Only public officials, politicians, movement leaders and organisations may be named.
- Labels: "confirmed" only if two or more cited articles did their OWN reporting — check bylines and credits: several outlets running the same Reuters, AFP, AP, PTI, ANSA or other agency story count as ONE source. One source = "reported"; conflicting accounts = "disputed" with both given; one side's claim = "alleged".
- "articles": the numbers of every article that reports it.
`;
  const out = await gemini(prompt, WRITER);
  let items = [];
  try { items = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).items || []; } catch { say(`${s.slug}: could not read the reply`); }
  const added = [];
  for (const it of items.slice(0, 2)) {
    const why = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.date || "") || it.date < new Date(Date.now() - 4 * 864e5).toISOString().slice(0, 10) || it.date > now.slice(0, 10)) why.push("bad or old date (only developments from the last 4 days are new)");
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

Answer ONLY with JSON: {"evidence": ["exact sentence copied from an article that supports each fact, one per fact"], "ok": true|false, "reason": "..."}. "ok" is true ONLY if ALL of these hold:
1. Every fact in the item is clearly stated in the cited articles (numbers, dates, names and who said what match). Check WHEN each thing was said or done: a new statement must not be mixed up with an earlier one, and a reply must not be presented as the original remark.
2. Claims are attributed to whoever made them; nothing is stated as fact that the articles only report as a claim.
3. It names no private person (anyone arrested, charged, injured, killed, a victim, witness, minor or ordinary protester). Public officials, politicians, movement leaders and organisations are fine.
4. It is neutral (no opinion or loaded words), has no graphic detail, and is not hateful, sexual or defamatory.
5. It is about the story "${s.title}" and is a real development, not commentary or opinion.`);
      let v = {};
      try { v = JSON.parse(verdict.slice(verdict.indexOf("{"), verdict.lastIndexOf("}") + 1)); } catch {}
      // Code-level grounding: the checker must quote the articles, and every quote must really be in them.
      const norm = (x) => String(x).toLowerCase().replace(/[^a-z0-9à-ÿ]+/g, " ").trim();
      const corpus = norm(cited.map((a) => a.text).join(" "));
      if (v.ok === true && (!Array.isArray(v.evidence) || !v.evidence.length || v.evidence.some((q) => !corpus.includes(norm(q).split(" ").slice(0, 6).join(" ")))))
        v = { ok: false, reason: "the fact-check's supporting quotes were not found in the articles" };
      if (v.ok !== true && v.reason) {
        // Like a desk editor sending copy back: one rewrite that fixes the problem, then the same check again.
        const fixed = await gemini(`Rewrite this news item so it fixes the editor's problem, using ONLY facts in the articles. Keep it neutral, attributed, under 70 words, two sentences at most, no private names. Return ONLY the rewritten item text.

Item: "${it.text}"
Editor's problem: ${v.reason}

Articles:
${cited.map((a, i) => `[${i + 1}] ${a.domain}: ${a.title}\n${a.text}`).join("\n\n")}`, WRITER);
        const text2 = fixed.replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").trim();
        if (text2 && text2.length <= 450 && !UNSAFE.test(text2)) {
          const again = await gemini(verdict === "" ? "" : `You are a strict fact-checker for a neutral news site. Answer ONLY with JSON {"ok": true|false, "reason": "..."}. "ok" is true only if every fact in the item is stated in the articles, claims are attributed, no private person is named, and it is neutral and about the story "${s.title}".

Item: "${text2}"

Articles:
${cited.map((a, i) => `[${i + 1}] ${a.domain}: ${a.title}\n${a.text}`).join("\n\n")}`);
          let v2 = {}; try { v2 = JSON.parse(again.slice(again.indexOf("{"), again.lastIndexOf("}") + 1)); } catch {}
          if (v2.ok === true) { it.text = text2; v = v2; }
        }
      }
      if (v.ok !== true) why.push(`fact-check: ${String(v.reason || "no clear yes").slice(0, 120)}`);
      // Code check: quotes, numbers and names must all be in the articles (or the story's own title and outlet names).
      if (!why.length) {
        const miss = ungrounded(it.text, cited, `${s.title} ${s.region || ""} ${cited.map((a) => a.domain).join(" ")} reports says said`);
        if (miss.length) why.push(`fact-check: ${miss.slice(0, 3).join("; ")}`);
      }
      // Second, independent fact-check by a different AI service: both must agree before anything is published.
      if (!why.length) {
        const second = await ask(`You are a second, independent fact-checker. Read the articles, then the proposed item. Check each fact in the item: is it stated in the articles, attributed to the right person or body, and placed at the right time (not mixing up an earlier statement with a new one)? Answer ONLY with JSON {"ok": true|false, "reason": "..."}.

Articles:
${cited.map((a, i) => `[${i + 1}] ${a.domain}: ${a.title}\n${a.text}`).join("\n\n")}

Proposed item: "${it.text}"`, { temperature: 0, prefer: SECOND_CHECK, log: say });
        let v3 = {}; try { v3 = JSON.parse(second.slice(second.indexOf("{"), second.lastIndexOf("}") + 1)); } catch {}
        if (v3.ok !== true) why.push(`second fact-check: ${String(v3.reason || "no clear yes").slice(0, 120)}`);
      }
    }
    if (!why.length && SENSITIVE.test(it.text)) {
      queue.push(`**${s.slug}** — sensitive (deaths, abuse or accusations), needs the editor: "${it.text}"\n  Sources: ${cited.map((a) => a.url).join(" , ")}`);
      report.push(`- ${s.slug}: sent to the editor queue (sensitive): "${it.text.slice(0, 80)}…"`); continue;
    }
    // Real news from 2+ established outlets that failed the automatic fact-check: worth a human-grade look.
    if (why.some((w) => w.startsWith("fact-check")) && new Set(cited.map((a) => a.domain)).size >= 2)
      queue.push(`**${s.slug}** — reported by ${cited.length} established outlets but failed the automatic fact-check (${why.join(", ").slice(0, 160)}): "${(it.text || "").slice(0, 200)}"\n  Sources: ${cited.map((a) => a.url).join(" , ")}`);
    if (why.length) { report.push(`- ${s.slug}: skipped "${(it.text || "").slice(0, 80)}…" (${why.join(", ")})`); continue; }
    // Labels are capped: "confirmed" needs two different established outlets; disputed/alleged stay as given.
    let label = it.label;
    // Independence check in code too: different outlets running the same agency story count once.
    const WIRES = [["reuters", /\breuters\b/i], ["afp", /\b(afp|agence france-presse)\b/i], ["ap", /\b(associated press|\(ap\))\b/i], ["pti", /\b(pti|press trust of india)\b/i], ["ani", /\bANI\b/], ["ians", /\bIANS\b/], ["ansa", /\bANSA\b/], ["dpa", /\bdpa\b/], ["efe", /\bEFE\b/]];
    const sourceOf = (a) => { const head = a.text.slice(0, 600); const w = WIRES.find(([, re]) => re.test(head)); return w ? `wire:${w[0]}` : a.domain; };
    if (label === "confirmed" && new Set(cited.map(sourceOf)).size < 2) label = "reported";
    const keys = cited.map((a, i) => { const k = `bk${now.replace(/\D/g, "").slice(4, 12)}${added.length}${i}`; s.sources[k] = [a.domain, a.url]; return k; });
    const group = s.sourceGroups[s.sourceGroups.length - 1];
    (Array.isArray(group) ? group[1] : group.keys || group.sources || []).push(...keys);
    s.events.push({ date: it.date, phase: s.phases[s.phases.length - 1].id, label, added: now, text: it.text.trim(), sources: keys, desk: "backup" });
    // Review packet for the Claude editor: the item plus the full text of the articles it rests on, so the editor can check it
    // without searching or re-fetching (saves Claude usage). Kept in the private repository only; never published on the site.
    mkdirSync(`review-packets/${s.slug}`, { recursive: true });
    writeFileSync(`review-packets/${s.slug}/${keys[0]}.json`, JSON.stringify({ story: s.slug, added: now, label, text: it.text.trim(), sources: cited.map((a, i) => ({ key: keys[i], outlet: a.domain, url: a.url, title: a.title, articleText: a.text })) }, null, 2));
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

/* Safety net: a story with fresh headlines from established outlets but no update for 8+ hours gets a short,
   attributed headline item ("<Outlet> reports: ..."), so real news never waits more than a day. The Claude desk rewrites it later. */
// Off by default (Nov 1): the editor removed most headline-only items as too thin to verify, and its five daily runs
// now catch up stories that fall behind. Set HEADLINE_FALLBACK=1 to switch it back on.
for (const { f, h } of process.env.HEADLINE_FALLBACK ? hot : []) {
  const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8"));
  if (published.includes(s.slug) || Date.now() - Date.parse(s.updatedAt || s.updated) < 8 * 36e5) continue;
  // The headline must mention the story itself, not just the country (e.g. an airport-delay headline is not about asylum unrest).
  const wv2 = JSON.parse(readFileSync("tools/watch.json", "utf8"))[s.slug];
  const watchWords = ((typeof wv2 === "object" && wv2 ? `${wv2.en} ${wv2.local || ""}` : wv2) || s.title).toLowerCase().split(/[^a-zà-ÿ0-9]+/).filter((w) => w.length >= 4 && !(s.region || "").toLowerCase().includes(w) && !["south", "africa", "india", "italy", "france", "canada", "albania"].includes(w));
  const onTopic = (title) => watchWords.some((w) => title.toLowerCase().includes(w.slice(0, Math.max(5, w.length - 2))));
  const pick = (h || []).find((x) => onTopic(x.title) && x.domain && trusted(x.domain) && !/^(opinion|comment|editorial|analysis|letters?|column|explainer|podcast)\b|\b(opinion|editorial)\s*[:|]/i.test(x.title) && x.link && x.title && !UNSAFE.test(x.title) && !s.events.some((e) => overlap(e.text, x.title) > 0.5));
  if (!pick) { report.push(`- ${s.slug}: no update for 20+ hours, but no headline from an established outlet to use`); continue; }
  const headline = pick.title.replace(/\s+-\s+[^-]+$/, "").trim();            // Google News adds " - Outlet" at the end
  const outlet = pick.outlet || pick.domain;
  const check = await gemini(`A neutral news site will publish this exactly: ${outlet} reports: "${headline}"
It belongs to the story "${s.title}". Answer ONLY with JSON {"ok": true|false, "reason": "..."}. "ok" is true only if the headline is clearly about this story, names no private person (anyone arrested, charged, injured, killed, a victim, witness, minor or ordinary protester; public officials, politicians, movement leaders and organisations are fine), has no graphic detail, and is not opinion, hateful, sexual or defamatory.`);
  let v = {}; try { v = JSON.parse(check.slice(check.indexOf("{"), check.lastIndexOf("}") + 1)); } catch {}
  if (v.ok !== true) { report.push(`- ${s.slug}: headline fallback skipped (${String(v.reason || "no clear yes").slice(0, 100)})`); continue; }
  // Paraphrase the headline into one calm, attributed sentence (tabloid wording like "plunges" is not our voice).
  // Every name and number must come from the headline itself; if not, fall back to the quoted headline.
  let line = `${outlet} reports: "${headline}"`;
  try {
    const para = (await gemini(`Rewrite this news headline as ONE neutral, plain sentence for a careful news site, starting with "${outlet} reports". Use only what the headline says, add nothing, drop dramatic or loaded words, no graphic detail. Return only the sentence.\n\nHeadline: ${headline}`, WRITER)).replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").trim();
    const tokens = (x) => (x.match(/\b(?:[A-Z][\p{L}'’-]+|\d[\d,.]*)\b/gu) || []).filter((t) => !/^(The|A|An|In|On|At|As|After|Before|Over|With|Reports?)$/.test(t));
    const src = (outlet + " " + headline).toLowerCase();
    if (para && para.length < 300 && para.startsWith(outlet) && !UNSAFE.test(para) && tokens(para).every((t) => src.includes(t.toLowerCase()))) line = para.endsWith(".") ? para : para + ".";
  } catch {}
  const k = `bk${now.replace(/\D/g, "").slice(4, 12)}h`;
  s.sources[k] = [outlet, (await realUrl(pick.link)) || pick.link];
  const group = s.sourceGroups[s.sourceGroups.length - 1];
  (Array.isArray(group) ? group[1] : group.keys || group.sources || []).push(k);
  s.events.push({ date: new Date(pick.pub).toISOString().slice(0, 10), phase: s.phases[s.phases.length - 1].id, label: "reported", added: now, text: line, sources: [k], desk: "backup", headline: true });
  s.events.sort((a, b) => a.date.localeCompare(b.date));
  s.updated = now.slice(0, 10); s.updatedAt = now;
  writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
  sh(`node tools/fmt.js content/stories/${f}`);
  published.push(s.slug);
  report.push(`### ${s.title} (headline safety net)\n- **reported**: ${line}\n  Source: ${pick.link}`);
}

/* Tidy up: review packets older than 14 days are deleted (the editor has long since used them). */
try {
  for (const dir of readdirSync("review-packets", { withFileTypes: true }).filter((d) => d.isDirectory()))
    for (const f of readdirSync(`review-packets/${dir.name}`)) {
      const pth = `review-packets/${dir.name}/${f}`;
      const added = Date.parse(JSON.parse(readFileSync(pth, "utf8")).added || 0);
      if (Date.now() - added > 14 * 864e5) { rmSync(pth); sh(`git rm -q --cached ${pth} || true`); }
    }
} catch {}

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

// Things only the Claude editor should decide go to the "Editor queue" issue; the editor runs only when this has something in it.
if (queue.length) {
  writeFileSync("/tmp/queue.md", `${now}\n\n${queue.join("\n\n")}`);
  try {
    const q = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Editor queue")][0].number // empty'`);
    if (q) sh(`gh issue comment ${q} --body-file /tmp/queue.md`);
    else sh(`gh issue create --title "Editor queue" --body "Items the Gemini desk would not publish on its own. The Claude editor handles each one, then comments 'done'." && gh issue comment $(gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Editor queue")][0].number') --body-file /tmp/queue.md`);
  } catch (e) { say(`editor queue: ${String(e.message).slice(0, 120)}`); }
}

if (!sh("git status --porcelain content/stories")) { say("nothing to publish"); console.log(report.join("\n")); process.exit(0); }
const build = sh("node build.mjs 2>&1 || true");
if (/LABEL CHECK: \d+ item/.test(build) || /Error/.test(build)) {
  // Never publish a build that fails our own checks.
  say(`build check failed; not publishing: ${build.split("\n").filter((l) => /LABEL|Error|  - /.test(l)).join("; ").slice(0, 400)}`);
  process.exit(0);
}
sh(`git config user.name "Unowned" && git config user.email "Unownednews2026@gmail.com"`);
sh(`git add content/stories ${published.length ? "review-packets" : ""} && git commit -q -m "${published.length ? `Backup desk: ${published.join(", ")}` : "Checked for news (backup desk)"} — ${now}"`);
for (let i = 0; i < 3; i++) {
  try { sh("git pull -q --rebase origin main && git push -q origin HEAD:main"); break; }
  catch (e) { if (i === 2) { say(`push failed: ${String(e.message).slice(0, 200)}`); process.exit(0); } await new Promise((r) => setTimeout(r, 10000)); }
}
say(published.length ? `published: ${published.join(", ")}` : "refreshed checked-for-news stamps");

// Log in a separate issue (issue #2 is the Claude desk's own log, which this desk reads to see if Claude is running).
writeFileSync("/tmp/log.md", `${now} — ${published.length ? "published" : "no new developments from established outlets"} — models: ${[...modelsUsed].join(", ") || "none needed"}${Object.keys(llmProblems).length ? ` — provider problems: ${Object.entries(llmProblems).map(([k, v]) => `${k} (${v})`).join("; ")}` : ""}${queue.length ? ` — ${queue.length} item(s) sent to the Editor queue` : ""}\n\n${report.join("\n\n") || "(nothing to report)"}`);
try {
  const n = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Backup desk log")][0].number // empty'`);
  if (n) sh(`gh issue comment ${n} --body-file /tmp/log.md`);
  else sh(`gh issue create --title "Backup desk log" --body-file /tmp/log.md`);
} catch {}
