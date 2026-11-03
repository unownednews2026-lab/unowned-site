/* Turns the media in a social post into text we can check and grade. Nothing is embedded or played on our site:
   the post is a SOURCE, and this is how we read it.
     video  -> what is said in it, transcribed and translated to English (Gemini; Groq Whisper as the backup)
     image  -> every piece of text in it (OCR, translated) plus one plain sentence on what it shows (Gemini vision)
   Free: Gemini's and Groq's free tiers. Each result says which model produced it. */
import { problems } from "./llm.mjs";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const MAX = 18 * 1024 * 1024;   // Gemini takes up to ~20 MB inline; Groq up to 25 MB

const VIDEO_PROMPT = "Transcribe everything said in this video. If it is not in English, give an English translation of everything said. Then, on a line starting 'On screen:', list any visible on-screen text (captions, banners, signs, dates). Report only what is said or shown; add nothing, no commentary, no guesses about who or where.";
const IMAGE_PROMPT = "Read ALL text visible in this image (OCR), exactly, in its original language, then give an English translation if it is not in English. Then, on a line starting 'Shows:', one plain sentence on what the image shows. Report only what is visible; no guesses about who, where or when unless written in the image.";

async function download(url) {
  const r = await fetch(url, { headers: { "User-Agent": "UnownedNewsBot/1.0 (+https://unownednews.com; news verification)" }, redirect: "follow", signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`download HTTP ${r.status}`);
  const len = Number(r.headers.get("content-length") || 0);
  if (len > MAX) throw new Error(`too large (${Math.round(len / 1e6)} MB)`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > MAX) throw new Error(`too large (${Math.round(buf.length / 1e6)} MB)`);
  return { buf, mime: (r.headers.get("content-type") || "").split(";")[0] };
}

async function gemini(parts, label) {
  const cfg = label === "video" ? { temperature: 0, mediaResolution: "MEDIA_RESOLUTION_LOW" } : { temperature: 0 };
  const key = process.env.GEMINI_API_KEY; if (!key) return "";
  for (const model of ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-3.8-flash"]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: cfg }),
          signal: AbortSignal.timeout(180000),
        });
        if (r.status === 429 || r.status >= 500) { problems[`${model} (${label})`] = r.status; await wait(15000); continue; }
        if (!r.ok) { problems[`${model} (${label})`] = `${r.status} ${(await r.text()).slice(0, 80).replace(/\s+/g, " ")}`; break; }
        const t = ((await r.json()).candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
        if (t.length > 10) return `${t}\n(read by ${model})`;
        break;
      } catch (e) { problems[`${model} (${label})`] = String(e.message).slice(0, 60); }
    }
  }
  return "";
}

/* Groq's free vision model: the backup reader for images. */
async function groqVision(buf, mime) {
  const key = process.env.GROQ_API_KEY; if (!key) return "";
  for (const model of ["meta-llama/llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-maverick-17b-128e-instruct"]) {
    try {
      const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0, messages: [{ role: "user", content: [{ type: "text", text: IMAGE_PROMPT }, { type: "image_url", image_url: { url: `data:${mime || "image/jpeg"};base64,${buf.toString("base64")}` } }] }] }),
        signal: AbortSignal.timeout(120000),
      });
      if (!r.ok) { problems[`groq vision ${model.split("/")[1]}`] = `${r.status} ${(await r.text()).slice(0, 80)}`; continue; }
      const t = ((await r.json()).choices?.[0]?.message?.content || "").trim();
      if (t.length > 10) return `${t}\n(read by Groq ${model.split("/")[1]})`;
    } catch (e) { problems["groq vision"] = String(e.message).slice(0, 60); }
  }
  return "";
}

/* Groq's free Whisper: speech to English text (the translations endpoint always answers in English). */
async function whisper(buf, mime) {
  const key = process.env.GROQ_API_KEY; if (!key) return "";
  for (const [endpoint, model] of [["translations", "whisper-large-v3"], ["transcriptions", "whisper-large-v3-turbo"]]) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buf], { type: mime || "video/mp4" }), `media.${/webm/.test(mime) ? "webm" : /mpeg|mp3/.test(mime) ? "mp3" : "mp4"}`);
      form.append("model", model); form.append("response_format", "text"); form.append("temperature", "0");
      const r = await fetch(`https://api.groq.com/openai/v1/audio/${endpoint}`, { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(180000) });
      if (!r.ok) { problems[`groq whisper (${endpoint})`] = `${r.status} ${(await r.text()).slice(0, 80)}`; continue; }
      const t = (await r.text()).trim();
      if (t.length > 10) return `${t}\n(transcribed by Groq ${model})`;
    } catch (e) { problems[`groq whisper`] = String(e.message).slice(0, 60); }
  }
  return "";
}

/* A public YouTube video: Gemini opens it itself (YouTube's bot checks don't apply). */
export async function youtubeText(url) {
  const t = await gemini([{ fileData: { fileUri: url } }, { text: VIDEO_PROMPT }], "video");
  return t ? `[What is said in the video] ${t}` : "";
}

/* media: [{type: "video"|"image", url}] -> text, at most 3 pieces of media per post. */
export async function mediaText(media = [], log = () => {}) {
  const out = [];
  for (const m of media.filter((x) => x && x.url).slice(0, 3)) {
    try {
      if (/youtube\.com\/watch|youtu\.be\//.test(m.url)) { const t = await youtubeText(m.url); if (t) out.push(t); continue; }
      const { buf, mime } = await download(m.url);
      const isVideo = m.type === "video" || /^video\//.test(mime);
      if (isVideo) {
        let t = await gemini([{ inlineData: { mimeType: /^video\//.test(mime) ? mime : "video/mp4", data: buf.toString("base64") } }, { text: VIDEO_PROMPT }], "video");
        if (!t) t = await whisper(buf, mime);
        if (t) out.push(`[What is said in the video] ${t}`); else log(`could not transcribe a video (${m.url.slice(0, 80)})`);
      } else {
        const im = /^image\//.test(mime) ? mime : "image/jpeg";
        let t = await gemini([{ inlineData: { mimeType: im, data: buf.toString("base64") } }, { text: IMAGE_PROMPT }], "image");
        if (!t && buf.length < 4e6) t = await groqVision(buf, im);
        if (t) out.push(`[Text and content of the image] ${t}`); else log(`could not read an image (${m.url.slice(0, 80)})`);
      }
    } catch (e) { log(`media skipped (${String(e.message).slice(0, 60)}): ${m.url.slice(0, 80)}`); }
  }
  return out.join("\n\n").slice(0, 9000);
}
