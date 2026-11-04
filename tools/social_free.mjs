/* Free readers for Instagram, TikTok and X (no paid service). Each platform has several routes, tried in order; the
   first that returns posts wins. Every post comes back as {url, title, date, text, video, media: [{type, url}], mentions}
   so photos and videos can be turned into text (tools/media.mjs) and graded like everything else.
   These routes are public and unofficial: any one may stop working, which is why there are several, and why the paid
   scraper (tools/social_scrape.mjs) stays as a capped last resort. */
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MOBILE = "Instagram 309.0.0.40.113 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100; en_US; 541635890)";
const iso = (t) => { const n = typeof t === "number" ? (t < 1e12 ? t * 1000 : t) : Date.parse(t); return isNaN(n) ? "" : new Date(n).toISOString(); };
async function get(url, headers = {}, ms = 25000) {
  const r = await fetch(url, { headers: { "User-Agent": UA, ...headers }, redirect: "follow", signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}
const reader = (url, extra = {}) => get(`https://r.jina.ai/${url}`, { "X-Return-Format": "html", ...extra }, 60000);
const tags = (t) => [...String(t || "").matchAll(/@([\w.]{2,30})/g)].map((m) => m[1].replace(/\.$/, ""));

/* ---------- Instagram ---------- */
function igFromApi(j, h) {
  const edges = j?.data?.user?.edge_owner_to_timeline_media?.edges || [];
  return edges.map(({ node: n }) => {
    const text = n.edge_media_to_caption?.edges?.[0]?.node?.text || "";
    const media = n.is_video && n.video_url ? [{ type: "video", url: n.video_url }]
      : (n.edge_sidecar_to_children?.edges?.length ? n.edge_sidecar_to_children.edges.map((e) => e.node) : [n]).slice(0, 3)
          .map((c) => (c.is_video && c.video_url ? { type: "video", url: c.video_url } : { type: "image", url: c.display_url })).filter((m) => m.url);
    return { url: `https://www.instagram.com/p/${n.shortcode}/`, title: "", date: iso(n.taken_at_timestamp), text, video: !!n.is_video, media,
      mentions: [...tags(text), ...(n.edge_media_to_tagged_user?.edges || []).map((e) => e.node?.user?.username)].filter(Boolean), owner: h };
  });
}
export async function instagramFree(h) {
  const why = [];
  // 1. Instagram's own public profile endpoint (the one its website uses), without logging in.
  for (const [base, headers] of [["https://i.instagram.com", { "User-Agent": MOBILE, "x-ig-app-id": "936619743392459" }], ["https://www.instagram.com", { "x-ig-app-id": "936619743392459", "X-Requested-With": "XMLHttpRequest", Referer: `https://www.instagram.com/${h}/` }]]) {
    try {
      const j = JSON.parse(await get(`${base}/api/v1/users/web_profile_info/?username=${encodeURIComponent(h)}`, headers));
      const posts = igFromApi(j, h);
      if (posts.length) return { posts, route: `instagram api (${base.includes("i.") ? "app" : "web"})`, related: (j?.data?.user?.edge_related_profiles?.edges || []).map((e) => ({ handle: e.node.username, name: e.node.full_name, verified: !!e.node.is_verified })) };
      why.push(`api: no posts`);
    } catch (e) { why.push(`api ${e.message}`); }
  }
  // 2. Recent post links from search results, each read through Instagram's public embed page (no login).
  try {
    const html = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:instagram.com/p ${h}`)}&df=w`);
    const codes = [...new Set([...html.matchAll(/instagram\.com(?:%2F|\/)(?:p|reel)(?:%2F|\/)([\w-]{6,})/g)].map((m) => m[1]))].slice(0, 6);
    const posts = [];
    for (const c of codes) { const d = await instagramPost(`https://www.instagram.com/p/${c}/`); if (d && d.date && (!d.owner || d.owner.toLowerCase() === h.toLowerCase())) posts.push({ url: `https://www.instagram.com/p/${c}/`, title: "", date: d.date, text: d.text, video: d.media.some((m) => m.type === "video"), media: d.media, mentions: tags(d.text), owner: h }); }
    if (posts.length) return { posts: posts.sort((a, b) => b.date.localeCompare(a.date)), route: "search + embed", related: [] };
    why.push(`search + embed: ${codes.length} link(s), none readable`);
  } catch (e) { why.push(`search + embed ${e.message}`); }
  // 3. Public Instagram viewer sites, read through the reader service.
  for (const [name, url, re] of [
    ["imginn", `https://imginn.com/${h}/`, /href="\/p\/([\w-]{5,})\/?"[\s\S]{0,1500}?(?:alt="([^"]*)")?/g],
    ["picuki", `https://www.picuki.com/profile/${h}`, /href="https:\/\/www\.picuki\.com\/media\/(\d+)"[\s\S]{0,1500}?(?:alt="([^"]*)")?/g],
  ]) {
    try {
      const html = await reader(url);
      const posts = []; const seen = new Set();
      for (const m of html.matchAll(re)) {
        if (seen.has(m[1])) continue; seen.add(m[1]);
        const text = (m[2] || "").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&#39;/g, "'");
        posts.push({ url: name === "imginn" ? `https://www.instagram.com/p/${m[1]}/` : url, title: "", date: "", text, video: false, media: [], mentions: tags(text), owner: h, needsDate: true });
      }
      if (posts.length) return { posts: posts.slice(0, 8), route: name, related: [] };
      why.push(`${name}: no posts`);
    } catch (e) { why.push(`${name} ${e.message}`); }
  }
  throw new Error(why.join("; "));
}
/* Instagram post page -> date and caption (for posts found without a date). */
export async function instagramPost(url) {
  const code = (url.match(/\/p\/([\w-]+)/) || [])[1]; if (!code) return null;
  try {
    const html = await get(`https://www.instagram.com/p/${code}/embed/captioned/`, {}, 20000);
    const caption = (html.match(/class="Caption"[^>]*>([\s\S]*?)<\/div>/) || [])[1] || "";
    const ts = (html.match(/"taken_at_timestamp":(\d+)/) || html.match(/datetime="([^"]+)"/) || [])[1];
    const video = (html.match(/"video_url":"([^"]+)"/) || [])[1];
    const img = (html.match(/class="EmbeddedMediaImage"[^>]*src="([^"]+)"/) || [])[1];
    const owner = (html.match(/class="UsernameText"[^>]*>([^<]+)</) || html.match(/"owner":\{[^}]*"username":"([^"]+)"/) || [])[1] || "";
    return { owner, text: caption.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), date: ts ? iso(/^\d+$/.test(ts) ? Number(ts) : ts) : "", media: video ? [{ type: "video", url: JSON.parse(`"${video}"`) }] : img ? [{ type: "image", url: img.replace(/&amp;/g, "&") }] : [] };
  } catch { return null; }
}

