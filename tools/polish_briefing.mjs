/* Turns today's automatic briefing script into a natural, broadcast-style bulletin with Google Gemini (free tier),
   using ONLY the facts already in the script and in the stories' recent published items.
   Strict checks: every number in the new script must appear in the source text, no private names, a sensible length,
   the opening and closing lines kept. If anything fails, the plain automatic script is kept, so the briefing never breaks.
   Usage: node tools/polish_briefing.mjs [YYYY-MM-DD]   (needs GEMINI_API_KEY; otherwise does nothing) */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const KEY = process.env.GEMINI_API_KEY;
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const file = `content/briefings/${date}.json`;
const say = (m) => console.log(`polish briefing: ${m}`);
if (!KEY) { say("no GEMINI_API_KEY; keeping the plain script"); process.exit(0); }
if (!existsSync(file)) { say("no script for today"); process.exit(0); }
const b = JSON.parse(readFileSync(file, "utf8"));
if (!b.auto || b.polished) { say("nothing to polish"); process.exit(0); }

// Source facts: the plain script plus each story's three newest published items (with labels) and upcoming dates.
const stories = (b.stories || []).map((slug) => JSON.parse(readFileSync(`content/stories/${slug}.json`, "utf8")));
const facts = stories.map((s) => {
  const items = s.events.filter((e) => e.label !== "pending" && e.added).sort((x, y) => y.added.localeCompare(x.added)).slice(0, 3);
  const next = s.events.filter((e) => e.label === "pending" && e.date >= date).slice(0, 2);
  return `STORY: ${s.title} (${s.region || ""}) — page: unowned news dot com\n` +
    items.map((e) => `- [${e.label}] ${e.date}: ${e.text}`).join("\n") +
    (next.length ? "\n" + next.map((e) => `- [coming up] ${e.date}: ${e.text}`).join("\n") : "");
}).join("\n\n");
const source = b.script.join("\n") + "\n" + facts;

const prompt = `You write the script for "Unowned", a neutral, independent daily audio news briefing read by a synthetic voice.
Rewrite the material below into one polished bulletin of 380 to 480 words (about three minutes).

Structure:
1. Keep this opening line exactly: "${b.script[0]}"
2. "Here are today's headlines." then one crisp line per story (about 15 to 25 words), most important first, in the style of radio news headlines.
3. Then, for each story, a short segment (2 to 4 sentences): what happened, why it matters in one plain line of context from the material, and what's coming up if given. For the two or three busiest stories, add one more detail. End some segments with a natural nudge such as "The full timeline, with every source, is on the story page."
4. Keep this closing line exactly: "${b.script[b.script.length - 1]}"

Strict rules:
- Use ONLY facts in the material. Do not add facts, numbers, names, places, dates or causes. Do not speculate.
- Keep attribution exactly: who said or reported what ("police say", "the ministry says", "The Guardian reports").
- Say how solid each development is, using these words: confirmed = "confirmed by independent reports"; reported = "reported so far by one source"; disputed = say the accounts differ and give both; alleged = "a claim, not yet confirmed". Never make anything sound more certain than its label.
- Never name private people (anyone arrested, charged, injured, killed, victims, witnesses, minors, ordinary protesters). Public officials, politicians, movement leaders and organisations are fine.
- Neutral wording: no opinion, no loaded or dramatic words, no graphic detail.
- Write numbers as digits exactly as in the material (e.g. "45 people", "October 24"). Avoid abbreviations a voice might misread.
- Short, clear sentences that sound natural read aloud.

Return ONLY JSON: {"script": ["paragraph", "paragraph", ...]} with the opening line as the first paragraph and the closing line as the last.

MATERIAL:
${source}`;

const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"].filter(Boolean);
let out = "";
for (const m of MODELS) {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.3 } }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) { say(`model ${m}: HTTP ${r.status}`); continue; }
    out = ((await r.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
    if (out) { say(`model ${m} answered`); break; }
  } catch (e) { say(`model ${m}: ${e.message}`); }
}
let script = [];
try { script = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)).script || []; } catch {}
script = script.map((p) => String(p).replace(/\s+/g, " ").trim()).filter(Boolean);

// Checks. Any failure keeps the plain script.
const problems = [];
const words = script.join(" ").split(/\s+/).length;
if (words < 300 || words > 560) problems.push(`length ${words} words`);
if (script[0] !== b.script[0]) problems.push("opening line changed");
if (script.at(-1) !== b.script.at(-1)) problems.push("closing line changed");
const srcNums = new Set((source.match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, "").replace(/,/g, "")));
const badNums = (script.join(" ").match(/\d[\d,.]*/g) || []).map((n) => n.replace(/[,.]+$/, "").replace(/,/g, "")).filter((n) => !srcNums.has(n));
if (badNums.length) problems.push(`numbers not in the material: ${[...new Set(badNums)].join(", ")}`);
if (/\bnamed (by|as)\b|\bidentified (by|as)\b|\b(behead|dismember|decapitat|gore)/i.test(script.join(" "))) problems.push("possible private name or graphic detail");
// Every capitalised name in the new script must appear in the material (catches invented people or places).
const srcText = source.toLowerCase();
const names = [...new Set((script.slice(1, -1).join(" ").match(/(?<![.!?]\s|^)\b[A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})*/g) || []))];
const unknown = names.filter((n) => !srcText.includes(n.toLowerCase()) && !/^(Here|Now|More|Coming|Today|The|That|This|In|On|And|But|Meanwhile|Also|Next|Finally|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)$/.test(n));
if (unknown.length) problems.push(`names not in the material: ${unknown.slice(0, 5).join(", ")}`);

if (problems.length) { say(`keeping the plain script (${problems.join("; ")})`); process.exit(0); }

// Speak dates naturally ("October 24" -> "October twenty-fourth").
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const ORD = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
const wordsN = (n) => n < 20 ? ONES[n] : ["", "", "twenty", "thirty"][Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : "");
const ordinal = (n) => { const p = wordsN(n).split("-"), last = p.pop(); return [...p, ORD[last] || (last.endsWith("y") ? last.slice(0, -1) + "ieth" : last + "th")].join("-"); };
const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
script = script.map((p, i) => i === 0 || i === script.length - 1 ? p : p
  .replace(new RegExp(`\\b(${MONTHS}) (\\d{1,2})\\b(?!,? \\d{4}|\\d)`, "g"), (_, m, n) => `${m} ${ordinal(Number(n))}`)
  .replace(/\bB\.C\./g, "British Columbia"));

writeFileSync(file, JSON.stringify({ ...b, script, polished: true }, null, 2) + "\n");
say(`polished: ${words} words`);
