// Builds the Unowned website into ./dist from ./content and ./static. Run: node build.mjs
import { readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { loadBriefings, buildBriefing, freshBriefing, miniPlayer } from "./tools/briefing.mjs";

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
const voteWidget = (st, hint) => `<div class="votes" data-story="${st.slug}" role="group" aria-label="Vote on ${esc(st.title)}"><button type="button" class="up" aria-pressed="false" title="Upvote: move this story up the list"><span aria-hidden="true">▲</span> Upvote</button><span class="score" aria-live="polite" title="Votes">0</span><button type="button" class="down" aria-pressed="false" title="Downvote: move this story down the list"><span aria-hidden="true">▼</span><span class="sr">Downvote</span></button>${hint ? `<span class="vhint">${hint}</span>` : ""}</div>`;
const added = (e) => e.added ? `<time class="ago" datetime="${e.added}">Added ${long(e.added.slice(0, 10))}</time>` : "";
const MEANING = { confirmed: "Two or more independent sources; copies of one wire story count once", reported: "One outlet so far", disputed: "Accounts conflict; we show both", alleged: "One side's claim, not yet confirmed", pending: "Expected; outcome being checked" };
const stamp = (l) => `<span class="stamp s-${l}" title="${LABEL[l]}: ${MEANING[l]}">${LABEL[l]}</span>`;
const SHORT = { confirmed: "2+ outlets", reported: "1 outlet", disputed: "sides disagree", alleged: "one side's claim", pending: "being checked" };
const keyStrip = () => `<div class="key" role="note" aria-label="What our labels mean"><a class="key-title" href="/how-we-work/#labels">How sure are we?</a><ul>${["confirmed", "reported", "disputed", "alleged", "pending"].map((l) => `<li>${stamp(l)}<span>${SHORT[l]}</span></li>`).join("")}</ul></div>`;
/* Independence: wire copy republished by several outlets counts once, and so do outlets with the same parent. */
const WIRES = ["AFP", "Reuters", "AP", "The Canadian Press", "Canadian Press", "PTI", "IANS", "ANI", "UNI", "Xinhua", "Anadolu", "DPA", "EFE", "ANSA"];
const PARENT = { "ICI": "Radio France", "France Bleu": "Radio France", "franceinfo": "Radio France", "France Inter": "Radio France", "France 2": "France Télévisions", "France 3": "France Télévisions", "CNews": "Bolloré media", "Europe 1": "Bolloré media", "JDD": "Bolloré media" };
function origins(name) {
  const n = name.replace(/\s+live updates$/i, "").trim();
  const via = n.match(/^(.*?)\s+via\s+.*$/i); if (via && !n.includes("(")) return [via[1].trim()];
  const m = n.match(/^(.*?)\s*\((.*)\)\s*$/);
  if (!m) return [n];
  if (/^via\s/i.test(m[2])) return [m[1].trim()];
  const w = m[2].split(/,\s*/).filter((x) => WIRES.includes(x));
  return w.length ? w : [m[1].trim()];
}
function independent(S, keys) {
  const g = new Map();
  for (const k of keys) for (const o of origins(S[k][0])) { const key = PARENT[o] || o; if (!g.has(key)) g.set(key, new Set()); g.get(key).add(o); }
  return [...g.values()].map((x) => [...x].join(" / "));
}
const andList = (a) => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " and " + a[a.length - 1];
const LABEL_WARNINGS = [];
function why(S, label, keys, where) {
  const how = ` <a href="/how-we-work/#labels">How we label</a>`;
  if (label === "confirmed") {
    const g = independent(S, keys);
    if (g.length < 2) LABEL_WARNINGS.push(`${where}: confirmed but only ${g.length} independent source(s): ${g.join(", ")}`);
    return `<p class="why">Confirmed by ${g.length >= 2 ? "independent reports from " : ""}${esc(andList(g))}.${how}</p>`;
  }
  const text = { reported: "Reported: not yet confirmed by a second independent source.", disputed: "Disputed: the accounts conflict. Both are given, with their sources.", alleged: "Alleged: one side's claim, not independently confirmed.", pending: "Checking: expected or unresolved. We will update this when the outcome is known." }[label];
  return text ? `<p class="why">${text}${how}</p>` : "";
}
/* "Checked for news 1 hour ago": shown when the news desk has looked for new developments since the last published update. */
const checkedNote = (st) => st.checkedAt && st.checkedAt > (st.updatedAt || "") ? `<span class="checked">Checked for news <time class="ago" datetime="${st.checkedAt}">${long(st.checkedAt.slice(0, 10))}</time></span>` : "";
const newestAdded = (st) => st.events.reduce((m, e) => (e.added && e.added > m ? e.added : m), st.updatedAt || "");
const firstSentence = (t, max) => { const f = t.split(". ")[0].replace(/\.$/, ""); return f.length > max ? f.slice(0, f.lastIndexOf(" ", max)) + "…" : f + "."; };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function write(path, content) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

const NAV = [
  ["/", "Trending"],
  ["/briefing/", "Briefing"],
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
<link rel="stylesheet" href="/assets/quick.css">
<link rel="stylesheet" href="/assets/briefing.css">
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

/* "In 30 seconds": five short cards built from data each story already has. Used on the page and as shareable images. */
function quickCards(st) {
  const strip = (t) => t.replace(/\s*(Outcome )?[Ss]till being checked\.?\s*$/, "").trim();
  const items = st.events.filter((e) => e.label !== "pending");
  const latest = items[items.length - 1];
  const confirmed = items.filter((e) => e.label === "confirmed" && e !== latest).slice(-2).reverse();
  const recentCut = latest ? new Date(Date.parse(latest.date) - 3 * 864e5).toISOString().slice(0, 10) : "";
  const pending = st.events.filter((e) => e.label === "pending" && e.date >= recentCut).slice(-2).reverse();
  const claim = st.claims[st.claims.length - 1];
  const cards = [
    { kind: "What's happening", lines: [{ text: firstSentence(st.summary[0], 300) }] },
    latest && { kind: "Latest", lines: [{ date: latest.date, label: latest.label, text: firstSentence(latest.text, 300) }] },
    confirmed.length && { kind: "What's confirmed", lines: confirmed.map((e) => ({ date: e.date, label: "confirmed", text: firstSentence(e.text, 300) })) },
    claim && { kind: "What's disputed", title: claim.title, lines: [{ side: "One account", text: firstSentence(claim.a, 280) }, { side: "Other account", text: firstSentence(claim.b, 280) }] },
    pending.length && { kind: "What's next", lines: pending.map((e) => ({ date: e.date, text: firstSentence(strip(e.text), 200) })) },
  ].filter(Boolean);
  return cards;
}
function quickHtml(st, cards) {
  const n = cards.length;
  const line = (l) => `<li>${l.side ? `<span class="q-side">${esc(l.side)}</span>` : ""}${l.label ? stamp(l.label) + " " : ""}${l.date ? `<span class="q-date">${short(l.date)}</span> ` : ""}${esc(l.text)}</li>`;
  return `<section id="quick" class="quick" aria-labelledby="h-quick">
  <div class="section-head"><h2 id="h-quick">In 30 seconds</h2><p>Swipe through. The full record, with every source, is below.</p></div>
  <ol class="qcards">${cards.map((c, i) => `<li class="qcard"><p class="eyebrow">${i + 1}/${n} · ${esc(c.kind)}</p>${c.title ? `<h3>${esc(c.title)}</h3>` : ""}<ul>${c.lines.map(line).join("")}</ul></li>`).join("")}</ol>
  <p class="q-foot"><a href="/${st.slug}/share/">Save these cards as images to share</a></p>
</section>`;
}

function storyPage(st, brief) {
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
    ...((st.ground || []).length ? [["ground", "From the ground", `${plural(st.ground.length, "post", "posts and videos")}, checked`, st.ground.length]] : []),
    ["glance", "At a glance", "Charts, figures and a map", null],
    ["timeline", "Timeline", `${plural(st.events.length, "event", "events")} since ${firstMonth}`, st.events.length],
    ["disputed", "Disputed claims", `${plural(st.claims.length, "claim", "claims")}, both sides shown`, st.claims.length],
    ["accountability", "Accountability log", `${plural(st.accountability.length, "action", "actions")} by authorities`, st.accountability.length],
    ["places", "Places", `${plural(st.places.length, "place", "places")} on the map`, st.places.length],
    ["sources", "Sources", `${plural(Object.keys(st.sources).length, "source", "sources")}, every one linked`, Object.keys(st.sources).length],
  ];

  const latestHtml = latest.map((e) => {
    const t = e.text.length > 110 ? e.text.slice(0, e.text.lastIndexOf(" ", 110)).replace(/[.,;:]$/, "") + "…" : e.text;
    return `<a class="card" href="#${itemId(e)}"><div class="when"><span>${long(e.date)}</span>${stamp(e.label)}${added(e)}</div><p>${esc(t)}</p></a>`;
  }).join("\n");

  const phaseBlocks = st.phases.map((p) => {
    const rows = st.events.filter((e) => e.phase === p.id);
    if (!rows.length) return null;
    const items = rows.map((e) => {
      const post = `${long(e.date)}: ${e.text}\n\nFull timeline and sources on Unowned: ${SITE}${path}#${itemId(e)}`;
      const share = e.label === "pending" ? "" : `<button type="button" class="share" data-post="${esc(post)}" aria-label="Share the ${esc(short(e.date))} entry">Share</button>`;
      return `<li id="${itemId(e)}" data-label="${e.label}"><span class="date">${short(e.date)}</span><div class="body"><div class="item-top">${stamp(e.label)}${share}</div><p>${esc(e.text)}</p>${srcLine(S, e.sources)}${why(S, e.label, e.sources, `${st.slug} ${e.date}`)}</div></li>`;
    }).join("\n");
    return { n: rows.length, html: `<div class="phase-block"><div class="phase"><p class="eyebrow">${esc(p.when)}</p><h3>${esc(p.name)}</h3></div><ol class="timeline">${items}</ol></div>` };
  }).filter((b) => b && b.html);
  const lastBlock = phaseBlocks.pop();
  const earlierN = phaseBlocks.reduce((m, b) => m + b.n, 0);
  const timelineHtml = (phaseBlocks.length ? `<details class="fold"><summary>Show ${earlierN} earlier events</summary>${phaseBlocks.map((b) => b.html).join("\n")}</details>` : "") + lastBlock.html;

  const groundHtml = (st.ground || []).map((g) => `<article class="ground-card">
    <div class="g-top"><span class="platform">${esc(g.platform)}</span><span class="when">${short(g.date)}</span>${stamp(g.label)}</div>
    <p class="who">${esc(g.who)}</p>
    <p class="shows">${esc(g.shows)}</p>
    <p class="check"><strong>How we checked:</strong> ${esc(g.check)}</p>
    ${srcLine(S, g.sources)}${why(S, g.label, g.sources, `${st.slug} ground ${g.date}`)}
  </article>`).join("\n");
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
  <div class="meta-row"><span class="live">${esc(st.status)}</span><span>Updated ${st.updatedAt ? `<time class="ago" datetime="${st.updatedAt}">${long(st.updated)}</time>` : long(st.updated)}</span>${checkedNote(st)}</div>
  ${voteWidget(st, "Want this followed closely? Upvote it.")}
  ${brief && (brief.stories || []).includes(st.slug) ? miniPlayer(brief, { esc, long, label: "This story is in the daily briefing" }) : ""}
</header>
${quickHtml(st, quickCards(st))}
<nav class="secnav" aria-label="Jump to section"><div class="secnav-in">${overview.map(([id, name, , n]) => `<a href="#${id}">${esc(name)}${n != null ? ` <span class="n">${n}</span>` : ""}</a>`).join("")}<a href="/" class="home-link">All stories</a></div></nav>
${keyStrip()}

<section id="latest" aria-labelledby="h-latest">
  <div class="section-head"><h2 id="h-latest"><span class="live-dot" aria-hidden="true"></span>Live updates</h2><p>Newest first. Updated as news breaks.</p></div>
  <div class="latest" data-live-story="${st.slug}" data-newest="${newestAdded(st)}">${latestHtml}</div>
</section>

<section id="summary" aria-labelledby="h-summary">
  <h2 id="h-summary">Where things stand</h2>
  <div class="summary"><p>${esc(st.summary[0])}</p>${st.summary.length > 1 ? `<details class="fold"><summary>Read more</summary>${st.summary.slice(1).map((p) => `<p>${esc(p)}</p>`).join("")}</details>` : ""}</div>
</section>

${groundHtml ? `<section id="ground" aria-labelledby="h-ground">
  <div class="section-head"><h2 id="h-ground">From the ground</h2><p>Posts and videos, checked against news reports. Described, not embedded, so no one tracks you here.</p></div>
  <div class="ground">${groundHtml}</div>
  <p class="note">Seen a post we should check? <a href="/submit/">Send the link</a>.</p>
</section>
` : ""}<section id="glance" aria-labelledby="h-glance">
  <h2 id="h-glance">At a glance</h2>
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
  <h2 id="h-timeline">Timeline</h2>
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
  <div class="section-head"><h2 id="h-disputed">Disputed claims</h2><p>Both sides, with sources.</p></div>
  <div class="claims">${claimsHtml}</div>
</section>

<section id="accountability" aria-labelledby="h-acc">
  <div class="section-head"><h2 id="h-acc">Accountability log</h2><p>Arrests, bans, investigations and court cases.</p></div>
  <div class="table-wrap"><table><thead><tr><th scope="col">Date</th><th scope="col">Action</th><th scope="col">By</th><th scope="col">Label</th></tr></thead><tbody>${accHtml}</tbody></table></div>
</section>

<section id="places" aria-labelledby="h-places">
  <h2 id="h-places">Places</h2>
  <div class="places">${placesHtml}</div>
</section>

<section id="method" aria-labelledby="h-method">
  <h2 id="h-method">How this page is made</h2>
  <details class="fold"><summary>Our method, corrections and open questions</summary>
  <p>Only published reporting and publicly posted material. AI helps gather, check and organize it. Routine updates are published automatically once they pass our sourcing and fairness checks; anything sensitive waits for a person to approve it. <a href="/how-we-work/">Our full standards</a>.</p>
  <div class="two">
    <div class="panel"><h3>Corrections</h3>${corrHtml}</div>
    <div class="panel"><h3>Still being checked</h3><ul>${gapsHtml}</ul></div>
  </div>
  </details>
  <p class="note">Spot something wrong? <a href="/submit/">Tell us</a>. No name needed.</p>
</section>

<section id="sources" aria-labelledby="h-sources">
  <h2 id="h-sources">Sources</h2>
  <details class="fold"><summary>Show all ${Object.keys(S).length} sources</summary><div class="srclist">${srcHtml}</div></details>
</section>

<script type="application/json" id="story-data">${JSON.stringify(chartData).replace(/</g, "\\u003c")}</script>`;

  write(`${st.slug}/index.html`, page({
    title: `${st.title} | Unowned`,
    description: st.dek,
    path,
    body,
    scripts: ["/assets/story.js", "/assets/votes.js", "/assets/live.js", "/assets/catchup.js", "/assets/briefing.js"],
    og: existsSync(`static/assets/og-${st.slug}.png`) ? `/assets/og-${st.slug}.png` : "/assets/og-default.png",
    type: "article",
  }));
  const shareData = { title: st.title, slug: st.slug, site: SITE.replace(/^https:\/\//, ""), cards: quickCards(st).map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l, date: l.date ? short(l.date) : undefined, label: l.label ? LABEL[l.label] : undefined })) })) };
  write(`${st.slug}/share/index.html`, page({
    title: `${st.title}: share cards | Unowned`,
    description: `The ${st.title} story in a few short cards.`,
    path: `${path}share/`,
    body: `<header class="top"><p class="eyebrow">Share cards</p><h1>${esc(st.title)}</h1><p class="lede">Short cards you can post on Instagram or X. On a phone, press and hold a card to save it. On a computer, right-click it. Every card points back to the full timeline and sources.</p></header>
<section><div id="share-cards" class="share-cards"><p class="src">Drawing the cards…</p></div><p><a href="${path}">Back to the full story</a></p></section>
<script type="application/json" id="cards-data">${JSON.stringify(shareData).replace(/</g, "\\u003c")}</script>`,
    scripts: ["/assets/cards.js"],
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
  const briefings = loadBriefings();
  const brief = freshBriefing(briefings);
  const built = stories.map((st) => storyPage(st, brief));

  /* Home */
  const byUpdate = [...built].sort((a, b) => (b.st.updatedAt || b.st.updated).localeCompare(a.st.updatedAt || a.st.updated));
  const cards = byUpdate.map(({ st, latest }, i) => `<li class="trend" data-story="${st.slug}" data-order="${i}">
    <span class="rank" aria-hidden="true">${i + 1}</span>
    <div class="trend-body">
      <a class="story-card" href="/${st.slug}/">
        <div class="meta-row"><span class="tag">${esc(st.region)}</span><span class="live">${esc(st.status)}</span><span>Updated ${st.updatedAt ? `<time class="ago" datetime="${st.updatedAt}">${long(st.updated)}</time>` : long(st.updated)}</span>${checkedNote(st)}</div>
        <h3>${esc(st.title)}</h3>
        <p class="latest-line"><strong>Latest:</strong> ${esc(firstSentence(latest[0].text, 100))}</p>
      </a>
      <div class="trend-foot">${voteWidget(st)}<a class="open" href="/${st.slug}/">Open story →</a></div>
    </div>
  </li>`).join("\n");
  write("stories.json", JSON.stringify(stories.map((s) => s.slug)));
  write("live.json", JSON.stringify(stories.flatMap((st) => st.events.filter((e) => e.added && e.label !== "pending").map((e) => ({ story: st.slug, storyTitle: st.title, id: e.id, label: e.label, added: e.added, text: e.text.split(". ")[0] }))).sort((a, b) => b.added.localeCompare(a.added) || b.id.localeCompare(a.id)).slice(0, 30)));
  /* "Since your last visit": every published item added in the last 14 days, read once per page by catchup.js. */
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 19) + "Z";
  write("updates.json", JSON.stringify({ since, items: stories.flatMap((st) => st.events.filter((e) => e.added && e.added >= since && e.label !== "pending").map((e) => ({ story: st.slug, id: e.id, label: e.label, added: e.added, date: e.date, text: e.text.split(". ")[0] }))).sort((a, b) => b.added.localeCompare(a.added) || b.id.localeCompare(a.id)) }));
  const regions = [...new Set(byUpdate.map(({ st }) => st.region))];
  const live = stories.flatMap((st) => st.events.filter((e) => e.label !== "pending").map((e, i) => ({ st, e, i })))
    .sort((a, b) => (b.e.added || b.e.date).localeCompare(a.e.added || a.e.date) || b.e.date.localeCompare(a.e.date) || b.i - a.i).slice(0, 6);
  const liveHtml = live.map(({ st, e }) => `<li><a href="/${st.slug}/#${itemId(e)}"><span class="when">${short(e.date)} ${stamp(e.label)} ${added(e)}</span><span class="what">${esc(e.text.split(". ")[0].replace(/\.$/, ""))}.</span><span class="story">${esc(st.title)}</span></a></li>`).join("\n");
  write("index.html", page({
    title: "Unowned",
    description: "News nobody owns. Verified, sourced reporting from the people who were there, with both sides shown.",
    path: "/",
    scripts: ["/assets/votes.js", "/assets/live.js", "/assets/catchup.js", "/assets/briefing.js"],
    body: `
<header class="top">
  <h1>News nobody owns.</h1>
  <p class="lede">The stories that matter, anywhere in the world: checked, sourced and kept up to date. Both sides shown.</p>
  ${brief ? miniPlayer(brief, { esc, long, label: "Listen to the daily briefing" }) : ""}
  <p class="coverage"><span>Following now in</span>${regions.map((r) => `<span class="tag">${esc(r)}</span>`).join("")}<a href="/submit/#suggest">Suggest a story to follow</a></p>
</header>


<section aria-labelledby="h-stories"><div class="section-head"><h2 id="h-stories">Trending now</h2><p>You decide the order: tap <strong>▲ Upvote</strong> on the stories you care about most.</p></div><ol class="trending">${cards}</ol></section>
<section aria-labelledby="h-live"><div class="section-head"><h2 id="h-live"><span class="live-dot" aria-hidden="true"></span>Live updates</h2><p>Newest first, from every story.</p></div>${keyStrip()}<ol class="livefeed" data-live-story="" data-newest="${stories.map(newestAdded).sort().pop()}">${liveHtml}</ol></section>
<section aria-labelledby="h-how">
  <h2 id="h-how">Why Unowned</h2>
  <div class="pillars">
    <div class="panel"><h3>Nobody owns it</h3><p>No government, party, billionaire or advertiser.</p></div>
    <div class="panel"><h3>From the ground</h3><p>What witnesses and local reporters record, checked.</p></div>
    <div class="panel"><h3>Honest labels</h3><p>We say how sure we are, and fix mistakes in public.</p></div>
  </div>
</section>
<section aria-labelledby="h-contrib">
  <h2 id="h-contrib">Help us get it right</h2>
  <p class="prose"><a href="/submit/">Send a link or a correction</a>. No name or email needed.</p>
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
<h2>Where our information comes from</h2>
<p>Unowned does not have reporters on the ground yet. Most of what we publish is checked against established news organisations and wire services, and against official statements. Posts and videos from people who were there appear in <strong>From the ground</strong>: we describe them, say who posted them and which outlets reported on them, and link to the original. A post on its own is never enough to label anything confirmed.</p>
<p>Many of the outlets we cite are owned by companies, governments or wealthy individuals. We show who reported what on every item so you can judge for yourself, rather than ask you to trust us.</p>
<h2>Sourcing</h2>
<ol>
<li>Every item links to where it came from.</li>
<li>We link to original posts rather than re-uploading them, and say who posted them and when. We check for old or recycled footage before using any clip.</li>
<li>Under each item, a line says why it has its label, for example "Confirmed by independent reports from AP and Reuters".</li>
</ol>
<h2 id="labels">Labels</h2>
<ul>
<li>${stamp("confirmed")} <strong>Two or more independent sources</strong> report it. Sources are independent when they did their own reporting. When several outlets publish the same wire story (for example AFP or Reuters), that counts as one source. So do outlets owned by the same company, such as franceinfo and ICI (both Radio France).</li>
<li>${stamp("reported")} <strong>One source so far.</strong> We are looking for a second.</li>
<li>${stamp("disputed")} <strong>The accounts conflict.</strong> We give each side in its own terms, with its sources, and say what is still unknown.</li>
<li>${stamp("alleged")} <strong>One side's claim</strong> that has not been independently confirmed, such as an accusation by a party, a group or the authorities.</li>
<li>${stamp("pending")} <strong>Expected or unresolved,</strong> such as a court hearing or a planned march. We replace it when the outcome is known.</li>
</ul>
<h3>What "confirmed" does and doesn't mean</h3>
<ul>
<li>When we write "police say 150 were detained" and label it confirmed, we have confirmed that police gave that figure, not that the figure is right. Official figures are always attributed, and where other counts differ we show them.</li>
<li>Confirmed means independent sources agree. It is not a guarantee. If later reporting shows we were wrong, we change the label and say so on the <a href="/corrections/">corrections page</a>.</li>
<li>Labels can go down as well as up. An item moves from reported to confirmed when a second independent source appears, and back if we find the sources were not independent.</li>
</ul>
<h2>Fairness</h2>
<ul>
<li>Every disputed event shows both accounts, in their own terms.</li>
<li>We describe actions, not motives, and keep commentary out of the record.</li>
<li>We don't name ordinary protesters or private individuals.</li>
</ul>
<h2>How AI is used</h2>
<p>AI finds, translates, sorts, checks and drafts our updates. Routine updates backed by published reporting are published automatically once they pass our written checks, without waiting for a person, so stories stay current. Anything sensitive waits for a person to approve it: an accusation against a named person, details that could identify a minor or a private individual, claims of deaths, or anything resting on a single unverified post. Mistakes are corrected in public on the <a href="/corrections/">corrections page</a>.</p>
<h2>Corrections</h2>
<p>We correct mistakes quickly and in public. Every change made after publishing is listed with its date. <a href="/submit/">Report an error</a>.</p>
</div>`);

  simple("/who-owns-unowned/", "Who owns Unowned", "Unowned is not owned by any government, party, billionaire or advertiser.", `<div class="prose">
<p>Unowned is built on one idea: news nobody owns can't be bent by an owner.</p>
<ul>
<li><strong>No government, party, billionaire or advertiser owns or controls Unowned.</strong></li>
<li><strong>No one who pays us can change our coverage.</strong> Advertisers, sponsors, members and funders get no say in what we report or how we label it.</li>
<li>Any sponsorship is clearly labelled, never tracks you, and never appears inside a story.</li>
<li>We'll be open about our money. As we start earning, we'll publish where our income comes from, by type and by major funder.</li>
<li>If anyone tries to buy influence, or demands we remove something, we'll say so publicly.</li>
</ul>
<p class="note">Unowned is in its early stage and currently self-funded. When that changes, this page will say where our money comes from.</p>
</div>`);

  simple("/privacy/", "Privacy", "What Unowned collects and what it never collects.", `<div class="prose">
<h2>Readers</h2>
<ul>
<li>No ad networks, no tracking scripts, no cookies, and no third-party fonts or analytics. Everything on this site loads from this site.</li>
<li>Our hosting provider, Cloudflare, handles connections to the site and may process technical data such as IP addresses to deliver it and protect it from attacks. We don't add tracking on top of that.</li>
<li>Your own browser remembers when you last opened each story, so we can show what's new since your last visit, and which way you voted. That record stays on your device and is never sent to us; a vote only adds one to an anonymous count. Clearing your browser's site data removes it.</li>
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

  buildBriefing({ briefings, stories, write, simple, esc, long, SITE });
  const urls = ["/", ...stories.map((s) => `/${s.slug}/`), ...(briefings.length ? ["/briefing/"] : []), "/submit/", "/how-we-work/", "/who-owns-unowned/", "/privacy/", "/corrections/"];
  write("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${SITE}${u}</loc></url>`).join("")}</urlset>\n`);
  write("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  console.log(`Built ${stories.length} story page(s) and ${urls.length} pages into ./${OUT}`);
  if (LABEL_WARNINGS.length) console.warn(`LABEL CHECK: ${LABEL_WARNINGS.length} item(s) need attention\n` + LABEL_WARNINGS.map((w) => "  - " + w).join("\n"));
  else console.log("LABEL CHECK: every confirmed item has two or more independent sources");
}

build();
