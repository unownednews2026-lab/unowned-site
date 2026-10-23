/* Daily audio briefing: a page at /briefing/ and a podcast feed at /podcast.xml.
   Scripts live in content/briefings/YYYY-MM-DD.json; the MP3 for each is recorded by the "Briefing audio" GitHub Action
   into static/briefings/YYYY-MM-DD.mp3. A briefing appears only once its audio exists. */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadNewsletter, signupBox } from "./newsletter.mjs";

export function loadBriefings() {
  const dir = "content/briefings";
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => {
    const b = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const mp3 = `static/briefings/${f.replace(".json", ".mp3")}`;
    if (!existsSync(mp3)) return null;
    const bytes = statSync(mp3).size;
    // The recorder (tools/briefing_audio.py) encodes at a constant 128 kbit/s, so length follows from file size.
    return { ...b, date: f.slice(0, 10), audio: "/" + mp3.slice("static/".length), bytes, seconds: Math.round((bytes * 8) / 128000) };
  }).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date));
}

/* "1:23" for 83 seconds. */
export const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/* The newest briefing if it is from today or yesterday (UTC), else null, so a stale briefing is never promoted. */
export function freshBriefing(briefings) {
  const b = briefings[0];
  if (!b) return null;
  // Show the newest briefing for up to 3 days, so one missed day doesn't make the player disappear.
  // The player always shows the briefing's date, so readers can see how recent it is.
  const cutoff = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
  return b.date >= cutoff ? b : null;
}

/* Compact player for the home page and story pages: a link without JavaScript, an inline play button with it (briefing.js). */
export function miniPlayer(b, { esc, long, label = "Daily briefing", note = "" }) {
  const title = b.title.length > 70 ? b.title.slice(0, b.title.lastIndexOf(" ", 70)) + "…" : b.title;
  return `<div class="brief-mini" data-date="${b.date}">
  <a class="brief-play" href="/briefing/" aria-label="Play the ${esc(long(b.date))} briefing, ${mmss(b.seconds)} long"><span aria-hidden="true">▶</span></a>
  <div class="brief-text"><a href="/briefing/">${esc(label)}</a><span class="brief-meta">${esc(long(b.date).replace(/, \d{4}$/, ""))} · ${mmss(b.seconds)}${note ? " · " + esc(note) : ""}</span><span class="brief-title">${esc(title)}</span></div>
  <audio preload="none" src="${b.audio}"></audio>
</div>`;
}

/* Full player for the top of the home page: a real audio control readers can play, pause and scrub right there. */
export function homePlayer(b, { esc, long }) {
  return `<section class="brief-home" data-date="${b.date}" aria-labelledby="brief-home-h">
  <h2 id="brief-home-h">🎧 Daily audio briefing <span class="brief-meta">${esc(long(b.date).replace(/, \d{4}$/, ""))} · ${mmss(b.seconds)}</span></h2>
  <p class="brief-title-full">${esc(b.title)}</p>
  <audio controls preload="metadata" src="${b.audio}"></audio>
  <p class="brief-listen"><a class="listen-btn sp" href="https://open.spotify.com/show/4EUJj9NhyL3hpcKi9QUszE" rel="noopener"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="12" cy="12" r="12" fill="#1DB954"/><path d="M6 9.5c4-1.3 8.5-1 12 1M7 12.8c3.3-1 7-.7 10 .9M8 15.8c2.7-.7 5.5-.5 8 .7" stroke="#000" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>Listen on Spotify</a><a class="listen-btn ap" href="https://podcasts.apple.com/us/podcast/unowned-daily-briefing/id6824657998" rel="noopener"><svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><rect width="24" height="24" rx="6" fill="#9933CC"/><circle cx="12" cy="10" r="2.4" fill="#fff"/><path d="M12 13.5v5" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M7.5 14.5a6 6 0 1 1 9 0" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>Listen on Apple Podcasts</a></p>
  <p class="brief-links"><a href="/briefing/">Read the transcript</a></p>
</section>`;
}

