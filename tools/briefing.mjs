/* Daily audio briefing: a page at /briefing/ and a podcast feed at /podcast.xml.
   Scripts live in content/briefings/YYYY-MM-DD.json; the MP3 for each is recorded by the "Briefing audio" GitHub Action
   into static/briefings/YYYY-MM-DD.mp3. A briefing appears only once its audio exists. */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";

export function loadBriefings() {
  const dir = "content/briefings";
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => {
    const b = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const mp3 = `static/briefings/${f.replace(".json", ".mp3")}`;
    return existsSync(mp3) ? { ...b, date: f.slice(0, 10), audio: "/" + mp3.slice("static/".length), bytes: statSync(mp3).size } : null;
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
}

export function buildBriefing({ briefings, stories, write, simple, esc, long, SITE }) {
  if (!briefings.length) return;
  const titleOf = Object.fromEntries(stories.map((s) => [s.slug, s.title]));
  const [today, ...past] = briefings;
  const storyLinks = (b) => (b.stories || []).filter((s) => titleOf[s]).map((s) => `<a href="/${s}/">${esc(titleOf[s])}</a>`).join(" · ");
  simple("/briefing/", "Daily briefing", "A short spoken update on the stories Unowned is following, read by a synthetic voice from our checked timelines.", `<div class="prose">
<p class="eyebrow">${esc(long(today.date))}</p>
<h2>${esc(today.title)}</h2>
<audio id="briefing-audio" controls preload="metadata" src="${today.audio}" style="width:100%"></audio>
<p class="src">Read by a synthetic voice. Every fact comes from our published timelines, with the same labels: <a href="/how-we-work/#labels">how we label</a>. Full stories: ${storyLinks(today)}</p>
<p>Listen on the go: add <strong>${SITE}/podcast.xml</strong> to your podcast app.</p>
<details class="fold"><summary>Read the transcript</summary>${today.script.map((p) => `<p>${esc(p)}</p>`).join("")}</details>
${past.length ? `<h2>Earlier briefings</h2><ul>${past.slice(0, 14).map((b) => `<li>${esc(long(b.date))}: ${esc(b.title)} <audio controls preload="none" src="${b.audio}" style="width:100%"></audio></li>`).join("")}</ul>` : ""}
</div>`);
  write("podcast.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Unowned Daily Briefing</title><link>${SITE}/briefing/</link><language>en</language>
<atom:link href="${SITE}/podcast.xml" rel="self" type="application/rss+xml"/>
<description>News nobody owns. A short daily update on the stories Unowned is following: what's confirmed, what's disputed, and what's next. Read by a synthetic voice from our checked, sourced timelines.</description>
<itunes:author>Unowned</itunes:author><itunes:explicit>false</itunes:explicit><itunes:category text="News"><itunes:category text="Daily News"/></itunes:category>
<itunes:image href="${SITE}/briefings/cover.png"/><image><url>${SITE}/briefings/cover.png</url><title>Unowned Daily Briefing</title><link>${SITE}/briefing/</link></image>
${briefings.slice(0, 60).map((b) => `<item><title>${esc(`${long(b.date)}: ${b.title}`)}</title><link>${SITE}/briefing/</link><guid isPermaLink="false">unowned-briefing-${b.date}</guid><pubDate>${new Date(b.date + "T06:00:00Z").toUTCString()}</pubDate><description>${esc(b.script.join(" "))}</description><enclosure url="${SITE}${b.audio}" length="${b.bytes}" type="audio/mpeg"/></item>`).join("\n")}
</channel></rss>
`);
}
