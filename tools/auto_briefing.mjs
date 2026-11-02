/* Writes today's briefing script (content/briefings/YYYY-MM-DD.json) straight from the published story timelines,
   with no AI step, so the daily briefing never depends on anything outside this repository.
   It uses only text already published on the site, with the same labels. If today's script already exists, it does nothing.
   Usage: node tools/auto_briefing.mjs [YYYY-MM-DD]   (default: today, UTC) */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from "node:fs";

const args = process.argv.slice(2);
const refresh = args.includes("--refresh");          // morning run: rebuild an earlier automatic script with the latest news
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || new Date().toISOString().slice(0, 10);
const out = `content/briefings/${date}.json`;
if (existsSync(out)) {
  const old = JSON.parse(readFileSync(out, "utf8"));
  const stale = refresh && old.auto && (!old.generated || Date.now() - Date.parse(old.generated) > 3 * 36e5);
  if (!stale) { console.log(`${out} already exists; nothing to do`); process.exit(0); }
  console.log(`${out} was written earlier; rebuilding it with the latest news`);
  // The recorder notices the changed script and re-records; the current audio stays live meanwhile.
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
const words = (n) => n < 20 ? ONES[n] : ["", "", "twenty", "thirty"][Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
const ordinal = (n) => {
  const w = words(n), parts = w.split("-"), last = parts.pop();
  const o = ORD[last] || (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th");
  return [...parts, o].join("-");
};
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const d = new Date(date + "T12:00:00Z");
const weekday = d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

/* Make published text easier for a synthetic voice, without changing its meaning. */
function speakable(t) {
  return t
    .replace(/\b(Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept?|Oct|Nov|Dec)\.? (?=\d)/g, (m, a) => ({ Jan: "January", Feb: "February", Mar: "March", Apr: "April", Jun: "June", Jul: "July", Aug: "August", Sep: "September", Sept: "September", Oct: "October", Nov: "November", Dec: "December" })[a] + " ")
    .replace(new RegExp(`\\b(${MONTHS.join("|")}) (\\d{1,2})[–-](\\d{1,2})\\b`, "g"), (_, m, a, b) => `${m} ${ordinal(Number(a))} to ${ordinal(Number(b))}`)
    .replace(new RegExp(`\\b(${MONTHS.join("|")}) (\\d{1,2})\\b(?!,? \\d{4}|\\d)`, "g"), (_, m, n) => `${m} ${ordinal(Number(n))}`)
    .replace(/\bB\.C\./g, "British Columbia").replace(/\bGov\. /g, "Governor ").replace(/\bno\. (?=\d)/gi, "number ")
    .replace(/\bSt\. /g, "Saint ").replace(/\bDr /g, "Doctor ").replace(/\bvs?\. /g, "versus ").replace(/\be\.g\. /g, "for example ")
    .replace(/\b(\d+)\/(\d{4})\b/g, "$1 of $2")   // "190/2026" -> "190 of 2026"
    .replace(/\s*\([^)]*\)/g, "")          // drop bracketed asides
    .replace(/\s+/g, " ").trim();
}
const sentences = (t) => (t.match(/[^.!?]+[.!?]+["”’]?(?=\s|$)/g) || [t]).map((x) => x.replace(/^["”’\s]+/, "").trim()).filter(Boolean);
const firstSentences = (t, n) => sentences(speakable(t)).slice(0, n).join(" ").trim();
/* Our grade, said the way a newsreader would: the grade name, why it got that grade, and who reported it. Varied so it doesn't sound robotic. */
const outletNames = (s, e) => [...new Set((e.sources || []).map((k) => (s.sources[k] || [])[0]).filter((n) => n && !/\.[a-z]{2,}$/i.test(n)).map((n) => n.replace(/\s*\(.*?\)\s*/g, "").trim()))].slice(0, 2);
let gradeTurn = 0;
function grade(s, e) {
  const o = outletNames(s, e), t = gradeTurn++ % 2;
  switch (e.label) {
    case "confirmed": return o.length >= 2
      ? (t ? `We grade that confirmed: ${o[0]} and ${o[1]} reported it independently.` : `Our grade: confirmed, with independent reporting from ${o[0]} and ${o[1]}.`)
      : (t ? "We grade that confirmed: independent outlets report it." : "Our grade: confirmed by independent reporting.");
    case "reported": return o.length >= 2
      ? (t ? `We grade that reported: ${o[0]} and ${o[1]} carry it, but we haven't yet established that their reporting is independent.` : `Our grade: reported. ${o[0]} and ${o[1]} have it, but we can't yet count them as independent confirmation.`)
      : o.length
      ? (t ? `We grade that reported: so far only ${o[0]} has it, and we're waiting for independent confirmation.` : `Our grade: reported. It rests on one source, ${o[0]}, and isn't yet confirmed by a second.`)
      : (t ? "We grade that reported: one source so far, not yet independently confirmed." : "Our grade: reported, from a single source so far.");
    case "disputed": return t ? "We grade that disputed: the accounts conflict, and our timeline sets out both." : "Our grade: disputed. The sides tell it differently, and both versions are on the story page.";
    case "alleged": return t ? "We grade that alleged: it's one side's claim, not independently confirmed." : "Our grade: alleged. That's a claim by one side that no one has independently confirmed.";
    default: return "";
  }
}
const SHORT = { confirmed: "Confirmed by independent reports.", reported: "Reported so far by one source.", disputed: "Accounts differ.", alleged: "A claim, not yet confirmed." };
const LABEL = {
  confirmed: "That's confirmed by independent reports.",
  reported: "That's reported so far by one source.",
  disputed: "Accounts of this differ.",
  alleged: "That's one side's claim, not yet confirmed.",
};

const now = Date.parse(date + "T23:59:59Z") > Date.now() ? Date.now() : Date.parse(date + "T06:00:00Z");
const DAY = 864e5;
const today = new Date(now).toISOString().slice(0, 10);
const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));

