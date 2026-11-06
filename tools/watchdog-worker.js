/* Outside watchdog for Unowned. Runs on Cloudflare Workers (free), so it keeps working when GitHub Actions or the Claude
   plan is stopped, which are the two things that run everything else. Every 30 minutes it reads https://unownednews.com/health.json
   and sends a phone alert (ntfy.sh, free, no account) when:
     - the desks have not checked for news in 5+ hours (the whole pipeline is down),
     - any single story has had no new item for 36+ hours (quiet stories are listed but only alerted once a day),
     - the site itself cannot be reached.
   Setup: see the comment at the bottom. Variables: NTFY_TOPIC (a long random word), SITE (default https://unownednews.com). */
const H = 36e5;
export default {
  async scheduled(_ev, env) {
    const site = env.SITE || "https://unownednews.com";
    const topic = env.NTFY_TOPIC; if (!topic) return;
    const send = (title, body) => fetch(`https://ntfy.sh/${topic}`, { method: "POST", headers: { Title: title, Priority: "high", Tags: "warning" }, body });
    let h;
    try { const r = await fetch(`${site}/health.json?x=${Date.now()}`, { cf: { cacheTtl: 0 } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); h = await r.json(); }
    catch (e) { await send("Unowned site unreachable", `Could not read ${site}/health.json (${e.message}).`); return; }
    const age = (iso) => (iso ? (Date.now() - Date.parse(iso)) / H : 1e9);
    const problems = [];
    if (age(h.lastChecked) > 5) problems.push(`No desk has checked for news for ${Math.round(age(h.lastChecked))} hours: the hourly desks are not running (check GitHub Actions billing and the Claude plan).`);
    const stale = Object.entries(h.stories || {}).filter(([, s]) => age(s.lastNew) > 36).map(([k, s]) => `${k} (${Math.round(age(s.lastNew))}h)`);
    if (stale.length) problems.push(`No new item for 36+ hours: ${stale.join(", ")}`);
    if (!problems.length) return;
    // At most one alert per 6 hours for the same kind of problem.
    const key = problems.map((p) => p.slice(0, 20)).join("|");
    const last = env.STATE ? await env.STATE.get("last") : null;
    if (last) { const [k, t] = JSON.parse(last); if (k === key && Date.now() - t < 6 * H) return; }
    await send("Unowned needs attention", problems.join("\n"));
    if (env.STATE) await env.STATE.put("last", JSON.stringify([key, Date.now()]));
  },
};
/* Setup (5 minutes, Cloudflare dashboard): Workers & Pages > Create > Worker > paste this file > Deploy.
   Settings > Variables: NTFY_TOPIC = a long random word of your own. Settings > Triggers > Cron: *\/30 * * * *
   (optional) KV namespace bound as STATE to stop repeat alerts. On your phone: install the free "ntfy" app and subscribe to that topic. */
