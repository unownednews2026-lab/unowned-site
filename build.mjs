// Builds the Unowned website into ./dist from ./content and ./static. Run: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";

const SITE = "https://unownednews.com";
const SOCIAL = [
  ["X", "https://x.com/unownednews"],
  ["Instagram", "https://www.instagram.com/unownednews/"],
];
const OUT = "dist";
const LABEL = { confirmed: "Confirmed", reported: "Reported", disputed: "Disputed", alleged: "Alleged", pending: "Checking" };

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const short = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}`;
const long = (d) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`;
const itemId = (e) => e.id;
/* Give every event a unique anchor: e-YYYY-MM-DD for the first entry on a date (keeps old links working), then -2, -3... */
function withIds(st) {
  const seen = {};
  st.events.forEach((e) => { seen[e.date] = (seen[e.date] || 0) + 1; e.id = seen[e.date] === 1 ? `e-${e.date}` : `e-${e.date}-${seen[e.date]}`; });
  return st;
}
const voteWidget = (st) => `<div class="votes" data-story="${st.slug}" role="group" aria-label="Vote on ${esc(st.title)}"><button type="button" class="up" aria-pressed="false" aria-label="Vote up">▲</button><span class="score" aria-live="polite">0</span><button type="button" class="down" aria-pressed="false" aria-label="Vote down">▼</button></div>`;
const added = (e) => e.added ? `<time class="ago" datetime="${e.added}">Added ${long(e.added.slice(0, 10))}</time>` : "";
const MEANING = { confirmed: "Two or more independent outlets", reported: "One outlet so far", disputed: "Accounts conflict; we show both", alleged: "One side's claim, not yet confirmed", pending: "Expected; outcome being checked" };
const stamp = (l) => `<span class="stamp s-${l}" title="${LABEL[l]}: ${MEANING[l]}">${LABEL[l]}</span>`;
const keyStrip = () => `<div class="key" role="note" aria-label="What our labels mean"><p class="key-title">How sure are we? Every item carries a label:</p><ul>${["confirmed", "reported", "disputed", "alleged", "pending"].map((l) => `<li>${stamp(l)}<span>${MEANING[l]}</span></li>`).join("")}</ul></div>`;
const newestAdded = (st) => st.events.reduce((m, e) => (e.added && e.added > m ? e.added : m), st.updatedAt || "");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function write(path, content) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const NAV = [
  ["/", "Trending"],
  ["/submit/", "Send a link"],
  ["/how-we-work/", "How we work"],
  ["/who-owns-unowned/", "Ownership"],
];