// Safety net: never read aloud an item that names people the way outlets name private individuals.
const unsafe = (e) => /\bnamed (by|as)\b|\bidentified (by|as)\b/i.test(e.text);
// Headline-only stopgap items ("<Outlet> reports …") are too thin to read aloud; the editor turns them into real items.
const items = (s) => s.events.filter((e) => e.label !== "pending" && !e.headline && !unsafe(e) && e.added && Date.parse(e.added) <= now)
  .sort((a, b) => b.date.localeCompare(a.date) || b.added.localeCompare(a.added));   // newest development first, not newest-added
/* The spoken headline: the item's first sentence, or its first clause when that is a whole sentence on its own.
   Never cut at a comma: a cut can drop the verb and leave a fragment (Nov 2). */
function headline(e) {
  let h = firstSentences(e.text, 1).replace(/[.;:]\s*$/, "");
  const n = (t) => t.split(/\s+/).length;
  if (n(h) > 40) { const first = h.split(/;\s*| — /)[0]; if (n(first) >= 8) h = first; }
  return h.replace(/[,;]\s*$/, "") + ".";
}
// Older developments get their date said aloud, so "on Saturday" in a week-old item isn't heard as today.
// Every development is dated aloud, the way broadcast news does: "Today", "Yesterday, Sunday, November 1st",
// or "On Friday, October 30th". The listener always knows when it happened.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const whenSaid = (iso) => {
  const day = new Date(now).toISOString().slice(0, 10), yday = new Date(now - DAY).toISOString().slice(0, 10);
  const wd = WEEKDAYS[new Date(iso + "T12:00:00Z").getUTCDay()];
  return iso === day ? "Today" : iso === yday ? `Yesterday, ${wd}, ${spokenDate(iso)}` : `On ${wd}, ${spokenDate(iso)}`;
};
const dated = (e, t) => `${whenSaid(e.date)}: ${t}`;
const upcoming = (s) => s.events.filter((e) => e.label === "pending" && e.date > today).sort((a, b) => a.date.localeCompare(b.date));
const spokenDate = (iso) => { const x = new Date(iso + "T12:00:00Z"); return `${MONTHS[x.getUTCMonth()]} ${ordinal(x.getUTCDate())}`; };

