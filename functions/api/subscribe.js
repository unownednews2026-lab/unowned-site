/*
 * Daily email sign-up (Cloudflare Pages Function, route: POST /api/subscribe).
 *
 * Adds the address to the Unowned newsletter on Buttondown through Buttondown's API, so readers can sign up
 * without leaving unownednews.com. Buttondown then sends its own confirmation email (double opt-in): nobody
 * gets the daily email until they click that link.
 *
 * Privacy: only the email address is forwarded. No IP address, user agent, cookie or referrer is read, stored or sent.
 * Needs the BUTTONDOWN_API_KEY secret in Cloudflare Pages (Settings → Variables and Secrets).
 */

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function page(status, text) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Unowned daily email</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:15vh auto;padding:0 20px;line-height:1.5"><p>${text}</p><p><a href="/">Back to Unowned</a></p></body>`;
  return new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function reply(request, status, message) {
  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  return wantsJson ? json(status, status < 400 ? { message } : { error: message }) : page(status, message);
}

export async function onRequestPost({ request, env }) {
  if (!env.BUTTONDOWN_API_KEY) return reply(request, 503, "Sign-up isn't switched on yet. Please try again later.");

  let form;
  try { form = await request.formData(); } catch { return reply(request, 400, "That didn't go through. Please check your email address and try again."); }

  // Honeypot: real people never see or fill this field.
  if (String(form.get("website") || "").trim()) return reply(request, 200, "Almost done: check your inbox for a confirmation email.");

  const email = String(form.get("email") || "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 254) return reply(request, 400, "That doesn't look like an email address. Please check it and try again.");

  // Buttondown's firewall judges sign-ups by IP address. We never send readers' IP addresses, so every request would
  // look like it came from one Cloudflare server and could be blocked. Instead we ask Buttondown to skip the firewall
  // (allowed for trusted server-side sign-ups, up to 5 an hour); the honeypot above and Buttondown's confirmation
  // email (double opt-in) still stop fake sign-ups. If that hourly allowance is used up, we try once without it.
  const send = (bypass) => fetch("https://api.buttondown.com/v1/subscribers", {
    method: "POST",
    headers: {
      Authorization: `Token ${env.BUTTONDOWN_API_KEY}`,
      "Content-Type": "application/json",
      ...(bypass ? { "X-Buttondown-Bypass-Firewall": "true" } : {}),
    },
    body: JSON.stringify({ email_address: email, type: "unactivated" }),
  });
  let res;
  try {
    res = await send(true);
    if (res.status === 429) res = await send(false);
  } catch {
    return reply(request, 502, "We couldn't reach our email provider. Please try again in a minute.");
  }

  if (res.ok) return reply(request, 200, "Almost done: check your inbox for a confirmation email from Unowned and click the link in it. (Look in spam too.)");

  const text = await res.text().catch(() => "");
  if (res.status === 400 && /already|exists|collision|subscriber_already/i.test(text)) {
    return reply(request, 200, "You're already on the list, or a confirmation email is on its way. Check your inbox (and spam).");
  }
  if (res.status === 400 && /suppress|unsubscribed|blocked/i.test(text)) {
    return reply(request, 400, "We couldn't add this address from here: it may have unsubscribed before, or our email provider's spam filter held it. Email podcast@unownednews.com and we'll sort it out.");
  }
  return reply(request, 502, `Sign-up didn't work this time (code ${res.status}). Please try again later.`);
}
