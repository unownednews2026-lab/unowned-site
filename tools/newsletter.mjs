/* Daily email ("Today in 30 seconds") sent through Buttondown.
   Settings live in content/newsletter.json:
     enabled  - false hides the sign-up box and the privacy line, and the sender does nothing
     username - the Buttondown newsletter username (used by the sign-up link)
     mode     - "draft" saves each day's email as a Buttondown draft for review; "send" sends it to subscribers
   Before enabling: turn off open and click tracking in Buttondown, because the privacy page says so. */
import { readFileSync, existsSync } from "node:fs";

export function loadNewsletter() {
  const p = "content/newsletter.json";
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { enabled: false };
}

/* Sign-up goes through Buttondown's own hosted page (buttondown.com/<username>), which handles the email field,
   the anti-spam check and the confirmation email reliably. An embedded form posting from this site was unreliable
   (blank page, no subscriber), likely because the site sends no referrer for privacy. Nothing is loaded from another site. */
export function signupBox(nl, { esc, heading = "Get the daily email" } = {}) {
  if (!nl.enabled || !nl.username) return "";
  const u = encodeURIComponent(nl.username);
  return `<div class="signup">
  <p><strong>${heading}</strong> <span class="hint">One short email each morning: what changed, with labels and sources. Free, unsubscribe any time.</span></p>
  <div class="signup-row"><a class="primary signup-link" href="https://buttondown.com/${u}" rel="noopener">Sign up for the daily email</a></div>
</div>`;
}

export function privacyLine(nl) {
  if (!nl.enabled) return "";
  return `<li>If you sign up for the daily email, your email address is held by our email provider, Buttondown, and used only to send that email. Open and click tracking is turned off. Every email has an unsubscribe link.</li>`;
}

const SITE = "https://unownednews.com";
const LABEL = { confirmed: "Confirmed", reported: "Reported", disputed: "Disputed", alleged: "Alleged" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/* First sentence, cut to about 160 characters at a word break so the whole email reads in about 30 seconds. */
const first = (t) => { const f = t.split(". ")[0].replace(/\.$/, ""); return f.length > 160 ? f.slice(0, f.lastIndexOf(" ", 157)).replace(/[,;:(]$/, "") + "…" : f + "."; };

/* Builds the email from what is already published: items added in the last 24 hours, up to 3 stories and 2 items each. */
export function buildEmail(stories, briefing, now = new Date()) {
  const since = new Date(now.getTime() - 24 * 3600e3).toISOString();
  const day = `${MONTHS[now.getUTCMonth()]} ${now.getUTCDate()}`;
  const withId = (st) => { const seen = {}; return st.events.map((e) => { seen[e.date] = (seen[e.date] || 0) + 1; return { ...e, id: seen[e.date] === 1 ? `e-${e.date}` : `e-${e.date}-${seen[e.date]}` }; }); };
  const groups = stories.map((st) => ({ st, items: withId(st).filter((e) => e.added && e.added >= since && LABEL[e.label]).sort((a, b) => b.added.localeCompare(a.added)) }))
    .filter((g) => g.items.length).sort((a, b) => b.items.length - a.items.length).slice(0, 3);
  const lines = [`Good morning. Here is what changed in the last 24 hours on the stories Unowned follows. Every item is labelled, and every source is on the site.`, ""];
  if (briefing) lines.push(`**Listen:** [today's briefing, about 90 seconds](${SITE}/briefing/)`, "");
  if (!groups.length) {
    lines.push(`No major new developments in the last 24 hours. We checked every story; the full timelines are at [unownednews.com](${SITE}/).`);
  }
  for (const { st, items } of groups) {
    lines.push(`## ${st.title}`, "");
    for (const e of items.slice(0, 2)) lines.push(`- **${LABEL[e.label]}:** ${first(e.text)} [Details](${SITE}/${st.slug}/#${e.id})`);
    lines.push("", `[Full timeline and sources](${SITE}/${st.slug}/)`, "");
  }
  lines.push("---", "", `Unowned is news nobody owns. [How we label](${SITE}/how-we-work/#labels) · [Who owns Unowned](${SITE}/who-owns-unowned/)`, "", "You're getting this because you signed up at unownednews.com.");
  const titles = groups.map((g) => g.st.nav || g.st.title);
  const subject = `Today in 30 seconds, ${day}${titles.length ? ": " + titles.join(", ") : ""}`;
  return { subject: subject.length > 140 ? subject.slice(0, subject.lastIndexOf(",", 137)) + "…" : subject, body: lines.join("\n") };
}
