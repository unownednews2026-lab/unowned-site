# Unowned website

The website for **unownednews.com**: news nobody owns, told by the people who were there.

## How it's built

- `content/stories/*.json` holds each story: timeline, disputed claims, accountability log, places, figures and sources. **Updating a story means editing this file.**
- `node build.mjs` turns the content into the finished site in `dist/`.
- `static/` holds styles, scripts, fonts (self-hosted, so readers never contact a third party), images and security headers.
- `functions/api/submit.js` receives the "Send a link" and "Report an error" forms. It stores only what the contributor typed and the date: no IP address, no device details, no name or email. Entries are deleted automatically after 180 days.

Every change goes through Git, so there is a permanent record of what changed and when.

## Deploying on Cloudflare Pages (one-time setup)

1. **Create a KV namespace** for submissions: Cloudflare dashboard → Storage & databases → Workers KV → Create → name it `unowned-submissions`.
2. **Create the Pages project**: Workers & Pages → Create → Pages → Connect to Git → choose this repository.
   - Build command: `node build.mjs`
   - Build output directory: `dist`
3. **Bind the KV namespace**: in the new project → Settings → Bindings → Add → KV namespace → variable name `SUBMISSIONS` → select `unowned-submissions`. Redeploy.
4. **Add the domain**: project → Custom domains → Set up a custom domain → `unownednews.com` (and `www.unownednews.com`).

After that, every change pushed to the main branch is published automatically.

## Reading submissions

Cloudflare dashboard → Storage & databases → Workers KV → `unowned-submissions`. Each entry is one submission. Treat everything in them as unverified until checked.

## Running locally

```
npm install
node build.mjs
npx wrangler pages dev dist --kv SUBMISSIONS
```
