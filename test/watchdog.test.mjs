import test from "node:test";
import assert from "node:assert/strict";
import worker from "../tools/watchdog-worker.js";

const H = 36e5, iso = (hAgo) => new Date(Date.now() - hAgo * H).toISOString();
async function run({ lastChecked, stories, editorAgo }) {
  const sent = [];
  globalThis.fetch = async (url, init) => {
    url = String(url);
    if (url.includes("ntfy.sh")) { sent.push(init.body); return { ok: true }; }
    if (url.includes("health.json")) return { ok: true, json: async () => ({ lastChecked, stories }) };
    if (url.includes("api.github.com")) return { ok: true, json: async () => (editorAgo == null ? [] : [{ issue_url: "https://api.github.com/repos/x/y/issues/2", body: "2026-11-05 — editor: nothing needed", created_at: iso(editorAgo) }]) };
    throw new Error("unexpected " + url);
  };
  await worker.scheduled({}, { NTFY_TOPIC: "t" });
  return sent;
}
const fresh = { a: { lastNew: iso(2), checked: iso(1) } };

test("healthy: no alert", async () => assert.equal((await run({ lastChecked: iso(1), stories: fresh, editorAgo: 3 })).length, 0));
test("desks stopped: alerts", async () => assert.match((await run({ lastChecked: iso(8), stories: fresh, editorAgo: 3 }))[0], /No desk has checked/));
test("a story 40h without news: alerts and names it", async () => assert.match((await run({ lastChecked: iso(1), stories: { quiet: { lastNew: iso(40), checked: iso(1) } }, editorAgo: 3 }))[0], /quiet \(40h\)/));
test("editor silent 20h: alerts", async () => assert.match((await run({ lastChecked: iso(1), stories: fresh, editorAgo: 20 }))[0], /editor has not logged/));
test("no editor log at all: alerts", async () => assert.match((await run({ lastChecked: iso(1), stories: fresh, editorAgo: null }))[0], /editor has not logged/));
