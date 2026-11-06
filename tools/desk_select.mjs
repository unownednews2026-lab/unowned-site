/* Pure selection rules for the hourly desk, kept apart so they can be tested (test/desk_select.test.mjs). */

/* When a story last got a new item (its newest "added" time; falls back to the event date). */
export const lastNew = (s) => (s.events || []).map((e) => e.added || e.date).filter(Boolean).sort().pop() || "";

/* Stalest story first. Not "most headlines first": that let the busiest story take every run while quiet ones fell days behind. */
export const stalestFirst = (hot) => [...hot].sort((a, b) => lastNew(a.s).localeCompare(lastNew(b.s)) || b.h.length - a.h.length);

/* The headline safety net needs two DIFFERENT established outlets on the same story, so one outlet's headline alone never becomes an item. */
export const corroborated = (usable) => new Set((usable || []).map((x) => String(x.domain || "").replace(/^www\./, "")).filter(Boolean)).size >= 2;
