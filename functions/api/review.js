/*
 * Reader-submission review feed (Cloudflare Pages Function, route: /api/review).
 * Used only by the hourly GitHub job, which passes them to the news desk for checking.
 *   GET  -> submissions with status "new"
 *   POST {"id": "..."} -> marks one as "forwarded"
 * Requires the REVIEW_TOKEN secret (Cloudflare Pages → Settings → Variables and secrets), sent as "Authorization: Bearer <token>".
 * Without it, this route is switched off.
 */
function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
}
function allowed(request, env) {
  const want = String(env.REVIEW_KEY || env.REVIEW_TOKEN || "").trim();
  const got = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (want.length < 24 || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
export async function onRequestGet({ request, env }) {
  if (!env.SUBMISSIONS || !allowed(request, env)) return json(404, { error: "Not found" });
  const out = [];
  let cursor;
  do {
    const page = await env.SUBMISSIONS.list({ cursor, limit: 1000 });
    for (const k of page.keys) {
      const r = await env.SUBMISSIONS.get(k.name, "json");
      if (r && r.status === "new") out.push(r);
      if (out.length >= 50) break;
    }
    cursor = page.list_complete || out.length >= 50 ? null : page.cursor;
  } while (cursor);
  return json(200, { submissions: out });
}
export async function onRequestPost({ request, env }) {
  if (!env.SUBMISSIONS || !allowed(request, env)) return json(404, { error: "Not found" });
  let id = "";
  try { id = String((await request.json()).id || ""); } catch {}
  const r = id && (await env.SUBMISSIONS.get(id, "json"));
  if (!r) return json(404, { error: "Not found" });
  r.status = "forwarded";
  await env.SUBMISSIONS.put(id, JSON.stringify(r), { expirationTtl: 60 * 60 * 24 * 180 });
  return json(200, { ok: true });
}
export async function onRequest() { return json(404, { error: "Not found" }); }