export function buildBriefing({ briefings, stories, write, simple, esc, long, SITE }) {
  if (!briefings.length) return;
  const titleOf = Object.fromEntries(stories.map((s) => [s.slug, s.title]));
  const [today, ...past] = briefings;
  const storyLinks = (b) => (b.stories || []).filter((s) => titleOf[s]).map((s) => `<a href="/${s}/">${esc(titleOf[s])}</a>`).join(" · ");
  simple("/briefing/", "Daily briefing", "A short spoken update on the stories Unowned is following, read by a synthetic voice from our checked timelines.", `<div class="prose">
<p class="eyebrow">${esc(long(today.date))} · ${mmss(today.seconds)}</p>
<h2>${esc(today.title)}</h2>
<audio id="briefing-audio" controls preload="metadata" src="${today.audio}" style="width:100%"></audio>
<p class="src">Read by a synthetic voice. Every fact comes from our published timelines, with the same labels: <a href="/how-we-work/#labels">how we label</a>. Full stories: ${storyLinks(today)}</p>
<details class="fold"><summary>Read the transcript</summary>${today.script.map((p) => `<p>${esc(p)}</p>`).join("")}</details>
${signupBox(loadNewsletter(), { esc, heading: "Prefer email? Get it every morning" })}
<div class="podcast-box">
  <h3>Get it every morning in your podcast app</h3>
  <p class="listen-on"><a href="https://podcasts.apple.com/us/podcast/unowned-daily-briefing/id6824657998" rel="noopener">Listen on Apple Podcasts</a> · <a href="https://open.spotify.com/show/4EUJj9NhyL3hpcKi9QUszE" rel="noopener">Listen on Spotify</a></p>
  <p class="podcast-url"><code>${SITE}/podcast.xml</code> <button type="button" class="copy-feed" data-copy="${SITE}/podcast.xml" hidden>Copy link</button></p>
  <p class="src">In most podcast apps, choose "Add by URL" and paste the link. In Apple Podcasts: Library, then the ⋯ menu, then "Follow a Show by URL". A new briefing arrives each morning, around 06:00 UTC.</p>
</div>
${past.length ? `<h2>Earlier briefings</h2><ul>${past.slice(0, 14).map((b) => `<li>${esc(long(b.date))} · ${mmss(b.seconds)}: ${esc(b.title)} <audio controls preload="none" src="${b.audio}" style="width:100%"></audio></li>`).join("")}</ul>` : ""}
</div>`, ["/assets/briefing.js"]);
  write("podcast.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Unowned Daily Briefing</title><link>${SITE}/briefing/</link><language>en</language>
<atom:link href="${SITE}/podcast.xml" rel="self" type="application/rss+xml"/>
<description>News nobody owns. A short daily update on the stories Unowned is following: what's confirmed, what's disputed, and what's next. Read by a synthetic voice from our checked, sourced timelines.</description>
<itunes:author>Unowned</itunes:author><itunes:owner><itunes:name>Unowned</itunes:name><itunes:email>podcast@unownednews.com</itunes:email></itunes:owner><itunes:type>episodic</itunes:type><copyright>© Unowned</copyright><itunes:explicit>false</itunes:explicit><itunes:category text="News"><itunes:category text="Daily News"/></itunes:category>
<itunes:image href="${SITE}/briefings/cover.png"/><image><url>${SITE}/briefings/cover.png</url><title>Unowned Daily Briefing</title><link>${SITE}/briefing/</link></image>
${briefings.slice(0, 60).map((b) => `<item><title>${esc(`${long(b.date)}: ${b.title}`)}</title><link>${SITE}/briefing/</link><guid isPermaLink="false">unowned-briefing-${b.date}</guid><pubDate>${new Date(b.date + "T06:00:00Z").toUTCString()}</pubDate><description>${esc(b.script.join(" "))}</description><enclosure url="${SITE}${b.audio}" length="${b.bytes}" type="audio/mpeg"/><itunes:duration>${b.seconds}</itunes:duration></item>`).join("\n")}
</channel></rss>
`);
}
