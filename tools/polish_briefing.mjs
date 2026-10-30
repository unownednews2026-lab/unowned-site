/* Turns today's automatic briefing script into a natural, broadcast-style bulletin with Google Gemini (free tier),
   using ONLY the facts already in the script and in the stories' recent published items.
   Strict checks: every number in the new script must appear in the source text, no private names, a sensible length,
   the opening and closing lines kept. If anything fails, the plain automatic script is kept, so the briefing never breaks.
   Usage: node tools/polish_briefing.mjs [YYYY-MM-DD]   (needs GEMINI_API_KEY; otherwise does nothing) */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "node:fs";

const KEY = process.env.GEMINI_API_KEY;
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
const file = `content/briefings/${date}.json`;
const say = (m) => console.log(`::notice::polish briefing: ${m.replace(/\n/g, " ")}`);
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
const MODELS = [process.env.GEMINI_MODEL, "gemini-3.8-flash", "gemini-flash-latest", "gemini-flash-lite-latest"].filter(Boolean);
let lastModel = "";
async function ask(text, temperature) {
  for (const m of MODELS) for (let tries = 0; tries < 2; tries++) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": KEY },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature } }),
        signal: AbortSignal.timeout(150000),
      });
      if (r.status === 429 && tries === 0) { say(`model ${m}: busy (429), waiting a minute`); await new Promise((x) => setTimeout(x, 60000)); continue; }
      if (!r.ok) { say(`model ${m}: HTTP ${r.status}`); break; }   // 404 = not on this plan: try the next model
      const out = ((await r.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
      if (out) { lastModel = m; return out; }
      break;
    } catch (e) { say(`model ${m}: ${e.message}`); break; }
  }
  return "";
}
const json = (t) => { try { return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); } catch { return {}; } };

const prompt = `You write the script for "Unowned", a neutral, independent daily audio news briefing read by a synthetic voice.
Rewrite the material below into one polished bulletin of 340 to 430 words (under three minutes).

Structure:
1. Keep this opening line exactly: "${b.script[0]}"
2. "Here are today's headlines." then one crisp line per story (about 15 to 25 words), most important first, in the style of radio news headlines. Each headline starts with the country (e.g. "In Albania, ...") and keeps the attribution ("The Guardian reports", "police say").
3. Then, for each story, a short segment (2 to 4 sentences) that starts with the country or story name: what happened, why it matters in one plain line of context from the material, and what's coming up if given. For the two or three busiest stories, add one more detail. End some segments with a natural nudge such as "The full timeline, with every source, is on the story page."
4. Keep this closing line exactly: "${b.script[b.script.length - 1]}"

Strict rules:
- Use ONLY facts in the material. Do not add facts, numbers, names, places, dates or causes. Do not speculate.
- Only mention "coming up" items dated on or after ${date}.
- Keep attribution exactly, in headlines too: who said or reported what ("police say", "the ministry says", "The Guardian reports").
- OUR GRADE is the heart of Unowned. Keep the short line that explains the four grades near the top. For EVERY development, say its grade by name and why, naturally and briefly, the way a good newsreader would, and vary the wording so it never sounds repetitive. Examples: "Our grade: confirmed, with independent reporting from CBC and CTV." / "We grade that reported: so far only The Guardian has it." / "Disputed: police say 300, organisers say 2,000." / "Alleged: that's the ministry's claim, not independently confirmed." Use the outlet names given in the material; never invent one. Never make anything sound more certain than its grade.
- Never name private people (anyone arrested, charged, injured, killed, victims, witnesses, minors, ordinary protesters). Public officials, politicians, movement leaders and organisations are fine.
- Neutral wording: no opinion, no loaded or dramatic words, no graphic detail.
- Write numbers as digits exactly as in the material (e.g. "45 people", "October 24"). Avoid abbreviations a voice might misread.
- Short, clear sentences that sound natural read aloud.

Return ONLY JSON: {"script": ["paragraph", "paragraph", ...]} with the opening line as the first paragraph and the closing line as the last.

MATERIAL:
${source}`;

let script = [], feedback = "";
for (let attempt = 1; attempt <= 3 && !script.length; attempt++) {
  const draft = (json(await ask(prompt + feedback, 0.3)).script || []).map((p) => String(p).replace(/\s+/g, " ").trim()).filter(Boolean);
  if (!draft.length) { say("no usable reply"); break; }
  const n = draft.join(" ").split(/\s+/).length;
  if (n > 470 || n < 300) { feedback = `\n\nYour previous draft was ${n} words. It MUST be between 340 and 430 words: ${n > 470 ? "shorten every segment, drop background detail, keep one line per headline" : "add one more detail to the busiest stories"}.`; say(`attempt ${attempt}: ${n} words, asking for 340 to 430`); continue; }
  // Independent second check by a separate request: does the draft stick to the material and our rules?
  const review = json(await ask(`You are a strict editor. Compare the DRAFT news script with the MATERIAL it must be based on.
List every sentence in the DRAFT that: adds any fact, number, name, place or cause not in the MATERIAL; drops or changes attribution (who said or reported it); makes something sound more certain than its label in the MATERIAL; names a private person (arrested, charged, injured, killed, victims, witnesses, minors, ordinary protesters); or uses opinion, loaded or graphic wording.
Answer ONLY with JSON {"ok": true|false, "problems": ["..."]}. "ok" is true only if there are no problems.

DRAFT:
${draft.join("\n")}

MATERIAL:
${source}`, 0));
  if (review.ok === true) script = draft;
  else {
    const probs = (review.problems || []).slice(0, 8).map(String);
    say(`attempt ${attempt}: editor found ${probs.length || "unclear"} problem(s): ${probs.join(" | ").slice(0, 400)}`);
    feedback = `\n\nYour previous draft had these problems; fix them all:\n- ${probs.join("\n- ")}`;
  }
}
if (!script.length) { say("keeping the plain script (the editor check did not pass)"); process.exit(0); }

// Checks. Any failure keeps the plain script.
const problems = [];
const words = script.join(" ").split(/\s+/).length;
if (words < 280 || words > 500) problems.push(`length ${words} words`);
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

writeFileSync(file, JSON.stringify({ ...b, script, polished: true, polishedBy: lastModel }, null, 2) + "\n");
const mp3 = `static/briefings/${date}.mp3`;
if (existsSync(mp3)) unlinkSync(mp3);   // record the polished version
say(`polished: ${words} words`);
