/*
 * Unowned contribution handler (Cloudflare Pages Function, route: POST /api/submit).
 *
 * Privacy rules, enforced here:
 *  - Stores ONLY the fields the contributor typed, plus the submission date.
 *  - Never reads or stores IP addresses, user agents, cookies, referrers or any request header.
 *  - No names, emails or phone numbers are asked for, and any that are typed are not required.
 *
 * Storage: a Workers KV namespace bound as SUBMISSIONS. Review entries in the Cloudflare
 * dashboard (Storage & databases → Workers KV → SUBMISSIONS).
 */

const MAX = { url: 2000, details: 2000, item: 200 };
const STORY_SLUG = /^[a-z0-9-]{1,60}$/; // any story slug, or "other"

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function wantsJson(request) {
  return (request.headers.get("Accept") || "").includes("application/json");
}

function reply(request, status, body) {
  if (wantsJson(request)) return json(status, body);
  const page = status < 400 ? "/thanks/" : "/submit/?error=1";
  return Response.redirect(new URL(page, request.url).toString(), 303);
}

function clean(value, max) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

function isPublicLink(value) {
  try {
    const u = new URL(value);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.SUBMISSIONS) {
    return reply(request, 503, { error: "Submissions are not switched on yet. Please try again later." });
  }

  let form;
  try {
    form = await request.formData();
  } catch {
    return reply(request, 400, { error: "That didn't go through. Check the fields and try again." });
  }

  // Honeypot: real people never see or fill this field.
  if (clean(form.get("website"), 10)) {
    return reply(request, 200, { message: "Received. Thank you." });
  }

  const type = clean(form.get("type"), 20);
  const story = clean(form.get("story"), 60);
  const url = clean(form.get("url"), MAX.url);
  const details = clean(form.get("details"), MAX.details);
  const item = clean(form.get("item"), MAX.item);

  if (type !== "link" && type !== "correction") {
    return reply(request, 400, { error: "Unknown form. Reload the page and try again." });
  }
  if (story && !STORY_SLUG.test(story)) {
    return reply(request, 400, { error: "Pick a story from the list." });
  }
  if (type === "link" && !isPublicLink(url)) {
    return reply(request, 400, { error: "Add a full link that starts with https://" });
  }
  if (type === "link" && details.length < 10) {
    return reply(request, 400, { error: "Tell us in a sentence what the link shows." });
  }
  if (type === "correction" && details.length < 10) {
    return reply(request, 400, { error: "Tell us what is wrong, in a sentence or two." });
  }
  if (type === "correction" && url && !isPublicLink(url)) {
    return reply(request, 400, { error: "The supporting link should start with https://" });
  }

  const day = new Date().toISOString().slice(0, 10);
  const id = `${type}:${day}:${crypto.randomUUID().slice(0, 8)}`;
  const record = { id, type, story: story || "unspecified", url: url || null, item: item || null, details, received: day, status: "new" };

  await env.SUBMISSIONS.put(id, JSON.stringify(record), { expirationTtl: 60 * 60 * 24 * 180 });

  return reply(request, 200, {
    message: "Received. Thank you. A person will review it before anything is published. We kept no record of who sent it.",
  });
}

export async function onRequest({ request }) {
  return json(405, { error: "Use the forms on the website to send a link or correction." });
}