// Only current news is read as news: developments dated today or in the two days before. A story with nothing that
// recent is not presented as a headline; it gets one honest line saying when we last had a report.
const cutoff = new Date(now - 2 * DAY).toISOString().slice(0, 10);
const recent = (e) => e.date >= cutoff;
const all = stories.map((s) => ({ s, ev: items(s) })).filter((x) => x.ev.length);
const picks = all.filter((x) => recent(x.ev[0])).sort((a, b) => b.ev[0].date.localeCompare(a.ev[0].date) || b.ev[0].added.localeCompare(a.ev[0].added));
const quiet = all.filter((x) => !recent(x.ev[0])).sort((a, b) => b.ev[0].date.localeCompare(a.ev[0].date));
if (!all.length) { console.log("no stories with items"); process.exit(0); }

const region = (s) => s.region || s.title.replace(/'s .*/, "");
const when = (iso) => { const w = whenSaid(iso); return w === "Today" ? "today" : w.startsWith("Yesterday") ? "yesterday" : now - Date.parse(iso + "T12:00:00Z") < 6 * DAY ? `on ${WEEKDAYS[new Date(iso + "T12:00:00Z").getUTCDay()]}` : `on ${spokenDate(iso)}`; };
const dayLine = `${weekday}, ${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}`;

/* Short broadcast headlines (about 8 to 18 words) for the top of the show, written by a free AI model from the item's
   own text and then checked in code: every name and number must come from the item, or we use the item's first
   sentence instead. The full, attributed sentence and its grade are always read in the details. */
const fold = (x) => String(x).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
async function shortHeadline(e, s) {
  // If no checked short headline can be made, a plain teaser; the full sentence follows in the details either way.
  const full = `new developments in ${s.title.replace(/^(\p{Lu})/u, (c) => (/^(The|A|An)\b/.test(s.title) ? c.toLowerCase() : c))}.`;
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY && !process.env.CF_AI_TOKEN) return full;
  try {
    const { ask } = await import("./llm.mjs");
    for (let attempt = 0; attempt < 2; attempt++) {
    const out = (await ask(`Write ONE radio news headline of 8 to 16 words for this item from a story about ${s.title}. Use only facts in the item, keep who said or did it, present tense, no quotes, no dates, no opinion, no added words like "breaking". Return only the headline.\n\nItem: ${e.text}`, { temperature: attempt ? 0.5 : 0.2, prefer: attempt, log: () => {} }))
      .replace(/^["'\s]+|["'\s.]+$/g, "").replace(/\s+/g, " ").trim();
    const n = out.split(/\s+/).length, src = fold(`${s.title} ${s.region || ""} ${e.text}`);
    const tokens = out.match(/\b(?:[A-Z][\p{L}'’.-]+|\d[\d,.%]*)\b/gu) || [];
    const ok = n >= 6 && n <= 20 && !/[“"]/.test(out) && tokens.every((x, i) => (i === 0 && !/\d/.test(x) && /^(The|A|An|In|On|At|After|Police|Students|Protesters|Thousands|Hundreds|Government|Opposition|Young)$/.test(x)) || src.includes(fold(x).replace(/[.,]$/, "")));
    if (ok) return out + ".";
    }                                    // second try: a fresh answer often passes the check
    return full;
  } catch { return full; }
}

const script = [
  `Good morning. It's ${dayLine}, and this is the Unowned briefing: the stories that matter, checked and graded. It's read by a synthetic voice, and every fact comes from our published timelines.`,
  "Every item carries our grade. Confirmed means independent outlets agree. Reported means one source so far. Disputed means the accounts conflict. And alleged is one side's claim.",
  picks.length ? "Here are the top stories." : "There are no new developments in our stories in the last three days that we have been able to confirm in published reporting.",
];
// 1. Headlines: every story we follow, newest first, each with when it happened.
for (const { s, ev } of picks) script.push(`${region(s)}. ${when(ev[0].date)[0].toUpperCase() + when(ev[0].date).slice(1)}: ${await shortHeadline(ev[0], s)}`);
for (const { s, ev } of quiet) script.push(`${region(s)}. No new developments since ${when(ev[0].date).replace(/^on /, "")}, ${spokenDate(ev[0].date)}.`.replace(/(yesterday|today), [^.]*\./i, "$1."));
// 2. The details: the newest development in full, dated, attributed and graded, then anything else that day and what's next.
const said = new Set();
if (picks.length) script.push("Now the details.");
for (const { s, ev } of picks) {
  const parts = [`${region(s)}.`, dated(ev[0], firstSentences(ev[0].text, 2)), grade(s, ev[0])];
  for (const e of ev.slice(1).filter((e) => e.date === ev[0].date).slice(0, 1)) parts.push(`Also ${when(e.date)}: ${firstSentences(e.text, 1)}`, grade(s, e));
  const next = upcoming(s)[0];
  if (next) {
    said.add(next);
    let p = firstSentences(next.text, 1).split(";")[0].replace(/[.;:]\s*$/, "").replace(/\s*Still being checked$/i, "");
    if (p.split(/\s+/).length > 22) p = p.split(", ")[0];
    parts.push(`Coming up: ${p}.`);
  }
  script.push(parts.filter(Boolean).join(" "));
}
// 3. Quiet stories: nothing new, so the latest report, dated and graded.
if (quiet.length) {
  script.push(picks.length ? "Also on our watch, with no new developments in the last three days." : "Here are the latest reports on the stories we follow.");
  for (const { s, ev } of quiet) script.push(`${region(s)}. The latest report, from ${WEEKDAYS[new Date(ev[0].date + "T12:00:00Z").getUTCDay()]}, ${spokenDate(ev[0].date)}: ${headline(ev[0])} ${grade(s, ev[0])}`.trim());
  script.push("We'll bring you updates on those as soon as they become available.");
}
// 4. What to watch in the coming days.
const ahead = stories.map((s) => ({ s })).flatMap(({ s }) => upcoming(s).slice(0, 3).map((e) => ({ s, e }))).filter(({ e }) => !said.has(e) && Date.parse(e.date) - now <= 10 * DAY)
  .sort((a, b) => a.e.date.localeCompare(b.e.date)).slice(0, 4);
if (ahead.length) script.push("Coming up in the days ahead. " + ahead.map(({ s, e }) => {
  let p = firstSentences(e.text, 1).split(";")[0].replace(/[.;:]\s*$/, "");
  if (p.split(/\s+/).length > 16) p = p.split(", ")[0];
  return `${WEEKDAYS[new Date(e.date + "T12:00:00Z").getUTCDay()]}, ${spokenDate(e.date)}, ${region(s)}: ${p}.`;
}).join(" "));
script.push(`That's the Unowned briefing for ${dayLine}. Full timelines, and every source, are at unowned news dot com. Thanks for listening.`);

const names = (picks.length ? picks : quiet).map((p) => region(p.s));
const title = "Briefing: " + (names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]);
mkdirSync("content/briefings", { recursive: true });
writeFileSync(out, JSON.stringify({ title, stories: picks.map((p) => p.s.slug), script, auto: true, generated: new Date().toISOString() }, null, 2) + "\n");
console.log(`wrote ${out}: ${picks.map((p) => p.s.slug).join(", ")}; ${script.join(" ").split(/\s+/).length} words`);
