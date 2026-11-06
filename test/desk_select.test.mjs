import test from "node:test";
import assert from "node:assert/strict";
import { lastNew, stalestFirst, corroborated } from "../tools/desk_select.mjs";

const story = (slug, ...added) => ({ slug, events: added.map((a) => ({ added: a, date: a.slice(0, 10) })) });
const hot = (s, n) => ({ s, h: new Array(n).fill({}) });

test("lastNew is the newest added time, not the newest event date", () => {
  const s = { events: [{ added: "2026-11-02T10:00:00Z", date: "2026-11-30" }, { added: "2026-11-04T09:00:00Z", date: "2026-11-01" }] };
  assert.equal(lastNew(s), "2026-11-04T09:00:00Z");
});

test("the stalest story runs first even when another has many more headlines", () => {
  const busy = hot(story("france", "2026-11-05T22:00:00Z"), 40);
  const quiet = hot(story("serbia", "2026-11-02T04:00:00Z"), 2);
  const mid = hot(story("germany", "2026-11-04T20:00:00Z"), 9);
  assert.deepEqual(stalestFirst([busy, quiet, mid]).map((x) => x.s.slug), ["serbia", "germany", "france"]);
});

test("equal staleness falls back to the story with more headlines", () => {
  const a = hot(story("a", "2026-11-03T00:00:00Z"), 1), b = hot(story("b", "2026-11-03T00:00:00Z"), 5);
  assert.deepEqual(stalestFirst([a, b]).map((x) => x.s.slug), ["b", "a"]);
});

test("a story with no items sorts as stalest", () => {
  const empty = hot({ slug: "new", events: [] }, 1), old = hot(story("old", "2026-10-01T00:00:00Z"), 1);
  assert.equal(stalestFirst([old, empty])[0].s.slug, "new");
});

test("the safety net needs two different outlets", () => {
  assert.equal(corroborated([{ domain: "reuters.com" }]), false);
  assert.equal(corroborated([{ domain: "www.reuters.com" }, { domain: "reuters.com" }]), false);
  assert.equal(corroborated([{ domain: "reuters.com" }, { domain: "www.lemonde.fr" }]), true);
  assert.equal(corroborated([]), false);
});
