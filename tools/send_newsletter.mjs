/* Sends (or saves as a draft) the daily email through the Buttondown API. Run by the "Daily email" GitHub Action.
   Usage: node tools/send_newsletter.mjs [--preview]   (needs BUTTONDOWN_API_KEY unless --preview) */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadNewsletter, buildEmail } from "./newsletter.mjs";
import { loadBriefings, freshBriefing } from "./briefing.mjs";

const nl = loadNewsletter();
const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join("content/stories", f), "utf8")));
const email = buildEmail(stories, freshBriefing(loadBriefings()));

if (process.argv.includes("--preview")) {
  console.log(`Subject: ${email.subject}\n\n${email.body}`);
  process.exit(0);
}
if (!nl.enabled) { console.log("Daily email is switched off (content/newsletter.json)."); process.exit(0); }
const key = process.env.BUTTONDOWN_API_KEY;
if (!key) { console.log("No BUTTONDOWN_API_KEY secret set; nothing sent."); process.exit(0); }

const API = "https://api.buttondown.com/v1/emails";
const headers = { Authorization: `Token ${key}`, "Content-Type": "application/json", "X-Buttondown-Live-Dangerously": "true" };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const prefix = email.subject.split(":")[0];            // "Today in 30 seconds, <day>"

/* Has today's email already gone out (or been saved)? Makes a second run safe. */
async function alreadyDone() {
  try {
    const r = await fetch(`${API}?ordering=-creation_date`, { headers, signal: AbortSignal.timeout(20000) });
    if (!r.ok) return false;
    const j = await r.json();
    return (j.results || []).slice(0, 20).some((e) => String(e.subject || "").startsWith(prefix));
  } catch { return false; }
}

if (await alreadyDone()) { console.log(`Already sent today: ${prefix}`); process.exit(0); }

const payload = { subject: email.subject, body: email.body, status: nl.mode === "send" ? "about_to_send" : "draft" };
let last = "";
for (let attempt = 1; attempt <= 4; attempt++) {
  try {
    const res = await fetch(API, { method: "POST", headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (res.ok) { console.log(`${nl.mode === "send" ? "Sent" : "Saved as draft"}: ${email.subject}`); process.exit(0); }
    last = `Buttondown error ${res.status}: ${text.slice(0, 300).replace(/\s+/g, " ")}`;
    // 4xx other than rate limits won't fix themselves by retrying.
    if (res.status < 500 && res.status !== 429) break;
  } catch (e) { last = `Network error: ${e.message}`; }
  console.log(`Attempt ${attempt} failed: ${last}`);
  if (await alreadyDone()) { console.log("It went through after all."); process.exit(0); }
  await wait(attempt * 30000);
}
// Don't fail the workflow (that sends an alarm email); the 08:05 UTC run tries again, and the note shows on the run page.
console.log(`::warning::Daily email not sent yet: ${last}`);
