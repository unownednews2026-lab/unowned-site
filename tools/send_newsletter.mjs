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

const payload = { subject: email.subject, body: email.body, status: nl.mode === "send" ? "about_to_send" : "draft" };
const res = await fetch("https://api.buttondown.com/v1/emails", {
  method: "POST",
  headers: { Authorization: `Token ${key}`, "Content-Type": "application/json", "X-Buttondown-Live-Dangerously": "true" },
  body: JSON.stringify(payload),
});
const text = await res.text();
if (!res.ok) { console.error(`Buttondown error ${res.status}: ${text.slice(0, 500)}`); process.exit(1); }
console.log(`${nl.mode === "send" ? "Sent" : "Saved as draft"}: ${email.subject}`);
