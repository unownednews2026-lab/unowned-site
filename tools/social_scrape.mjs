/* Signed-in readers for X, Instagram and TikTok through a scraping service (Apify). These platforms hide posts from
   readers who aren't signed in, so the free routes can't see every account. Used only when the APIFY_TOKEN secret is
   set; otherwise the desk keeps using the free routes. Each platform's reader ("actor") can be changed in
   tools/primary_sources.json under "_scrapers" without touching code.
   Every post comes back in one shape: {url, title, date, text, video, media: [{type, url}]}. */

const DEFAULTS = {
  x: { actor: "apidojo~tweet-scraper", input: (h, n) => ({ twitterHandles: [h], maxItems: n, sort: "Latest" }) },
  instagram: { actor: "apify~instagram-scraper", input: (h, n) => ({ directUrls: [`https://www.instagram.com/${h}/`], resultsType: "posts", resultsLimit: n, addParentData: false }) },
  tiktok: { actor: "clockworks~tiktok-scraper", input: (h, n) => ({ profiles: [h], resultsPerPage: n, shouldDownloadVideos: true, shouldDownloadCovers: false }) },
};

const pick = (o, ...keys) => { for (const k of keys) { const v = k.split(".").reduce((a, p) => (a == null ? a : a[p]), o); if (v != null && v !== "") return v; } return ""; };
const iso = (d) => { if (!d) return ""; const t = typeof d === "number" ? (d < 1e12 ? d * 1000 : d) : Date.parse(d); return isNaN(t) ? "" : new Date(t).toISOString(); };

function normalise(platform, h, it) {
  if (platform === "x") {
    const author = String(pick(it, "author.userName", "author.username", "user.screen_name", "username")).toLowerCase();
    const id = pick(it, "id", "id_str");
    // Who this post points to (network discovery): accounts it mentions, quotes or reposts.
    const mentions = [...(pick(it, "entities.user_mentions") || []).map((m) => m.screen_name || m.username),
      pick(it, "quote.author.userName", "quoted_tweet.author.userName", "quotedStatus.author.userName"),
      pick(it, "retweet.author.userName", "retweeted_tweet.author.userName", "retweetedStatus.author.userName")].filter(Boolean);
    const repost = it.isRetweet || it.retweeted_status || (author && author !== h.toLowerCase());
    if (repost) return { url: `https://x.com/${h}/status/${id}`, date: iso(pick(it, "createdAt", "created_at")), text: "", skip: true, mentions: [...mentions, author].filter(Boolean), media: [] };
    const media = [];
    for (const m of pick(it, "extendedEntities.media", "media", "entities.media") || []) {
      const vids = (m.video_info?.variants || []).filter((v) => /mp4/.test(v.content_type || "")).sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
      if (vids.length) media.push({ type: "video", url: vids[Math.min(1, vids.length - 1)].url });   // a modest quality is enough to transcribe
      else if (m.media_url_https || m.url) media.push({ type: "image", url: m.media_url_https || m.url });
    }
    return { url: pick(it, "url", "twitterUrl") || `https://x.com/${h}/status/${id}`, title: "", date: iso(pick(it, "createdAt", "created_at")), text: String(pick(it, "fullText", "full_text", "text")), video: media.some((m) => m.type === "video"), media, mentions };
  }
  if (platform === "instagram") {
    const owner = String(pick(it, "ownerUsername", "owner.username")).toLowerCase();
    if (owner && owner !== h.toLowerCase()) return null;
    const media = [];
    if (it.videoUrl) media.push({ type: "video", url: it.videoUrl });
    else for (const u of (it.images && it.images.length ? it.images : [it.displayUrl]).filter(Boolean).slice(0, 3)) media.push({ type: "image", url: u });
    const mentions = [...(it.mentions || []), ...(it.taggedUsers || []).map((u) => u.username), ...(it.coauthorProducers || []).map((u) => u.username)].filter(Boolean);
    return { url: pick(it, "url") || (it.shortCode ? `https://www.instagram.com/p/${it.shortCode}/` : ""), title: "", date: iso(pick(it, "timestamp", "takenAt")), text: String(pick(it, "caption")), video: !!it.videoUrl, media, mentions };
  }
  if (platform === "tiktok") {
    const owner = String(pick(it, "authorMeta.name", "author.uniqueId")).toLowerCase();
    if (owner && owner !== h.toLowerCase()) return null;
    const vid = (it.mediaUrls || [])[0] || pick(it, "videoMeta.downloadAddr", "video.downloadAddr");
    return { url: pick(it, "webVideoUrl", "url"), title: "", date: iso(pick(it, "createTimeISO", "createTime")), text: String(pick(it, "text", "desc")), video: true, media: vid ? [{ type: "video", url: vid }] : [], mentions: (it.mentions || []).map((m) => String(m).replace(/^@/, "")) };
  }
  return null;
}

/* Returns posts, newest first, or throws with a short reason. */
export async function scrape(platform, handle, { count = 8, config = {} } = {}) {
  const token = process.env.APIFY_TOKEN; if (!token) throw new Error("no APIFY_TOKEN");
  const d = DEFAULTS[platform]; if (!d) throw new Error(`no scraper for ${platform}`);
  const actor = config.actor || d.actor;
  const input = { ...d.input(handle, count), ...(config.input || {}) };
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=240&memory=1024`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(input), signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw new Error(`Apify ${actor}: HTTP ${r.status} ${(await r.text()).slice(0, 120).replace(/\s+/g, " ")}`);
  const items = await r.json();
  if (!Array.isArray(items)) throw new Error(`Apify ${actor}: unexpected answer`);
  if (items[0]?.error || items[0]?.noResults) throw new Error(`Apify ${actor}: ${String(items[0].error || "no results").slice(0, 100)}`);
  return items.map((it) => normalise(platform, handle, it)).filter((x) => x && x.url && x.date).sort((a, b) => b.date.localeCompare(a.date));
}

/* Search X for recent posts about a topic (any account). Returns [{url, date, text, author, authorName, followers, verifiedType, blue}]. */
export async function searchX(query, count = 25, config = {}) {
  const token = process.env.APIFY_TOKEN; if (!token) throw new Error("no APIFY_TOKEN");
  const actor = config.actor || DEFAULTS.x.actor;
  const r = await fetch(`https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?timeout=240&memory=1024`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ searchTerms: [query], maxItems: count, sort: "Latest" }), signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) throw new Error(`Apify ${actor}: HTTP ${r.status} ${(await r.text()).slice(0, 120).replace(/\s+/g, " ")}`);
  const items = await r.json();
  if (!Array.isArray(items)) throw new Error(`Apify ${actor}: unexpected answer`);
  return items.filter((it) => it && !it.noResults && !it.error).map((it) => ({
    url: pick(it, "url", "twitterUrl"), date: iso(pick(it, "createdAt", "created_at")), text: String(pick(it, "fullText", "full_text", "text")),
    author: String(pick(it, "author.userName", "author.username", "user.screen_name")), authorName: String(pick(it, "author.name", "user.name")),
    followers: Number(pick(it, "author.followers", "author.followersCount", "user.followers_count")) || 0,
    verifiedType: String(pick(it, "author.verifiedType", "user.verified_type")), blue: !!pick(it, "author.isBlueVerified", "user.is_blue_verified"),
  }));
}
