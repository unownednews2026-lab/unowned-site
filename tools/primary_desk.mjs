/* Primary-source desk (free AI, hourly). Reads what the people in our stories publish themselves — government press
   offices, ministries and official bodies, and the movements' own channels — and turns new, relevant items into
   strictly graded, clearly attributed updates. Sources are listed per story in tools/primary_sources.json, and only
   accounts and sites we have confirmed belong to that body are listed ("verified" says how we know).

   GRADING, enforced in code (an AI suggestion can only lower a grade, never raise it):
   - Nothing from a single primary source is ever "confirmed": that needs two independent news reports.
   - Official statement about the body's own action or decision ("the ministry announced…")  → reported
   - Movement's announcement of its own action ("the party says it will march on…")          → reported
   - Any claim about someone else, accusation, figure about events, or allegation             → alleged
   - Photos or video posted by a movement                     → "From the ground", alleged, with what is not verified
   - Deaths, injuries, abuse or accusations against people    → never published automatically: sent to the editor
   Every item says who said it and where ("said in a statement", "said on YouTube"), goes through the same code checks
   as news items (names, numbers, quotes must be in the source), a second AI fact-check, and is reviewed by the editor
   ("desk": "backup"). Items are marked "via": "official" or "social" so the site can label them. */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { ungrounded } from "./grounding.mjs";
import { realUrl } from "./gnews.mjs";
import { mediaText, youtubeText } from "./media.mjs";
import { scrape } from "./social_scrape.mjs";
import { ask, problems as llmProblems, SECOND_CHECK, GITHUB_PROVIDER, geminiVideo } from "./llm.mjs";

