/* Free AI providers, tried in order, so the news desk keeps working when one is busy or out of free allowance:
   1. Google Gemini (GEMINI_API_KEY)   2. GitHub Models (the workflow's own GITHUB_TOKEN; needs "models: read")
   3. Groq (GROQ_API_KEY, optional)    Each answer records which model gave it. */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const used = new Set();

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
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature, messages: [{ role: "user", content: text }] }), signal: AbortSignal.timeout(150000),
  });
  if (!r.ok) return { status: r.status };
  return { text: (await r.json()).choices?.[0]?.message?.content || "" };
}

const PROVIDERS = [
  ["gemini-3.8-flash", (t, x) => gemini("gemini-3.8-flash", t, x)],
  ["gemini-flash-latest", (t, x) => gemini("gemini-flash-latest", t, x)],
  ["github:openai/gpt-4.1-mini", (t, x) => openaiStyle("https://models.github.ai/inference/chat/completions", process.env.GITHUB_TOKEN, "openai/gpt-4.1-mini", t, x)],
  ["github:meta/Llama-3.3-70B-Instruct", (t, x) => openaiStyle("https://models.github.ai/inference/chat/completions", process.env.GITHUB_TOKEN, "meta/Llama-3.3-70B-Instruct", t, x)],
  ["groq:llama-3.3-70b-versatile", (t, x) => openaiStyle("https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, "llama-3.3-70b-versatile", t, x)],
  ["gemini-flash-lite-latest", (t, x) => gemini("gemini-flash-lite-latest", t, x)],
];

/* Ask the first provider that answers. `prefer` lets a caller start with a different provider (e.g. so a fact-check
   is done by a different model from the one that wrote the item). */
export async function ask(text, { temperature = 0.2, prefer = 0, log = console.log } = {}) {
  const order = [...PROVIDERS.slice(prefer), ...PROVIDERS.slice(0, prefer)];
  for (const [name, call] of order) {
    for (let tries = 0; tries < 2; tries++) {
      let res;
      try { res = await call(text, temperature); } catch (e) { res = { status: e.name === "TimeoutError" ? "timeout" : "error" }; }
      if (res.skip) break;
      if (res.text) { used.add(name); return res.text; }
      if ((res.status === 429 || res.status === 503) && tries === 0) { log(`${name}: busy (${res.status}), waiting 30s`); await wait(30000); continue; }
      log(`${name}: ${res.status || "no answer"}`); break;
    }
  }
  return "";
}
export const GITHUB_PROVIDER = 2;   // index of the first non-Gemini provider, for independent checks
