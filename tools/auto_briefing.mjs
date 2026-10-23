/* Writes today's briefing script (content/briefings/YYYY-MM-DD.json) straight from the published story timelines,
   with no AI step, so the daily briefing never depends on anything outside this repository.
   It uses only text already published on the site, with the same labels. If today's script already exists, it does nothing.
   Usage: node tools/auto_briefing.mjs [YYYY-MM-DD]   (default: today, UTC) */
import { readFileSync, readdirSync, writeFileSync, existsSync, mkdirSync } from "node:fs";

const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const out = `content/briefings/${date}.json`;
if (existsSync(out)) { console.log(`${out} already exists; nothing to do`); process.exit(0); }

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
    .replace(new RegExp(`\\b(${MONTHS.join("|")}) (\\d{1,2})[–-](\\d{1,2})\\b`, "g"), (_, m, a, b) => `${m} ${ordinal(Number(a))} to ${ordinal(Number(b))}`)
    .replace(new RegExp(`\\b(${MONTHS.join("|")}) (\\d{1,2})\\b(?!,? \\d{4}|\\d)`, "g"), (_, m, n) => `${m} ${ordinal(Number(n))}`)
    .replace(/\bB\.C\./g, "British Columbia").replace(/\bGov\. /g, "Governor ").replace(/\bno\. (?=\d)/gi, "number ")
    .replace(/\bSt\. /g, "Saint ").replace(/\bDr /g, "Doctor ").replace(/\bvs?\. /g, "versus ").replace(/\be\.g\. /g, "for example ")
    .replace(/\b(\d+)\/(\d{4})\b/g, "$1 of $2")   // "190/2026" -> "190 of 2026"
    .replace(/\s*\([^)]*\)/g, "")          // drop bracketed asides
    .replace(/\s+/g, " ").trim();
}
const sentences = (t) => t.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [t];
const firstSentences = (t, n) => sentences(speakable(t)).slice(0, n).join(" ").trim();
const LABEL = {
  confirmed: "That's confirmed by independent reports.",
  reported: "That's reported so far by one source.",
  disputed: "Accounts of this differ.",
  alleged: "That's one side's claim, not yet confirmed.",
};

const now = Date.parse(date + "T23:59:59Z") > Date.now() ? Date.now() : Date.parse(date + "T06:00:00Z");
const DAY = 864e5;
const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));

const recent = (s, ms) => s.events.filter((e) => e.label !== "pending" && e.added && now - Date.parse(e.added) <= ms && Date.parse(e.added) <= now);
let picks = stories.map((s) => ({ s, ev: recent(s, DAY) })).filter((x) => x.ev.length)
  .sort((a, b) => b.ev.length - a.ev.length || Date.parse(b.s.updatedAt) - Date.parse(a.s.updatedAt)).slice(0, 3);
if (!picks.length) {   // quiet day: the most recently updated story, newest item
  const s = [...stories].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
  const ev = s.events.filter((e) => e.label !== "pending" && e.added).sort((a, b) => b.added.localeCompare(a.added)).slice(0, 1);
  picks = [{ s, ev }];
}

const script = [
  `This is the Unowned briefing for ${weekday}, ${MONTHS[d.getUTCMonth()]} ${ordinal(d.getUTCDate())}. It's narrated by a synthetic voice, and every fact comes from our checked timelines.`,
];
for (const { s, ev } of picks) {
  script.push(`${s.title}.`);
  const newest = [...ev].sort((a, b) => b.added.localeCompare(a.added) || b.date.localeCompare(a.date)).slice(0, picks.length > 2 ? 1 : 2);
  const parts = [];
  for (const e of newest) parts.push(firstSentences(e.text, 1), LABEL[e.label] || "");
  const pend = s.events.filter((e) => e.label === "pending").sort((a, b) => (b.added || "").localeCompare(a.added || ""))[0];
  if (pend) {
    // Only the first thing being watched, so the briefing stays short (about 90 seconds).
    let p = firstSentences(pend.text, 1).split(";")[0].replace(/[.;:]\s*$/, "");
    if (p.split(/\s+/).length > 22) p = p.split(", ")[0];
    p = /^(whether|what|when|how|who|why|if)\b/i.test(p) ? `We're watching ${p[0].toLowerCase()}${p.slice(1)}.` : `What's next: ${p[0].toLowerCase()}${p.slice(1)}.`;
    parts.push(p);
  }
  script.push(parts.filter(Boolean).join(" "));
}
script.push("That's the briefing. Full timelines, and every source, are at unowned news dot com.");

const names = picks.map((p) => p.s.title.replace(/^(.*?)'s /, "$1's "));
const title = "Briefing: " + (names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names.at(-1) : names[0]);
mkdirSync("content/briefings", { recursive: true });
writeFileSync(out, JSON.stringify({ title, stories: picks.map((p) => p.s.slug), script, auto: true }, null, 2) + "\n");
console.log(`wrote ${out}: ${picks.map((p) => p.s.slug).join(", ")}; ${script.join(" ").split(/\s+/).length} words`);