/* ---------- TikTok ---------- */
export async function tiktokFree(h) {
  const why = [];
  // 1. TikWM, a free public TikTok API (posts with captions, dates and playable video links for transcription).
  try {
    const r = await fetch("https://www.tikwm.com/api/user/posts", { method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" }, body: `unique_id=${encodeURIComponent(h)}&count=10&cursor=0`, signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    const vids = j?.data?.videos || [];
    if (vids.length) return { route: "tikwm", posts: vids.map((v) => ({ url: `https://www.tiktok.com/@${h}/video/${v.video_id}`, title: "", date: iso(v.create_time), text: v.title || "", video: true, media: v.play ? [{ type: "video", url: v.play.startsWith("http") ? v.play : `https://www.tikwm.com${v.play}` }] : [], mentions: tags(v.title), owner: h })) };
    why.push(`tikwm: ${j?.msg || "no videos"}`);
  } catch (e) { why.push(`tikwm ${e.message}`); }
  // 2. yt-dlp's TikTok profile reader.
  try {
    const { execSync } = await import("node:child_process");
    const out = execSync(`timeout 90 python3 -m yt_dlp --flat-playlist -J --playlist-end 10 "https://www.tiktok.com/@${h}"`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20e6 });
    const entries = JSON.parse(out).entries || [];
    if (entries.length) return { route: "yt-dlp", posts: entries.map((e) => ({ url: e.url || `https://www.tiktok.com/@${h}/video/${e.id}`, title: "", date: e.timestamp ? iso(e.timestamp) : "", text: e.title || e.description || "", video: true, media: [], mentions: tags(e.description), owner: h, needsDate: !e.timestamp })) };
    why.push("yt-dlp: no videos");
  } catch (e) { why.push(`yt-dlp ${String(e.message).split("\n").find((l) => /ERROR/.test(l))?.slice(0, 60) || "failed"}`); }
  throw new Error(why.join("; "));
}

/* ---------- X: more free ways to find an account's recent post ids ---------- */
export async function xIdsFree(h) {
  const ids = new Set(), routes = [];
  const grab = (txt, route) => { let n = 0; for (const m of String(txt).matchAll(new RegExp(`${h}/status(?:es)?/(\\d{15,20})`, "gi"))) { if (!ids.has(m[1])) n++; ids.add(m[1]); } for (const m of String(txt).matchAll(/"id_str":"(\d{15,20})"/g)) { if (!ids.has(m[1])) n++; ids.add(m[1]); } routes.push(`${route} ${n}`); };
  // X's embedded-timeline service, fetched through the reader service (a different network, so not rate-limited like ours).
  try { grab(await reader(`https://syndication.twitter.com/srv/timeline-profile/screen-name/${h}?showReplies=false`), "timeline via reader"); } catch (e) { routes.push(`timeline via reader ${e.message}`); }
  // DuckDuckGo's plain-HTML results for the account's posts.
  if (ids.size < 3) try { grab(await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(`site:x.com/${h}/status`)}&df=w`), "duckduckgo"); } catch (e) { routes.push(`duckduckgo ${e.message}`); }
  return { ids: [...ids], routes };
}

/* ---------- Topic discovery without a paid service: Bluesky's public search ---------- */
export async function blueskySearch(q, limit = 25) {
  const j = JSON.parse(await get(`https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts?q=${encodeURIComponent(q)}&sort=latest&limit=${limit}`));
  return (j.posts || []).map((p) => ({ handle: p.author?.handle, name: p.author?.displayName, url: `https://bsky.app/profile/${p.author?.handle}/post/${p.uri.split("/").pop()}`, date: p.record?.createdAt, text: p.record?.text || "" }));
}
