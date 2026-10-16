/*
 * Reader votes on stories (Cloudflare Pages Functions).
 *   GET  /api/votes   -> { "<slug>": { "up": n, "down": n }, ... }
 *   POST /api/votes   form fields: story, vote (up|down|none), prev (up|down|none)
 *
 * Privacy: stores only running totals per story. No IP address, device, cookie or
 * any request header is read or stored. Each browser remembers its own vote locally,
 * and sends its previous vote so a change of mind moves one count, not two.
 */
const VOTES = new Set(["up", "down", "none"]);

function json(status, body, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": cache || "no-store" },
  });
}

async function knownStories(env, request) {
  const res = await env.ASSETS.fetch(new URL("/stories.json", request.url));
  if (!res.ok) return new Set();
  return new Set(await res.json());
}

export async function onRequestGet({ env }) {
  if (!env.VOTES) return json(200, {});
  const { results } = await env.VOTES.prepare("SELECT story, up, down FROM votes").all();
  const out = {};
  for (const r of results) out[r.story] = { up: r.up, down: r.down };
  return json(200, out, "public, max-age=15");
}

export async function onRequestPost({ request, env }) {
  if (!env.VOTES) return json(503, { error: "Voting is not switched on yet." });
  let form;
  try { form = await request.formData(); } catch { return json(400, { error: "Bad request." }); }
  const story = String(form.get("story") || "");
  const vote = String(form.get("vote") || "");
  const prev = String(form.get("prev") || "none");
  if (!VOTES.has(vote) || !VOTES.has(prev) || vote === prev) return json(400, { error: "Bad vote." });
  if (!(await knownStories(env, request)).has(story)) return json(400, { error: "Unknown story." });

  const du = (vote === "up" ? 1 : 0) - (prev === "up" ? 1 : 0);
  const dd = (vote === "down" ? 1 : 0) - (prev === "down" ? 1 : 0);
  const row = await env.VOTES.prepare(
    `INSERT INTO votes (story, up, down) VALUES (?1, MAX(0, ?2), MAX(0, ?3))
     ON CONFLICT(story) DO UPDATE SET up = MAX(0, up + ?2), down = MAX(0, down + ?3)
     RETURNING up, down`
  ).bind(story, du, dd).first();
  return json(200, { story, up: row.up, down: row.down });
}

export async function onRequest() {
  return json(405, { error: "Method not allowed." });
}