const DRY = process.argv.includes("--dry");                  // list what would be read, publish nothing
const REPO = process.env.GITHUB_REPOSITORY;
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const dryLog = [];
const say = (m) => { console.log(`primary desk: ${m}`); dryLog.push(m); };
const now = new Date().toISOString().slice(0, 19) + "Z";
const DAY = 864e5;
const UA = { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" };
const SENSITIVE = /\b(killed|dead|death|deaths|died|dies|murder\w*|rape\w*|sexual|suicide|shot|lynch\w*|injur\w*|wounded|tortur\w*|abuse\w*|accused of|charged with|arrested)\b/i;
const CLAIMWORDS = /\b(accus\w*|alleg\w*|blam\w*|claim\w*|fraud|rigg\w*|theft|chori|lie|lies|lied|conspiracy|illegal|unconstitutional|crackdown|brutal\w*|attack\w*|violat\w*|stole|stolen|fake|false)\b/i;
const unent = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&#039;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x, t) => unent((x.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]);
const get = async (url, ms = 20000) => { const r = await fetch(url, { headers: UA, redirect: "follow", signal: AbortSignal.timeout(ms) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };

/* Page text: direct, then the free reader service for sites built with scripts. */
const BLOCKED = /Just a moment\.\.\.|Enable JavaScript and cookies|Attention Required|Access denied|verify you are human|Checking your browser/i;
async function pageText(url) {
  try { const html = await get(url); const t = (html.match(/<p[\s>][\s\S]*?<\/p>/gi) || []).map(unent).filter((x) => x.length > 40).join("\n"); if (t.length > 300 && !BLOCKED.test(t.slice(0, 500))) return t.slice(0, 6000); } catch {}
  try { const t = (await get(`https://r.jina.ai/${url}`, 30000)).split("\n").map((x) => x.trim()).filter((x) => x.length > 40 && !/^(Title|URL Source|Published Time|Markdown Content):/.test(x)).join("\n"); return BLOCKED.test(t.slice(0, 500)) ? "" : t.slice(0, 6000); } catch { return ""; }
}

/* The scraping service costs money per post, so each account is scraped at most every few hours (default 3). */
async function scrapeEvery(src, platform, handle) {
  const k = `scraped:${platform}:${handle}`, hours = src.everyHours || 3;
  if (!DRY && seen[k] && Date.now() - Date.parse(seen[k]) < hours * 36e5) return [];
  seen[k] = now;
  return scrape(platform, handle, { count: src.count || 6, config: (registry._scrapers || {})[platform] || {} });
}

/* Each source type returns [{url, title, date, text}] (newest first). */
async function readSource(src) {
  if (src.type === "rss") {
    const xml = await get(src.url);
    return xml.split(/<item[\s>]|<entry[\s>]/).slice(1).map((it) => ({
      url: tag(it, "link") || (it.match(/<link[^>]*href="([^"]+)"/) || [])[1] || "",
      title: tag(it, "title"), date: new Date(tag(it, "pubDate") || tag(it, "published") || tag(it, "updated") || tag(it, "dc:date") || 0).toISOString(),
      text: tag(it, "description") || tag(it, "content:encoded") || tag(it, "summary") || tag(it, "content"),
    }));
  }
  if (src.type === "youtube") {
    let id = src.channelId;
    if (!id) { const html = await get(`https://www.youtube.com/@${src.handle}`); id = (html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/) || [])[1]; }
    if (!id) throw new Error("channel id not found");
    let list = [];
    try {
      const xml = await get(`https://www.youtube.com/feeds/videos.xml?channel_id=${id}`);
      list = xml.split("<entry>").slice(1).map((it) => ({ url: (it.match(/<link rel="alternate" href="([^"]+)"/) || [])[1], title: tag(it, "title"), date: tag(it, "published"), text: tag(it, "media:description"), video: true }));
      if (!list.length) say(`YouTube feed for ${src.handle} (${id}): ${xml.length} characters, no videos (${unent(xml).slice(0, 120)})`);
    } catch (e) { say(`YouTube feed for ${src.handle} (${id}) could not be read: ${e.message}`); }
    if (!list.length && src.handle) {   // feed empty or refused: read the channel's videos page through the reader service
      try {
        const md = await get(`https://r.jina.ai/https://www.youtube.com/@${src.handle}/videos`, 40000), seenIds = new Set();
        for (const m of md.matchAll(/\[([^\]]{0,200})\]\(https:\/\/(?:www\.|m\.)?youtube\.com\/(?:watch\?v=|shorts\/)([\w-]{11})[^)]*\)/g)) {
          if (seenIds.has(m[2])) continue; seenIds.add(m[2]);
          list.push({ url: `https://www.youtube.com/watch?v=${m[2]}`, title: unent(m[1]).replace(/^!?Image \d+:?\s*/, ""), date: "", text: "", video: true });
        }
        say(`YouTube ${src.handle}: feed (channel ${id}) was empty; ${list.length} video(s) from the channel page (${md.length} characters: ${md.replace(/\s+/g, " ").slice(0, 160)})`);
      } catch (e) { say(`YouTube ${src.handle}: channel page could not be read either (${e.message})`); }
    }
    return list.slice(0, 12);
  }
  if (src.type === "sitemap") {
    const xml = await get(src.url);
    return xml.split("<url>").slice(1).map((it) => ({ url: tag(it, "loc"), title: "", date: tag(it, "lastmod") ? new Date(tag(it, "lastmod")).toISOString() : "", text: "" }))
      .filter((x) => x.url && (!src.pathMatch || x.url.includes(src.pathMatch)) && x.date).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10);
  }
  if (src.type === "telegram") {
    const html = await get(`https://t.me/s/${src.channel}`);
    return html.split('class="tgme_widget_message ').slice(1).map((b) => ({
      url: `https://t.me/${(b.match(/data-post="([^"]+)"/) || [])[1] || src.channel}`, title: "",
      date: (b.match(/datetime="([^"]+)"/) || [])[1] || "", text: unent((b.match(/tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/) || [])[1]),
      video: /tgme_widget_message_video/.test(b),
      media: [...b.matchAll(/tgme_widget_message_photo_wrap[^>]*background-image:url\('([^']+)'\)/g)].slice(0, 3).map((m) => ({ type: "image", url: m[1] })),
    })).reverse();
  }
  if (src.type === "bluesky") {
    const j = JSON.parse(await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=${src.handle}&limit=20`));
    return (j.feed || []).filter((f) => !f.reason).map((f) => ({ url: `https://bsky.app/profile/${src.handle}/post/${f.post.uri.split("/").pop()}`, title: "", date: f.post.record.createdAt, text: f.post.record.text || "", video: /video/.test(f.post.embed?.$type || ""),
      media: [...(f.post.embed?.images || []).map((i) => ({ type: "image", url: i.fullsize })), ...(f.post.embed?.playlist ? [] : [])] }));
  }
  if (src.type === "web") {   // a listing page of statements: links whose address matches pathMatch
    let html;   // some government sites refuse cloud servers: then read the page through the free reader service, as HTML
    try { html = await get(src.url); }
    catch (e) { const r = await fetch(`https://r.jina.ai/${src.url}`, { headers: { ...UA, "X-Return-Format": "html" }, signal: AbortSignal.timeout(40000) }); if (!r.ok) throw new Error(`${e.message}; reader HTTP ${r.status}`); html = await r.text(); }
    const base = new URL(src.url), seen = new Set(), out = [];
    for (const m of html.matchAll(/<a[^>]+href="([^"#]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
      let u; try { u = new URL(m[1], base).href; } catch { continue; }
      const title = unent(m[2]);
      if (seen.has(u) || title.length < 20 || (src.pathMatch && !u.includes(src.pathMatch))) continue;
      seen.add(u); out.push({ url: u, title, date: "", text: "" });
    }
    if (!out.length) say(`${src.url}: ${html.length} characters, ${(html.match(/<a[\s>]/gi) || []).length} links, none usable (${unent(html).slice(0, 140)})`);
    return out.slice(0, 12);
  }
  if (src.type === "x") {   // X (Twitter): find recent posts by several routes, then confirm each one with X's own embed service
    const h = src.handle, ids = new Set(), routes = [];
    const grab = (txt, route) => { let n = 0; for (const m of txt.matchAll(new RegExp(`(?:x|twitter|xcancel|nitter)[\\w.]*\\.(?:com|net|org|poast\\.org)/${h}/status(?:es)?/(\\d{15,20})`, "gi"))) { if (!ids.has(m[1])) n++; ids.add(m[1]); } routes.push(`${route} ${n}`); };
    for (const [route, url] of [["xcancel", `https://xcancel.com/${h}/rss`], ["nitter", `https://nitter.net/${h}/rss`], ["nitter2", `https://nitter.poast.org/${h}/rss`]]) {
      if (ids.size >= 6) break;
      try { grab(await get(url, 15000), route); } catch (e) { routes.push(`${route} ${e.message.slice(0, 20)}`); }
    }
    if (ids.size < 3) {   // the public embedded-timeline service, and the reader service
      try { const html = await get(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${h}`, 20000); let n = 0;
        if (new RegExp(`"screen_name":"${h}"`, "i").test(html)) for (const m of html.matchAll(/"id_str":"(\d{15,20})"/g)) { if (!ids.has(m[1])) n++; ids.add(m[1]); }
        routes.push(`timeline ${n}`); } catch (e) { routes.push(`timeline ${e.message.slice(0, 20)}`); }
      for (const [route, u] of [["reader", `https://r.jina.ai/https://x.com/${h}`], ["reader-tw", `https://r.jina.ai/https://twitter.com/${h}`], ["reader-search", `https://r.jina.ai/https://x.com/search?q=from%3A${h}&f=live`]]) {
        if (ids.size >= 3) break;
        try { const r = await fetch(u, { headers: { ...UA, "X-Wait-For-Selector": "article a[href*='/status/']", "X-Timeout": "35" }, signal: AbortSignal.timeout(60000) }); const md = await r.text(); const before = ids.size; grab(md, route); if (ids.size === before && DRY) say(`   ${route} for @${h} returned: ${md.replace(/\s+/g, " ").slice(0, 200)}`); }
        catch (e) { routes.push(`${route} ${e.message.slice(0, 20)}`); }
      }
    }
    if (ids.size < 3) for (const site of ["x.com", "twitter.com"]) {
      try { grab(await get(`https://www.bing.com/search?q=${encodeURIComponent(`site:${site}/${h}/status`)}&format=rss&filters=${encodeURIComponent('ex1:"ez2"')}`, 20000), `bing:${site}`); } catch (e) { routes.push(`bing ${e.message.slice(0, 20)}`); }
    }
    const out = [];
    for (const id of [...ids].sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : -1)).slice(0, 8)) {
      const url = `https://x.com/${h}/status/${id}`;
      const date = new Date(Number(BigInt(id) >> 22n) + 1288834974657).toISOString();   // the post's exact time is encoded in its id
      try {   // X's own embed services only answer for real, public posts, and say who wrote them. This one also lists photos and videos.
        const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, "");
        const j = JSON.parse(await get(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${token}`, 15000));
        if ((j.user?.screen_name || "").toLowerCase() !== h.toLowerCase()) continue;
        const media = (j.mediaDetails || []).map((m) => {
          const v = (m.video_info?.variants || []).filter((x) => /mp4/.test(x.content_type || "")).sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
          return v.length ? { type: "video", url: v[Math.min(1, v.length - 1)].url } : { type: "image", url: m.media_url_https };
        }).filter((m) => m.url);
        const mentions = [...(j.entities?.user_mentions || []).map((m) => m.screen_name), j.quoted_tweet?.user?.screen_name].filter(Boolean);
        out.push({ url, title: "", date, text: unent(j.text || "").replace(/https:\/\/t\.co\/\w+$/, "").trim(), video: media.some((m) => m.type === "video"), media, mentions });
        continue;
      } catch {}
      try {
        const j = JSON.parse(await get(`https://publish.twitter.com/oembed?url=${encodeURIComponent(`https://twitter.com/${h}/status/${id}`)}&omit_script=1&dnt=true`, 15000));
        if (!new RegExp(`/${h}$`, "i").test(j.author_url || "")) continue;
        const p = (j.html.match(/<p[^>]*>([\s\S]*?)<\/p>/) || [])[1] || "";
        out.push({ url, title: "", date, text: unent(p.replace(/<a[^>]*>pic\.twitter\.com[^<]*<\/a>/g, "")), video: /pic\.twitter\.com/.test(p) });
      } catch {}
    }
    // X hides some accounts' posts from readers who aren't signed in: then use the signed-in scraping service.
    if (!out.length && process.env.APIFY_TOKEN) {
      try { const got = await scrapeEvery(src, "x", h); out.push(...got); routes.push(`scraper ${got.length}`); } catch (e) { routes.push(`scraper: ${String(e.message).slice(0, 80)}`); }
    }
    if (DRY || !out.length) say(`X @${h}: ${routes.join(", ")}; ${out.length} post(s) confirmed by X`);
    return out;
  }
  if (src.type === "instagram" || src.type === "tiktok") {   // only through the signed-in scraping service
    if (!process.env.APIFY_TOKEN) { if (DRY || new Date().getUTCHours() === 5) say(`${src.type} @${src.handle}: needs the APIFY_TOKEN secret to be read`); return []; }
    const got = await scrapeEvery(src, src.type, src.handle);
    if (DRY) say(`${src.type} @${src.handle}: ${got.length} post(s) from the scraper`);
    return got;
  }
  if (src.type === "gnews") {   // an official website's own pages, found through Google News (works even when the site blocks automated readers)
    const [gl, hl] = (src.edition || "US:en").split(":");
    const q = `site:${src.site}${src.query ? ` ${src.query}` : ""} when:3d`;
    const xml = await get(`https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${gl}:${hl}`);
    const items = xml.split("<item>").slice(1).map((it) => ({ link: tag(it, "link"), title: tag(it, "title").replace(/\s+-\s+[^-]+$/, ""), date: new Date(tag(it, "pubDate") || 0).toISOString(), text: "" })).slice(0, 8);
    const out = [];
    for (const x of items) {
      const key = `gn:${x.title.slice(0, 120)}`;   // a stable key, so we don't resolve the same link every hour
      if (seen[key]) { out.push({ ...x, url: x.link, key }); continue; }   // already handled: no need to resolve it again
      const u = (await realUrl(x.link)) || "";
      if (u && !u.includes(src.site)) continue;   // must really be on the official site
      out.push({ ...x, url: u || x.link, key });
    }
    if (DRY || !out.length) say(`Google News site:${src.site}: ${items.length} item(s) in the last 3 days`);
    return out;
  }
  if (src.type === "discover") {   // the movement's own website: the social accounts it links to are its verified channels
    let page = "";
    try { page += await get(src.url); } catch {}
    try { page += "\n" + (await get(`https://r.jina.ai/${src.url}`, 40000)); } catch {}
    const found = [], add = (x) => { if (!found.some((f) => f.type === x.type && (f.handle || f.channelId || f.channel) === (x.handle || x.channelId || x.channel))) found.push(x); };
    const host = new URL(src.url).hostname.replace(/^www\./, "");
    const base = { kind: src.kind, match: src.match, verified: `linked from ${host}, its official website` };
    for (const m of page.matchAll(/youtube\.com\/(?:@([\w.-]{3,})|channel\/(UC[\w-]{22}))/gi)) add({ ...base, type: "youtube", handle: m[1], channelId: m[2], who: `${src.name} (YouTube)` });
    for (const m of page.matchAll(/(?:\/\/|\b)(?:www\.)?(?:x|twitter)\.com\/(?!intent|share|home|i\/|hashtag|search)(\w{2,15})\b/gi)) add({ ...base, type: "x", handle: m[1], who: `${src.name} (X)` });
    for (const m of page.matchAll(/t\.me\/(?!share|joinchat|\+)(\w{4,})/gi)) add({ ...base, type: "telegram", channel: m[1], who: `${src.name} (Telegram)` });
    for (const m of page.matchAll(/instagram\.com\/(?!p\/|reel\/|explore|accounts|stories)([\w.]{2,30})/gi)) add({ ...base, type: "instagram", handle: m[1].replace(/\.$/, ""), who: `${src.name} (Instagram)` });
    for (const m of page.matchAll(/tiktok\.com\/@([\w.]{2,30})/gi)) add({ ...base, type: "tiktok", handle: m[1], who: `${src.name} (TikTok)` });
    for (const m of page.matchAll(/bsky\.app\/profile\/([\w.-]+)/gi)) add({ ...base, type: "bluesky", handle: m[1], who: `${src.name} (Bluesky)` });
    say(`${src.name}: its website links to ${found.map((f) => `${f.type} ${f.handle || f.channelId || f.channel}`).join(", ") || "no readable social accounts"}`);
    return found;
  }
  throw new Error(`unknown source type ${src.type}`);
}

const registry = existsSync("tools/primary_sources.json") ? JSON.parse(readFileSync("tools/primary_sources.json", "utf8")) : {};
// Accounts verified by the editor through network discovery (content/network-sources.json, {story slug: [source, ...]}).
const network = existsSync("content/network-sources.json") ? JSON.parse(readFileSync("content/network-sources.json", "utf8")) : {};
for (const [slug, list] of Object.entries(network)) if (!slug.startsWith("_") && Array.isArray(list)) registry[slug] = [...(registry[slug] || []), ...list.map((x) => ({ ...x, network: true }))];
// Track record of every account we publish from (content/source-record.json; resolved by tools/track_record.mjs).
const recordPath = "content/source-record.json";
const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { items: [] };
const trackRecord = (acct) => { const r = (record.accounts || {})[acct] || {}; return { upheld: r.upheld || 0, resolved: (r.upheld || 0) + (r.disproved || 0) }; };
// Accounts the ones we follow keep reposting, mentioning or tagging (for network discovery).
const netPath = "content/network.json";
const net = existsSync(netPath) ? JSON.parse(readFileSync(netPath, "utf8")) : { counts: {}, proposed: {}, ignored: {} };
const seenPath = "content/primary-seen.json";
const seen = existsSync(seenPath) ? JSON.parse(readFileSync(seenPath, "utf8")) : {};
const published = [], report = [], queue = [];
const mark = (x) => { seen[x.key || x.url] = now; };
const newestDev = (s) => s.events.filter((e) => e.label !== "pending").reduce((m, e) => (e.date > m ? e.date : m), "");

for (const f of readdirSync("content/stories").filter((x) => x.endsWith(".json"))) {
  const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8"));
  const sources = [];
  for (const src of registry[s.slug] || []) {
    if (src.type !== "discover") { sources.push(src); continue; }
    try { for (const f of await readSource(src)) if (!sources.concat(registry[s.slug]).some((x) => x.type === f.type && (x.handle || x.channelId || x.channel || "").toLowerCase() === (f.handle || f.channelId || f.channel || "").toLowerCase())) sources.push(f); }
    catch (e) { report.push(`- ${s.slug}: could not read ${src.url} to find its channels (${String(e.message).slice(0, 60)})`); }
  }
  if (!sources.length) continue;
  const since = Math.max(Date.now() - 2 * DAY, Date.parse(newestDev(s) + "T00:00:00Z") || 0);
  let added = 0;
  for (const src of sources) {
    let items = [];
    try { items = await readSource(src); } catch (e) { report.push(`- ${s.slug}: ${src.who} (${src.type}) could not be read: ${String(e.message).slice(0, 80)}`); continue; }
    if (!items.length && (DRY || new Date().getUTCHours() === 5)) report.push(`- ${s.slug}: ${src.who} (${src.type}): nothing could be read (empty feed or page)`);
    // First time we read a source: everything already there is old news. Remember it, publish nothing.
    const sid = `source:${src.type}:${src.url || src.handle || src.channelId || src.channel || src.site}`;
    const first = !seen[sid];
    const old = (t) => !t || Date.now() - Date.parse(t) > 7 * DAY;     // refresh weekly only, so routine checks make no commit
    if (old(seen[sid])) seen[sid] = now;
    // First time we read a source: anything undated or older than the story's newest development is old news; remember it.
    // Posts dated after that still go through every check below, so a new source can't miss recent developments.
    if (first) { let n = 0; for (const x of items) if (x.url && (!x.date || Date.parse(x.date) <= since)) { mark(x); n++; } say(`${s.slug}: ${src.who}: first read, ${n} older item(s) recorded as already seen`); }
    for (const x of items) if (x.url && seen[x.key || x.url] && old(seen[x.key || x.url])) mark(x);   // still listed: keep remembering it
    const fresh = items.filter((x) => x.url && !x.skip && !seen[x.key || x.url] && (!x.date || Date.parse(x.date) > since) && (!src.match || new RegExp(src.match, "i").test(`${x.title} ${x.text}`)));
    say(`${s.slug}: ${src.who}: ${items.length} item(s), ${fresh.length} new and relevant`);
    for (const x of items) for (const m of new Set((x.mentions || []).map((h) => String(h).toLowerCase().replace(/^@/, "")))) {
      if (!m || m === String(src.handle || "").toLowerCase() || seen[`netpost:${x.url}:${m}`]) continue;
      seen[`netpost:${x.url}:${m}`] = now;   // count each post once
      const k = `${src.type}:${m}`, c = (net.counts[k] = net.counts[k] || { n: 0, from: {}, stories: {}, last: "" });
      c.n++; c.from[src.handle || src.who] = (c.from[src.handle || src.who] || 0) + 1; c.stories[s.slug] = 1; c.last = now;
    }
    if (DRY && src.type === "youtube" && items[0]) { const v = (items[0].url.match(/[?&]v=([\w-]{11})/) || [])[1]; let t = ""; try { t = execSync(`timeout 60 python3 tools/yt_transcript.py ${v} 2>&1`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); } catch (e) { t = String(e.stderr || e.message); } say(`   transcript test (${items[0].title.slice(0, 50)}): ${t.trim().slice(0, 160) || "nothing returned"}`); }
    if (DRY) { for (const x of fresh.slice(0, 3)) say(`   ${x.date?.slice(0, 16) || "?"} ${x.title || x.text.slice(0, 80)} ${x.url}`); continue; }
    for (const x of fresh.slice(0, 2)) {
      if (added >= 2) break;
      mark(x);
      // A video is judged by what is actually said in it: its transcript (captions, translated to English when possible).
      const vid = x.video && (x.url.match(/[?&]v=([\w-]{11})/) || [])[1];
      if (vid && !x.date) {   // videos read from the channel page carry no date: take the published time from the video page
        try { const md = await get(`https://r.jina.ai/${x.url}`, 40000); const d = (md.match(/^Published Time:\s*(\S+)/m) || md.match(/"uploadDate":"([^"]+)"/) || [])[1]; if (d && !isNaN(Date.parse(d))) x.date = new Date(d).toISOString(); } catch {}
        if (!x.date) { report.push(`- ${s.slug}: ${src.who}: skipped a video with no readable date (${x.url})`); continue; }
        if (Date.parse(x.date) <= since) continue;
      }
      if (vid) {   // transcript: YouTube's captions first, then Gemini watching the video itself
        let t = sh(`timeout 60 python3 tools/yt_transcript.py ${vid} 2>/dev/null || true`);
        if (t.length < 100) t = await youtubeText(`https://www.youtube.com/watch?v=${vid}`);
        if (t.length > 100) x.text = `${x.text}\n${t}`.trim(); else report.push(`- ${s.slug}: ${src.who}: no transcript for ${x.url}; judged on its title and description only`);
      }
      // Photos and videos in the post become text: videos transcribed and translated, images read (OCR) and described.
      if (x.media?.length) { const mt = await mediaText(x.media, (m) => report.push(`- ${s.slug}: ${src.who}: ${m}`)); if (mt) x.text = `${x.text}\n\n${mt}`.trim(); }
      if (!["x", "instagram", "tiktok"].includes(src.type) && (!x.text || x.text.length < 200)) x.text = `${x.text}\n${await pageText(x.url)}`.trim();
      if (src.type === "gnews" && x.text.length < 60) x.text = `${x.title}. ${x.text}`.trim();   // site blocks readers: its own headline is the statement
      if (x.text.length < 40) continue;
      const via = src.kind === "official" ? "official" : "social";
      const where = src.type === "youtube" ? "in a YouTube video" : src.type === "instagram" ? (x.video ? "in a video on Instagram" : "on Instagram") : src.type === "tiktok" ? "in a TikTok video" : src.type === "x" ? (x.video ? "in a video on X" : "on X") : src.type === "telegram" ? "on Telegram" : src.type === "bluesky" ? "on Bluesky" : via === "official" ? "in a statement" : "on its website";
      const out = await ask(`You write for a strict, neutral news site. Below is a ${via === "official" ? "statement published by an official body" : "post published by a movement or organisation"}: ${src.who}. It may be in any language; write in English.
Story: "${s.title}". Today is ${now.slice(0, 10)}. Return ONLY JSON: {"relevant": true|false, "date": "YYYY-MM-DD", "kind": "own_action"|"claim"|"footage", "eventDate": "YYYY-MM-DD or empty", "text": "..."}
- relevant: true only if it reports something NEW and specific about this story (not background, not promotion).
- kind: "own_action" = the publisher announces or describes its OWN decision, action or plan; "claim" = it says something about others, accuses anyone, or gives figures about events; "footage" = mainly photos/video of an event.
- text: one or two neutral sentences, at most 60 words, saying WHO said it and WHERE, e.g. "${src.who.replace(/\s*\(.*\)$/, "")} said ${where} that …". Never state their claims as fact. No names of private people. No graphic detail.
- date: the day of the statement or event.
- eventDate: ONLY if the post announces or calls for a FUTURE event (a march, protest, strike, rally, sit-in, hearing, vote) on a specific date stated in it: that date. Otherwise "". Then write the text as "<who> said <where> that it will hold <what> in <place> on <date>".
- If the text contains a video transcript, report what the speaker actually says in it (attributed: "said in a YouTube video"), never what the title or description promises.

Title: ${x.title}
Published: ${x.date || "unknown"}
Text: ${x.text.slice(0, 7000)}`, { temperature: 0.1, log: () => {} });
      let it = {}; try { it = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)); } catch {}
      if (it.relevant !== true || !it.text) { report.push(`- ${s.slug}: ${src.who}: not relevant or unreadable (${(x.title || x.url).slice(0, 70)})`); continue; }
      const miss = ungrounded(it.text, [{ title: x.title, text: x.text, domain: src.who }], `${s.title} ${s.region || ""} ${src.who} said statement YouTube Telegram Bluesky website`);
      if (miss.length) { report.push(`- ${s.slug}: ${src.who}: skipped "${it.text.slice(0, 70)}…" (${miss.slice(0, 2).join("; ")})`); continue; }
      const chk = await ask(`Independent fact-check. Source (${src.who}):\n${x.title}\n${x.text.slice(0, 7000)}\n\nProposed item: "${it.text}"\n\nIs every fact in the item stated in the source, attributed to ${src.who} (not presented as established fact), and dated correctly? Answer ONLY JSON {"ok": true|false, "reason": "..."}`, { temperature: 0, prefer: SECOND_CHECK, log: () => {} });
      let v = {}; try { v = JSON.parse(chk.slice(chk.indexOf("{"), chk.lastIndexOf("}") + 1)); } catch {}
      if (v.ok !== true) { report.push(`- ${s.slug}: ${src.who}: skipped "${it.text.slice(0, 70)}…" (fact-check: ${String(v.reason || "no clear yes").slice(0, 100)})`); continue; }
      if (SENSITIVE.test(it.text) || SENSITIVE.test(x.title)) { queue.push(`**${s.slug}** — from ${src.who} (${via}), sensitive, needs the editor: "${it.text}"\n  Source: ${x.url}`); report.push(`- ${s.slug}: sent to the editor (sensitive): "${it.text.slice(0, 70)}…"`); continue; }
      // The grade, decided in code. Own announcements are "reported" (we can confirm they said it, from their own channel);
      // anything about others is "alleged". Never "confirmed" from a single primary source.
      let label = it.kind === "own_action" && !CLAIMWORDS.test(it.text) ? "reported" : "alleged";
      let date = /^\d{4}-\d{2}-\d{2}$/.test(it.date || "") && it.date <= now.slice(0, 10) ? it.date : (x.date || now).slice(0, 10);
      // An announced FUTURE event (e.g. a protest called for Sunday) goes on the timeline as "pending", dated on the day it is
      // due, so readers know before it happens. After that day the editor and the freshness guard replace it with what happened.
      const future = /^\d{4}-\d{2}-\d{2}$/.test(it.eventDate || "") && it.eventDate > now.slice(0, 10) && it.eventDate <= new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
      // Track record: an account whose earlier reports were often proved wrong goes to the editor first.
      const acct = `${src.type}:${(src.handle || src.channel || src.site || src.url || src.who).toLowerCase()}`;
      const rec = trackRecord(acct);
      if (rec.resolved >= 4 && rec.upheld / rec.resolved < 0.5) { queue.push(`**${s.slug}** — from ${src.who}, whose track record is weak (${rec.upheld} of ${rec.resolved} earlier reports upheld); needs the editor: "${it.text}"\n  Source: ${x.url}`); report.push(`- ${s.slug}: sent to the editor (weak track record): "${it.text.slice(0, 70)}…"`); continue; }
      // Only genuinely new statements: never older than 3 days, never older than the story's newest development minus a day.
      const floor = new Date(Math.max(Date.now() - 3 * DAY, (Date.parse(newestDev(s) + "T00:00:00Z") || 0) - DAY)).toISOString().slice(0, 10);
      const urlDate = (x.url.match(/(\d{1,2})-(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*-(20\d\d)/i) || []);
      const fromUrl = urlDate.length ? new Date(`${urlDate[2]} ${urlDate[1]} ${urlDate[3]} UTC`).toISOString().slice(0, 10) : "";
      if (date < floor || (fromUrl && fromUrl < floor)) { report.push(`- ${s.slug}: ${src.who}: skipped, not new (dated ${fromUrl || date}): ${(x.title || x.url).slice(0, 70)}`); continue; }
      if (future) { label = "pending"; date = it.eventDate; }
      const key = `pr${now.replace(/\D/g, "").slice(4, 12)}${published.length}`;
      record.items.push({ account: acct, who: src.who, story: s.slug, key, label, date, added: now });
      s.sources[key] = [`${src.who}${via === "official" ? "" : ""}`, x.url];
      const g = s.sourceGroups[s.sourceGroups.length - 1];
      (Array.isArray(g) ? g[1] : g.keys || g.sources).push(key);
      if (it.kind === "footage" && via === "social" && !future) {
        s.ground = s.ground || [];
        s.ground.push({ date, added: now, platform: src.type === "youtube" ? "YouTube" : src.type === "instagram" ? "Instagram" : src.type === "tiktok" ? "TikTok" : src.type === "x" ? "X" : src.type === "telegram" ? "Telegram" : src.type === "bluesky" ? "Bluesky" : "Website", who: src.who, shows: it.text, label: "alleged", check: `Posted by ${src.who}; ${src.verified}. Not independently verified: the date, place and context of the footage.`, sources: [key], desk: "backup", via });
      } else {
        s.events.push({ date, phase: s.phases[s.phases.length - 1].id, label, added: now, text: it.text.trim(), sources: [key], desk: "backup", via });
        s.events.sort((a, b) => a.date.localeCompare(b.date));
      }
      // Review packet for the editor: the post exactly as read, with its transcript and image text.
      mkdirSync(`review-packets/${s.slug}`, { recursive: true });
      writeFileSync(`review-packets/${s.slug}/${key}.json`, JSON.stringify({ story: s.slug, added: now, label, via, kind: it.kind, text: it.text.trim(), sources: [{ key, outlet: src.who, url: x.url, platform: src.type, verified: src.verified, published: x.date, media: x.media || [], articleText: x.text }] }, null, 2));
      s.updated = now.slice(0, 10); s.updatedAt = now;
      writeFileSync(`content/stories/${f}`, JSON.stringify(s, null, 2));
      sh(`node tools/fmt.js content/stories/${f}`);
      published.push(s.slug); added++;
      report.push(`### ${s.title}\n- **${label}** (${via === "official" ? "official statement" : "social / own channel"}): ${it.text}\n  Source: ${x.url}`);
    }
  }
}
if (DRY) {
  // Can this server read YouTube transcripts? Test on a public news video, so we know before a movement posts one.
  let t = ""; try { t = execSync("timeout 90 python3 tools/yt_transcript.py JbT8LXzTNf8 2>&1", { encoding: "utf8" }); } catch (e) { t = String(e.stdout || e.message); }
  say(`transcript test on a public video (captions): ${t.trim().slice(0, 160) || "nothing returned"}`);
  for (const [name, u] of [["X embed", "https://publish.twitter.com/oembed?url=https%3A%2F%2Ftwitter.com%2Fjack%2Fstatus%2F20&omit_script=1"], ["X syndication", "https://cdn.syndication.twimg.com/tweet-result?id=20&token=a"]]) {
    try { say(`${name} test: ${(await get(u, 15000)).slice(0, 120)}`); } catch (e) { say(`${name} test: failed (${e.message})`); }
  }
  const ocr = await mediaText([{ type: "image", url: "https://upload.wikimedia.org/wikipedia/commons/f/f9/STOP_sign.jpg" }], (m) => say(`   ${m}`));
  say(`image reading (OCR) test: ${ocr ? ocr.replace(/\s+/g, " ").slice(0, 200) : `failed (${Object.entries(llmProblems).filter(([k]) => /image|vision/.test(k)).map(([k, v]) => `${k} ${v}`).join("; ") || "no answer"})`}`);
  const vt = await mediaText([{ type: "video", url: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4" }], (m) => say(`   ${m}`));
  say(`video file test: ${vt ? vt.replace(/\s+/g, " ").slice(0, 200) : `failed (${Object.entries(llmProblems).filter(([k]) => /video|whisper/.test(k)).map(([k, v]) => `${k} ${v}`).join("; ") || "no answer"})`}`);
  say(`scraping service: ${process.env.APIFY_TOKEN ? "APIFY_TOKEN is set" : "APIFY_TOKEN not set yet (X fallback, Instagram and TikTok wait for it)"}`);
  const g = await geminiVideo("https://www.youtube.com/watch?v=JbT8LXzTNf8");
  say(`transcript test on a public video (Gemini watching it): ${g ? g.slice(0, 220) : `failed (${Object.entries(llmProblems).filter(([k]) => k.includes("video")).map(([k, v]) => `${k} ${v}`).join("; ") || "no answer"})`}`);
  try { writeFileSync("/tmp/pdry.md", `Primary-source desk — dry run (nothing published)\n\n${[...dryLog, ...report].map((l) => `- ${l.replace(/^- /, "")}`).join("\n")}`);
    const n = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Backup desk log")][0].number // empty'`);
    if (n) sh(`gh issue comment ${n} --body-file /tmp/pdry.md`); else console.log("dry run: log issue not found"); } catch (e) { console.log(`dry run: could not post (${String(e.message).slice(0, 150)})`); }
  process.exit(0);
}
writeFileSync(recordPath, JSON.stringify(record, null, 1));
writeFileSync(netPath, JSON.stringify(net, null, 1));
writeFileSync(seenPath, JSON.stringify(Object.fromEntries(Object.entries(seen).filter(([, t]) => Date.now() - Date.parse(t) < 30 * DAY)), null, 2));

if (queue.length) try {
  writeFileSync("/tmp/pqueue.md", `${now} (primary-source desk)\n\n${queue.join("\n\n")}`);
  const q = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Editor queue")][0].number // empty'`);
  if (q) sh(`gh issue comment ${q} --body-file /tmp/pqueue.md`);
} catch {}

if (!sh("git status --porcelain content/stories content/primary-seen.json content/source-record.json content/network.json")) { say("nothing new"); process.exit(0); }
if (published.length) {
  const build = sh("node build.mjs 2>&1 || true");
  if (/LABEL CHECK: \d+ item/.test(build) || /Error/.test(build)) { say("build check failed; not publishing"); process.exit(0); }
}
sh(`git config user.name "Unowned" && git config user.email "Unownednews2026@gmail.com"`);
sh(`git add content/stories content/primary-seen.json content/source-record.json content/network.json ${published.length ? "review-packets" : ""} && git commit -q -m "${published.length ? `Primary sources: ${[...new Set(published)].join(", ")}` : "Primary sources checked"} — ${now}"`);
for (let i = 0; i < 3; i++) {
  try { sh("git pull -q --rebase origin main && git push -q origin HEAD:main"); break; }
  catch (e) { if (i === 2) { say(`push failed: ${String(e.message).slice(0, 200)}`); process.exit(0); } await new Promise((r) => setTimeout(r, 10000)); }
}
if (report.length) try {
  writeFileSync("/tmp/plog.md", `${now} — primary-source desk${Object.keys(llmProblems).length ? ` — provider problems: ${Object.entries(llmProblems).map(([k, v]) => `${k} (${v})`).join("; ")}` : ""}\n\n${report.join("\n\n")}`);
  const n = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Backup desk log")][0].number // empty'`);
  if (n) sh(`gh issue comment ${n} --body-file /tmp/plog.md`);
} catch {}