function page({ title, description, path, body, scripts = [], og = "/assets/og-default.png", type = "website" }) {
  const url = SITE + path;
  const nav = NAV.map(([href, label]) => `<a href="${href}"${href === path ? ' aria-current="page"' : ""}>${esc(label)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate" type="application/rss+xml" title="Unowned updates" href="/feed.xml">
<meta property="og:site_name" content="Unowned">
<meta property="og:type" content="${type}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${SITE}${og}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@unownednews">
<meta name="referrer" content="no-referrer">
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<div class="wrap">
<header class="site-head">
  <a class="wordmark" href="/">Un<span>owned</span></a>
  <nav class="site-nav" aria-label="Main">${nav}</nav>
</header>
<p class="tagline">News nobody owns. Told by the people who were there.</p>
<p class="note edition" role="note">Early edition: we're still checking some entries. Spot an error? <a href="/submit/">Tell us</a>.</p>
<main>
${body}
</main>
<footer class="site-foot">
  <p><strong>Unowned</strong> is not owned by any government, party, billionaire or advertiser.</p>
  <nav aria-label="Footer">
    <a href="/how-we-work/">How we work</a><a href="/who-owns-unowned/">Who owns Unowned</a><a href="/corrections/">Corrections</a><a href="/privacy/">Privacy</a><a href="/feed.xml">RSS</a>
    ${SOCIAL.map(([n, u]) => `<a href="${u}" rel="noopener">${n}</a>`).join("")}
  </nav>
</footer>
</div>
${["/assets/time.js", ...scripts].map((s) => `<script src="${s}" defer></script>`).join("\n")}
</body>
</html>
`;
}

/* ---------- Story page ---------- */
function srcLine(S, keys) {
  if (!keys.length) return `<p class="src">Sources to follow</p>`;
  return `<p class="src">Sources: ${keys.map((k) => `<a href="${esc(S[k][1])}" rel="noopener nofollow">${esc(S[k][0])}</a>`).join(" · ")}</p>`;
}

function storyPage(st) {
  const S = st.sources;
  const path = `/${st.slug}/`;
  const nonPending = st.events.filter((e) => e.label !== "pending");
  const latest = nonPending.slice(-6).reverse();
  const counts = { events: st.events.length, claims: st.claims.length };
  const firstMonth = long(st.events[0].date).replace(/ \d+,/, "");
  const recent = st.events.filter((e) => e.added && Date.parse(e.added) > Date.now() - 48 * 3600e3).length;
  const overview = [
    ["latest", "Live updates", recent ? `${plural(recent, "update", "updates")} in the last 48 hours` : `Newest: ${short(nonPending[nonPending.length - 1].date)}`, null],
    ["summary", "Where things stand", "The story so far, in three paragraphs", null],
    ["glance", "At a glance", "Charts, figures and a map", null],
    ["timeline", "Timeline", `${plural(st.events.length, "event", "events")} since ${firstMonth}`, st.events.length],
    ["disputed", "Disputed claims", `${plural(st.claims.length, "claim", "claims")}, both sides shown`, st.claims.length],
    ["accountability", "Accountability log", `${plural(st.accountability.length, "action", "actions")} by authorities`, st.accountability.length],
    ["places", "Places", `${plural(st.places.length, "place", "places")} on the map`, st.places.length],
    ["sources", "Sources", `${plural(Object.keys(st.sources).length, "source", "sources")}, every one linked`, Object.keys(st.sources).length],
  ];

  const latestHtml = latest.map((e) => {
    const t = e.text.length > 150 ? e.text.slice(0, e.text.lastIndexOf(" ", 150)).replace(/[.,;:]$/, "") + "…" : e.text;
    return `<a class="card" href="#${itemId(e)}"><div class="when"><span>${long(e.date)}</span>${stamp(e.label)}${added(e)}</div><p>${esc(t)}</p></a>`;
  }).join("\n");

  const timelineHtml = st.phases.map((p) => {
    const rows = st.events.filter((e) => e.phase === p.id);
    if (!rows.length) return "";
    const items = rows.map((e) => {
      const post = `${long(e.date)}: ${e.text}\n\nFull timeline and sources on Unowned: ${SITE}${path}#${itemId(e)}`;
      const share = e.label === "pending" ? "" : `<button type="button" class="share" data-post="${esc(post)}" aria-label="Share the ${esc(short(e.date))} entry">Share</button>`;
      return `<li id="${itemId(e)}" data-label="${e.label}"><span class="date">${short(e.date)}</span><div class="body"><div class="item-top">${stamp(e.label)}${share}</div><p>${esc(e.text)}</p>${srcLine(S, e.sources)}</div></li>`;
    }).join("\n");
    return `<div class="phase-block"><div class="phase"><p class="eyebrow">${esc(p.when)}</p><h3>${esc(p.name)}</h3></div><ol class="timeline">${items}</ol></div>`;
  }).join("\n");

  const claimsHtml = st.claims.map((c) => `<article class="claim">
  <div class="claim-head"><h3>${esc(c.title)}</h3>${stamp(c.label)}</div>
  <div class="sides">
    <div class="side"><p class="eyebrow">One account</p><p>${esc(c.a)}</p>${srcLine(S, c.aSrc)}</div>
    <div class="side"><p class="eyebrow">Other account</p><p>${esc(c.b)}</p>${srcLine(S, c.bSrc)}</div>
  </div>
  <p class="status">Status: ${esc(c.status)}</p>
</article>`).join("\n");

  const accHtml = st.accountability.map((a) => `<tr><td class="d" data-th="Date">${esc(a.date)}</td><td data-th="Action">${esc(a.action)}</td><td data-th="By">${esc(a.by)}</td><td data-th="Label">${stamp(a.label)}</td></tr>`).join("\n");
  const placesHtml = st.places.map((p) => `<div class="place"><strong>${esc(p.name)}</strong><span>${esc(p.desc)}</span></div>`).join("\n");
  const gapsHtml = st.gaps.map((g) => `<li>${esc(g)}</li>`).join("");
  const corrHtml = st.corrections.length
    ? `<ul>${st.corrections.map((c) => `<li>${esc(long(c.date))}: ${esc(c.text)}</li>`).join("")}</ul>`
    : `<p class="src">No corrections yet. Every change made after publishing will be listed here with its date.</p>`;
  const srcHtml = st.sourceGroups.map(([name, keys]) => `<div><strong>${esc(name)}</strong><ul>${keys.map((k) => `<li><a href="${esc(S[k][1])}" rel="noopener nofollow">${esc(S[k][0])}</a></li>`).join("")}</ul></div>`).join("\n");

  // Only what the charts need goes into the page as data.
  const chartData = { phases: st.phases, events: st.events.map(({ date, milestone, hot, callout }) => ({ date, milestone, hot, callout })), places: st.places, figures: st.figures, timelineChart: st.timelineChart, map: st.map };

  const body = `
<header class="top">
  <p class="eyebrow">${esc(st.kicker)}</p>
  <h1>${esc(st.title)}</h1>
  <p class="lede">${esc(st.dek)}</p>
  <div class="meta-row"><span class="live">${esc(st.status)}</span><span>Updated ${st.updatedAt ? `<time class="ago" datetime="${st.updatedAt}">${long(st.updated)}</time>` : long(st.updated)}</span><span>${counts.events} events · ${counts.claims} disputed claims</span>${voteWidget(st)}</div>
  <p class="region-line"><span class="tag">${esc(st.region)}</span>${(st.topics || []).map((t) => `<span class="tag soft">${esc(t)}</span>`).join("")}</p>
</header>

${keyStrip()}
<nav class="overview" aria-labelledby="h-overview">
  <h2 id="h-overview" class="overview-title">On this page</h2>
  <ol>
    ${overview.map(([id, name, detail]) => `<li><a href="#${id}"><strong>${esc(name)}</strong><span>${esc(detail)}</span></a></li>`).join("\n    ")}
  </ol>
</nav>
<nav class="secnav" aria-label="Jump to section"><div class="secnav-in">${overview.map(([id, name, , n]) => `<a href="#${id}">${esc(name)}${n != null ? ` <span class="n">${n}</span>` : ""}</a>`).join("")}<a href="/" class="home-link">All stories</a></div></nav>

<section id="latest" aria-labelledby="h-latest">
  <div class="section-head"><h2 id="h-latest"><span class="live-dot" aria-hidden="true"></span>Live updates</h2><p>Newest first. We check for new developments about every 30 minutes and publish each one once a person has reviewed it. This page tells you when something new arrives.</p></div>
  <div class="latest" data-live-story="${st.slug}" data-newest="${newestAdded(st)}">${latestHtml}</div>
</section>

<section id="summary" aria-labelledby="h-summary">
  <h2 id="h-summary">Where things stand</h2>
  <div class="summary">${st.summary.map((p) => `<p>${esc(p)}</p>`).join("")}</div>
</section>

<section id="glance" aria-labelledby="h-glance">
  <div class="section-head"><h2 id="h-glance">At a glance</h2><p>Figures come from the sources named under each chart. Where sources disagree, the range is shown.</p></div>
  <div class="figs">
    <figure class="wide"><h3>${esc(st.timelineChart.title)}</h3>
      <div class="chart-wrap"><svg class="chart" id="phasechart" viewBox="0 0 720 150" role="img" aria-label="${esc(st.timelineChart.aria)}"></svg></div>
      <figcaption>${esc(st.timelineChart.caption)}</figcaption></figure>
    ${Object.entries(st.figures).map(([k, f]) => `<figure${f.type === "range" ? ' class="wide"' : ""}><h3>${esc(f.title)}</h3>
      <svg class="chart" id="fig-${k}" viewBox="0 0 ${f.type === "range" ? "720 " + (f.rows.length * 34 + 36) : "340 " + (f.rows.length * 40 + 20)}" role="img" aria-label="${esc(f.aria)}"></svg>
      <figcaption>${esc(f.caption)}</figcaption></figure>`).join("\n    ")}
    <figure class="wide"><h3>Where it happened</h3>
      <div class="chart-wrap"><svg class="chart" id="mapchart" viewBox="0 0 720 360" role="img" aria-label="${esc(st.map.aria)}"></svg></div>
      <figcaption>Positions are approximate, plotted by latitude and longitude. This is not a map of borders.</figcaption></figure>
  </div>
</section>

<section id="timeline" aria-labelledby="h-timeline">
  <div class="section-head"><h2 id="h-timeline">Timeline</h2><p>Every entry links to its sources. Filter by how well an item is supported.</p></div>
  <div class="legend" aria-label="Label meanings">
    <span>${stamp("confirmed")} two or more independent outlets</span>
    <span>${stamp("reported")} one outlet so far</span>
    <span>${stamp("disputed")} conflicting accounts</span>
    <span>${stamp("alleged")} one party's claim</span>
  </div>
  <div class="filters" role="group" aria-label="Filter timeline">
    <button type="button" data-f="all" aria-pressed="true">All</button>
    <button type="button" data-f="confirmed" aria-pressed="false">Confirmed</button>
    <button type="button" data-f="reported" aria-pressed="false">Reported</button>
    <button type="button" data-f="disputed" aria-pressed="false">Disputed</button>
    <button type="button" data-f="alleged" aria-pressed="false">Alleged</button>
  </div>
  ${timelineHtml}
  <p class="empty" id="tl-empty" hidden>No entries with this label.</p>
</section>

<section id="disputed" aria-labelledby="h-disputed">
  <div class="section-head"><h2 id="h-disputed">Disputed claims</h2><p>Where the sides disagree, both accounts are shown with their sources. The status line says what has been independently established.</p></div>
  <div class="claims">${claimsHtml}</div>
</section>

<section id="accountability" aria-labelledby="h-acc">
  <div class="section-head"><h2 id="h-acc">Accountability log</h2><p>Arrests, detentions, restrictions, investigations and legal cases connected to this story.</p></div>
  <div class="table-wrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Action</th><th scope="col">By</th><th scope="col">Label</th></tr></thead><tbody>${accHtml}</tbody></table></div>
</section>

<section id="places" aria-labelledby="h-places">
  <div class="section-head"><h2 id="h-places">Places</h2><p>Cities with reported protests or incidents, shown on the map above.</p></div>
  <div class="places">${placesHtml}</div>
</section>

<section id="method" aria-labelledby="h-method">
  <div class="section-head"><h2 id="h-method">How this page is made</h2><p>Only published reporting and publicly posted material. AI helps gather and organize it; a person reviews every item before it is published. <a href="/how-we-work/">Our full standards</a>.</p></div>
  <div class="two">
    <div class="panel"><h3>Corrections</h3>${corrHtml}</div>
    <div class="panel"><h3>Still being checked</h3><ul>${gapsHtml}</ul></div>
  </div>
  <p class="note">Seen something we've missed or got wrong? <a href="/submit/">Send a public link or a correction</a>. No name or email needed.</p>
</section>

<section id="sources" aria-labelledby="h-sources">
  <h2 id="h-sources">Sources</h2>
  <div class="srclist">${srcHtml}</div>
</section>

<script type="application/json" id="story-data">${JSON.stringify(chartData).replace(/</g, "\\u003c")}</script>`;

  write(`${st.slug}/index.html`, page({
    title: `${st.title} | Unowned`,
    description: st.dek,
    path,
    body,
    scripts: ["/assets/story.js", "/assets/votes.js", "/assets/live.js"],
    og: existsSync(`static/assets/og-${st.slug}.png`) ? `/assets/og-${st.slug}.png` : "/assets/og-default.png",
    type: "article",
  }));
  return { st, latest };
}

/* ---------- Static pages ---------- */
function simple(path, title, description, inner, scripts) {
  write(`${path.slice(1)}index.html`, page({ title: `${title} | Unowned`, description, path, scripts, body: `<header class="top"><h1>${esc(title)}</h1></header><section>${inner}</section>` }));
}

function build() {
  rmSync(OUT, { recursive: true, force: true });
  cpSync("static", OUT, { recursive: true });

  const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => withIds(JSON.parse(readFileSync(join("content/stories", f), "utf8"))));
  const built = stories.map(storyPage);

  /* Home */
  const byUpdate = [...built].sort((a, b) => (b.st.updatedAt || b.st.updated).localeCompare(a.st.updatedAt || a.st.updated));
  const cards = byUpdate.map(({ st, latest }, i) => `<li class="trend" data-story="${st.slug}" data-order="${i}">
    <span class="rank" aria-hidden="true">${i + 1}</span>
    ${voteWidget(st)}
    <a class="story-card" href="/${st.slug}/">
      <div class="meta-row"><span class="tag">${esc(st.region)}</span><span class="live">${esc(st.status)}</span><span>Updated ${st.updatedAt ? `<time class="ago" datetime="${st.updatedAt}">${long(st.updated)}</time>` : long(st.updated)}</span></div>
      <h3>${esc(st.title)}</h3><p>${esc(st.dek)}</p>
      <p class="src">Latest: ${esc(long(latest[0].date))}, ${esc(latest[0].text.slice(0, latest[0].text.indexOf(". ") + 1 || 140))}</p>
    </a>
  </li>`).join("\n");
  write("stories.json", JSON.stringify(stories.map((s) => s.slug)));
  write("live.json", JSON.stringify(stories.flatMap((st) => st.events.filter((e) => e.added && e.label !== "pending").map((e) => ({ story: st.slug, storyTitle: st.title, id: e.id, label: e.label, added: e.added, text: e.text.split(". ")[0] }))).sort((a, b) => b.added.localeCompare(a.added) || b.id.localeCompare(a.id)).slice(0, 30)));
  const regions = [...new Set(byUpdate.map(({ st }) => st.region))];
  const live = stories.flatMap((st) => st.events.filter((e) => e.label !== "pending").map((e, i) => ({ st, e, i })))
    .sort((a, b) => (b.e.added || b.e.date).localeCompare(a.e.added || a.e.date) || b.e.date.localeCompare(a.e.date) || b.i - a.i).slice(0, 6);
  const liveHtml = live.map(({ st, e }) => `<li><a href="/${st.slug}/#${itemId(e)}"><span class="when">${short(e.date)} ${stamp(e.label)} ${added(e)}</span><span class="what">${esc(e.text.split(". ")[0].replace(/\.$/, ""))}.</span><span class="story">${esc(st.title)}</span></a></li>`).join("\n");
  write("index.html", page({
    title: "Unowned",
    description: "News nobody owns. Verified, sourced reporting from the people who were there, with both sides shown.",
    path: "/",
    scripts: ["/assets/votes.js", "/assets/live.js"],
    body: `
<header class="top">
  <h1>News nobody owns.</h1>
  <p class="lede">Independent tracking of the stories that matter, wherever they happen. We gather what people on the ground record and report, check it, label how certain it is, and keep each story up to date. Every item links to its source. Where accounts disagree, we show both.</p>
  <p class="coverage"><span>Following now in</span>${regions.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}<a href="/submit/#suggest">Suggest a story to follow</a></p>
</header>
<nav class="overview home-overview" aria-label="On Unowned">
  <ol>
    <li><a href="#h-stories"><strong>Trending now</strong><span>${plural(stories.length, "story", "stories")} ranked by your votes</span></a></li>
    <li><a href="#h-live"><strong>Live updates</strong><span>The newest checked developments</span></a></li>
    <li><a href="#h-how"><strong>Why Unowned</strong><span>No owner, no ads, honest labels</span></a></li>
    <li><a href="/submit/"><strong>Send a link</strong><span>Help us cover a story; no name needed</span></a></li>
  </ol>
</nav>

<section aria-labelledby="h-stories"><div class="section-head"><h2 id="h-stories">Trending now</h2><p>Ranked by readers' votes. Vote up the stories you want followed most closely.</p></div><ol class="trending">${cards}</ol></section>
<section aria-labelledby="h-live"><div class="section-head"><h2 id="h-live"><span class="live-dot" aria-hidden="true"></span>Live updates</h2><p>The newest checked developments across every story. We check for news about every 30 minutes; this page tells you when something new arrives.</p></div>${keyStrip()}<ol class="livefeed" data-live-story="" data-newest="${stories.map(newestAdded).sort().pop()}">${liveHtml}</ol></section>
<section aria-labelledby="h-how">
  <h2 id="h-how">Why Unowned</h2>
  <div class="pillars">
    <div class="panel"><h3>Nobody owns it</h3><p>Not a government, party, billionaire or advertiser. No single funder can pressure what we publish.</p></div>
    <div class="panel"><h3>From the ground</h3><p>Built from what witnesses and local reporters record, organized into a clear, ongoing record.</p></div>
    <div class="panel"><h3>Honest about certainty</h3><p>Every item is labelled confirmed, reported, disputed or alleged, and corrections are made in public.</p></div>
  </div>
</section>
<section aria-labelledby="h-contrib">
  <h2 id="h-contrib">Help us get it right</h2>
  <p class="prose">Send us a link to a public post we've missed, or tell us where we're wrong. <a href="/submit/">Contribute safely</a>, no name or email needed.</p>
</section>`,
  }));

  /* Submit */
  const storyOptions = stories.map((s) => `<option value="${s.slug}">${esc(s.title)}</option>`).join("") + `<option value="other">Something else</option>`;
  simple("/submit/", "Send a link or a correction", "Send Unowned a link to a public post, or report an error. No name or email needed.", `
<div class="prose">
  <p>Help us cover what's happening and fix what we get wrong. These forms don't ask for your name, email or phone number, and we don't store your IP address.</p>
  <p class="note"><strong>Right now we only accept links to posts and articles that are already public.</strong> Please don't send original photos, videos, documents or anything private yet; we'll open a secure way to do that once it has been independently audited. Don't send anything from a work or shared device, and never put yourself in danger to record something.</p>
</div>
<h2>Send a public link</h2>
<p class="prose" id="suggest">Know a story we should be following, anywhere in the world? Send a link to public reporting about it and choose "Something else".</p>
<form class="contribute" method="post" action="/api/submit" data-label="Send link">
  <input type="hidden" name="type" value="link">
  <div class="hp" aria-hidden="true"><label for="website-1">Leave this empty</label><input id="website-1" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <div class="field"><label for="story-1">Which story is it about?</label><select id="story-1" name="story">${storyOptions}</select></div>
  <div class="field"><label for="url-1">Link to the public post or article</label><input id="url-1" name="url" type="url" required inputmode="url" placeholder="https://" autocomplete="off"></div>
  <div class="field"><label for="details-1">What does it show?</label><span class="hint">Where and when, if you know. One or two sentences is enough.</span><textarea id="details-1" name="details" required maxlength="2000"></textarea></div>
  <button class="primary" type="submit">Send link</button>
  <p class="form-msg" role="status" hidden></p>
</form>
<h2>Report an error</h2>
<form class="contribute" method="post" action="/api/submit" data-label="Send correction">
  <input type="hidden" name="type" value="correction">
  <div class="hp" aria-hidden="true"><label for="website-2">Leave this empty</label><input id="website-2" name="website" type="text" tabindex="-1" autocomplete="off"></div>
  <div class="field"><label for="story-2">Which story?</label><select id="story-2" name="story">${storyOptions}</select></div>
  <div class="field"><label for="item-2">Which entry? (optional)</label><span class="hint">For example the date, like "July 20".</span><input id="item-2" name="item" type="text" maxlength="200" autocomplete="off"></div>
  <div class="field"><label for="details-2">What's wrong?</label><textarea id="details-2" name="details" required maxlength="2000"></textarea></div>
  <div class="field"><label for="url-2">Link that supports the correction (optional)</label><input id="url-2" name="url" type="url" inputmode="url" placeholder="https://" autocomplete="off"></div>
  <button class="primary" type="submit">Send correction</button>
  <p class="form-msg" role="status" hidden></p>
</form>`, ["/assets/submit.js"]);

  simple("/thanks/", "Thank you", "Your contribution was received.", `<div class="prose"><p>Received. A person will review it before anything is published. We kept no record of who sent it.</p><p><a href="/">Back to Unowned</a></p></div>`);

  simple("/how-we-work/", "How we work", "Unowned's standards for sourcing, labelling, fairness and corrections.", `<div class="prose">
<p>Unowned turns scattered reports and footage into a clear, checked record. These are the rules every item follows.</p>
<h2>Sourcing</h2>
<ol>
<li>We use published reporting and publicly posted material. Every item links to where it came from.</li>
<li>An item is marked <strong>confirmed</strong> only when two or more independent outlets report it, ideally with different leanings.</li>
<li>We link to original posts rather than re-uploading them, and say who posted them and when. We check for old or recycled footage before using any clip.</li>
</ol>
<h2>Labels</h2>
<ul>
<li>${stamp("confirmed")} two or more independent outlets</li>
<li>${stamp("reported")} one outlet so far; we are looking for a second</li>
<li>${stamp("disputed")} the sides give conflicting accounts, and we show both</li>
<li>${stamp("alleged")} one party's claim that has not been independently confirmed</li>
</ul>
<h2>Fairness</h2>
<ul>
<li>Every disputed event shows both accounts, in their own terms.</li>
<li>We describe actions, not motives, and keep commentary out of the record.</li>
<li>We don't name ordinary protesters or private individuals.</li>
</ul>
<h2>How AI is used</h2>
<p>AI helps us find, translate, sort and draft. A person reviews and approves every item before it is published.</p>
<h2>Corrections</h2>
<p>We correct mistakes quickly and in public. Every change made after publishing is listed with its date. <a href="/submit/">Report an error</a>.</p>
</div>`);

  simple("/who-owns-unowned/", "Who owns Unowned", "Unowned is not owned by any government, party, billionaire or advertiser.", `<div class="prose">
<p>Unowned is built on one idea: news nobody owns can't be bent by an owner.</p>
<ul>
<li><strong>No government, party, billionaire or advertiser owns or controls Unowned.</strong></li>
<li>We don't run advertising.</li>
<li>We will publish every funder, cap how much any one funder can give, and place Unowned in a structure that cannot be bought or sold.</li>
<li>Editorial decisions are made under our published standards, and no funder has a say in them.</li>
<li>If any government or company demands we remove something, we will say so publicly.</li>
</ul>
<p class="note">Unowned is in its early stage and currently self-funded. This page will list every funder as soon as there is one.</p>
</div>`);

  simple("/privacy/", "Privacy", "What Unowned collects and what it never collects.", `<div class="prose">
<h2>Readers</h2>
<ul>
<li>No ads, no tracking scripts, no cookies, and no third-party fonts or analytics. Everything on this site loads from this site.</li>
<li>Our hosting provider, Cloudflare, handles connections to the site and may process technical data such as IP addresses to deliver it and protect it from attacks. We don't add tracking on top of that.</li>
</ul>
<h2>Contributors</h2>
<ul>
<li>Our forms don't ask for your name, email or phone number.</li>
<li>Our form handler stores only what you type and the date. It does not store your IP address or any information about your device.</li>
<li>Submissions are deleted automatically after 180 days.</li>
<li>No system is perfect. For anything sensitive, wait for our secure submission system, which we'll open only after an independent security audit.</li>
</ul>
</div>`);

  const corr = stories.flatMap((s) => s.corrections.map((c) => ({ ...c, story: s.title })));
  simple("/corrections/", "Corrections", "Every correction Unowned has made, with dates.", `<div class="prose">${corr.length ? `<ul>${corr.map((c) => `<li>${esc(long(c.date))}, ${esc(c.story)}: ${esc(c.text)}</li>`).join("")}</ul>` : "<p>No corrections yet. Every change made after publishing will be listed here with its date.</p>"}<p><a href="/submit/">Report an error</a></p></div>`);

  write("404.html", page({ title: "Page not found | Unowned", description: "Page not found.", path: "/404", body: `<header class="top"><h1>Page not found</h1><p class="lede">That page doesn't exist. <a href="/">Go to the home page</a>.</p></header>` }));

  /* RSS feed: the latest entries across stories */
  const items = stories.flatMap((s) => s.events.filter((e) => e.label !== "pending").map((e) => ({ s, e })))
    .sort((a, b) => (b.e.added || b.e.date).localeCompare(a.e.added || a.e.date)).slice(0, 30);
  write("feed.xml", `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>Unowned</title><link>${SITE}/</link><description>News nobody owns. Told by the people who were there.</description><language>en</language>
${items.map(({ s, e }) => `<item><title>${esc(`${long(e.date)}: ${e.text.split(". ")[0]}`)}</title><link>${SITE}/${s.slug}/#${itemId(e)}</link><guid isPermaLink="true">${SITE}/${s.slug}/#${itemId(e)}</guid><pubDate>${new Date(e.added || e.date + "T12:00:00Z").toUTCString()}</pubDate><description>${esc(`[${LABEL[e.label]}] ${e.text}`)}</description></item>`).join("\n")}
</channel></rss>
`);

  const urls = ["/", ...stories.map((s) => `/${s.slug}/`), "/submit/", "/how-we-work/", "/who-owns-unowned/", "/privacy/", "/corrections/"];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("")}</urlset>\n`);
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Built ${stories.length} story page(s) and ${urls.length} pages into ./${OUT}`);
}

build();
