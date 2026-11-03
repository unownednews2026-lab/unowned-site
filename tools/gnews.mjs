/* Google News helpers shared by the desks. */

/* A Google News link -> the real article address (or null). */
export async function realUrl(url) {
  const id = (url.match(/news\.google\.com\/(?:rss\/)?articles\/([^?/]+)/) || [])[1];
  if (!id) return url;
  // Links from a country edition (e.g. ceid=FR:fr) must be resolved in that edition, or Google returns nothing.
  const m = url.match(/ceid=([A-Z]{2}):([a-z]{2,3})/);
  const editions = [...new Set([m ? `${m[1]}:${m[2]}` : "US:en", "US:en"])];
  for (const ed of editions) {
    const [gl, hl] = ed.split(":");
    try {
      const page = await (await fetch(`https://news.google.com/articles/${id}?hl=${hl}&gl=${gl}&ceid=${ed}`, { headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": hl }, signal: AbortSignal.timeout(15000) })).text();
      const sig = (page.match(/data-n-a-sg="([^"]+)"/) || [])[1], ts = (page.match(/data-n-a-ts="([^"]+)"/) || [])[1];
      if (!sig || !ts) continue;
      const req = [[["Fbv4je", JSON.stringify(["garturlreq", [["X", "X", ["X", "X"], null, null, 1, 1, ed, null, 1, null, null, null, null, null, 0, 1], "X", "X", 1, [1, 1, 1], 1, 1, null, 0, 0, null, 0], id, Number(ts), sig]), null, "generic"]]];
      const r = await fetch("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "User-Agent": "Mozilla/5.0" },
        body: "f.req=" + encodeURIComponent(JSON.stringify(req)), signal: AbortSignal.timeout(15000),
      });
      const res = (await r.text()).match(/\\"garturlres\\",\\"(https?:[^\\"]+)\\"/);
      if (res) return res[1];
    } catch {}
  }
  // Last resort: the free reader service opens the Google News link like a browser and reports where it lands.
  try {
    const r = await fetch(`https://r.jina.ai/${url}`, { headers: { "X-Return-Format": "text", "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30000) });
    const src = ((await r.text()).match(/^URL Source:\s*(\S+)/m) || [])[1];
    if (src && !/news\.google\.com|consent\.google/.test(src)) return src;
  } catch {}
  return null;
}
