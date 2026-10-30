/* Free AI providers, tried in order, so the news desk keeps working when one is busy or out of free allowance:
   1. Google Gemini (GEMINI_API_KEY)   2. GitHub Models (the workflow's own GITHUB_TOKEN; needs "models: read")
   3. Groq (GROQ_API_KEY, optional)    Each answer records which model gave it. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const used = new Set();
export const problems = {};   // provider -> last problem seen this run, for the run log

async function gemini(model, text, temperature) {
  const key = process.env.GEMINI_API_KEY; if (!key) return { skip: true };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { temperature } }), signal: AbortSignal.timeout(150000),
  });
  if (!r.ok) return { status: r.status };
  return { text: ((await r.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("") };
}
async function openaiStyle(url, key, model, text, temperature) {
  if (!key) return { skip: true };
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature, messages: [{ role: "user", content: text }] }), signal: AbortSignal.timeout(150000),
  });
  const body = await r.text();
  if (!r.ok) return { status: `${r.status} ${body.slice(0, 120).replace(/\s+/g, " ")}` };
  try { return { text: JSON.parse(body).choices?.[0]?.message?.content || "" }; }
  catch { return { status: `unreadable reply: ${body.slice(0, 80).replace(/\s+/g, " ")}` }; }
}

/* Pick a current model from a provider's own list (model names change over time). */
const picked = {};
async function pickModel(name, listUrl, key, prefs) {
  if (picked[name] !== undefined) return picked[name];
  picked[name] = null;
  try {
    const r = await fetch(listUrl, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
    const body = await r.text();
    let ids = [];
    try { const j = JSON.parse(body); ids = (j.data || j.models || j || []).map((m) => m.id || m.name).filter(Boolean); } catch {}
    if (!ids.length) { problems[`${name}:list`] = `${r.status} ${body.slice(0, 80).replace(/\s+/g, " ")}`; return null; }
    for (const p of prefs) { const hit = ids.find((id) => id.toLowerCase().includes(p)); if (hit) return (picked[name] = hit); }
    return (picked[name] = ids[0]);
  } catch (e) { problems[`${name}:list`] = String(e.message).slice(0, 80); return null; }
}
async function groq(t, x) {
  const key = process.env.GROQ_API_KEY; if (!key) return { skip: true };
  const m = await pickModel("groq", "https://api.groq.com/openai/v1/models", key, ["llama-4-maverick", "llama-3.3-70b", "gpt-oss-120b", "llama-4", "70b", "qwen", "gpt-oss"]);
  if (!m) return { status: "no model list" };
  used.add(`groq:${m}`);
  const res = await openaiStyle("https://api.groq.com/openai/v1/chat/completions", key, m, t, x);
  if (!res.text) used.delete(`groq:${m}`);
  return res;
}
async function github(t, x, prefs) {
  const key = process.env.GITHUB_TOKEN; if (!key) return { skip: true };
  const m = await pickModel(`github-${prefs[0]}`, "https://models.github.ai/catalog/models", key, prefs);
  if (!m) return { status: "no model list" };
  return openaiStyle("https://models.github.ai/inference/chat/completions", key, m, t, x);
}

const PROVIDERS = [
  ["gemini-3.8-flash", (t, x) => gemini("gemini-3.8-flash", t, x)],
  ["gemini-flash-latest", (t, x) => gemini("gemini-flash-latest", t, x)],
  ["groq", groq],
  ["github:gpt", (t, x) => github(t, x, ["gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt"])],
  ["github:llama", (t, x) => github(t, x, ["llama-3.3-70b", "llama-4", "llama"])],
  ["gemini-flash-lite-latest", (t, x) => gemini("gemini-flash-lite-latest", t, x)],
];

/* Ask the first provider that answers. `prefer` lets a caller start with a different provider (e.g. so a fact-check
   is done by a different model from the one that wrote the item). */
export async function ask(text, { temperature = 0.2, prefer = 0, log = console.log } = {}) {
  const order = [...PROVIDERS.slice(prefer), ...PROVIDERS.slice(0, prefer)];
  for (const [name, call] of order) {
    for (let tries = 0; tries < 2; tries++) {
      let res;
      try { res = await call(text, temperature); } catch (e) { res = { status: e.name === "TimeoutError" ? "timeout" : `error ${String(e.cause?.code || e.message).slice(0, 80)}` }; }
      if (res.skip) break;
      if (res.text) { used.add(name); return res.text; }
      if ((res.status === 429 || res.status === 503) && tries === 0) { log(`${name}: busy (${res.status}), waiting 30s`); await wait(30000); continue; }
      problems[name] = String(res.status || "no answer").slice(0, 100);
      log(`${name}: ${res.status || "no answer"}`); break;
    }
  }
  return "";
}
export const GITHUB_PROVIDER = 2;   // index of the first non-Gemini provider (Groq), for independent checks   // index of the first non-Gemini provider, for independent checks
