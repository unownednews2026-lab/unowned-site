/* Track record and network discovery (no AI, no cost). Runs inside the hourly "Freshness check" workflow.

   TRACK RECORD — like knowing which reporters' scoops usually turn out true. Every item the primary-source desk
   publishes from an account (content/source-record.json) is followed up:
     upheld     = it was later CONFIRMED by independent reporting (label "confirmed")
     disproved  = the editor corrected or withdrew it as wrong (a correction mentioning "[source:<key>]")
     removed    = taken down for another reason (duplicate, not new): doesn't count either way
     unconfirmed = still not confirmed after 21 days: doesn't count either way
   The record is shown next to the account's reports, and an account with a weak record (under half upheld, 4+
   resolved) goes to the editor before anything of it is published. A good record never makes a single post
   "confirmed": that still takes two independent sources.

   NETWORK DISCOVERY — like an Instagram feed that suggests related accounts. The accounts we follow keep reposting,
   mentioning and tagging others (content/network.json). Once a day, accounts that come up 3+ times are proposed to
   the editor ("Editor queue"), who checks that each really belongs to the organisation, public figure or reporter
   it claims to be, and adds the verified ones to content/network-sources.json; from then on the desk reads them. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { return ""; } };
const DAY = 864e5, now = Date.now();
const recordPath = "content/source-record.json", netPath = "content/network.json", srcPath = "content/network-sources.json";
const record = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { items: [] };
const stories = Object.fromEntries(readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => { const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8")); return [s.slug, s]; }));

/* 1. Resolve each item */
for (const it of record.items) {
  if (it.status && it.status !== "open" && it.status !== "pending") continue;
  const s = stories[it.story]; if (!s) { it.status = "removed"; continue; }
  const corr = (s.corrections || []).some((c) => String(c.text || "").includes(`[source:${it.key}]`));
  const e = [...s.events, ...(s.ground || [])].find((x) => (x.sources || []).includes(it.key));
  if (corr) it.status = "disproved";
  else if (!e) it.status = "removed";
  else if (e.label === "confirmed") it.status = "upheld";
  else if (e.label === "pending") it.status = "pending";
  else if (now - Date.parse(it.added) > 21 * DAY) it.status = "unconfirmed";
  else it.status = "open";
  if (it.status !== "open" && it.status !== "pending") it.resolvedAt = new Date(now).toISOString();
}
record.items = record.items.filter((it) => !it.resolvedAt || now - Date.parse(it.resolvedAt) < 365 * DAY);
record.accounts = {};
for (const it of record.items) {
  const a = (record.accounts[it.account] = record.accounts[it.account] || { who: it.who, upheld: 0, disproved: 0, removed: 0, unconfirmed: 0, open: 0, pending: 0 });
  a[it.status || "open"] = (a[it.status || "open"] || 0) + 1;
}
writeFileSync(recordPath, JSON.stringify(record, null, 1));
console.log(`Track record: ${record.items.length} item(s) followed across ${Object.keys(record.accounts).length} account(s).`);

/* 2. Network discovery: once a day, propose accounts that keep coming up */
if (existsSync(netPath) && (new Date(now).getUTCHours() === 6 || process.env.PROPOSE_NETWORK)) {
  const net = JSON.parse(readFileSync(netPath, "utf8"));
  const known = new Set();
  const reg = existsSync("tools/primary_sources.json") ? JSON.parse(readFileSync("tools/primary_sources.json", "utf8")) : {};
  const ns = existsSync(srcPath) ? JSON.parse(readFileSync(srcPath, "utf8")) : {};
  for (const list of [...Object.values(reg), ...Object.values(ns)]) if (Array.isArray(list)) for (const x of list) if (x.handle) known.add(`${x.type}:${String(x.handle).toLowerCase()}`);
  for (const k of Object.keys(ns._ignored || {})) known.add(k);
  for (const [k, c] of Object.entries(net.counts || {})) if (now - Date.parse(c.last || 0) > 30 * DAY) delete net.counts[k];
  const cands = Object.entries(net.counts || {}).filter(([k, c]) => c.n >= 3 && !known.has(k) && !(net.proposed || {})[k]).sort((a, b) => b[1].n - a[1].n).slice(0, 6);
  if (cands.length) {
    const url = (k) => { const [p, h] = k.split(":"); return p === "x" ? `https://x.com/${h}` : p === "instagram" ? `https://www.instagram.com/${h}/` : p === "tiktok" ? `https://www.tiktok.com/@${h}` : h; };
    const lines = cands.map(([k, c]) => `- **${k.replace(":", " @")}** (${url(k)}) — reposted, mentioned or tagged ${c.n} times by ${Object.entries(c.from).map(([f, n]) => (f === "topic search" ? `posts about the story found by our topic search (${n})` : `@${f} (${n})`)).join(", ")}${c.profile ? `; profile: ${c.profile.name || ""}, ${c.profile.followers || "?"} followers${c.profile.verified ? `, ${c.profile.verified} verified` : ""}` : ""}; stories: ${Object.keys(c.stories).join(", ")}`);
    const body = `${new Date(now).toISOString().slice(0, 16)}Z — network discovery: possible new sources\n\nAccounts the ones we follow keep pointing to. Editor: for each, check (WebSearch) that it really belongs to the organisation, public figure, official body or reporter it claims to be — e.g. linked from their official website, or identified as theirs by a news outlet. If verified, add it to content/network-sources.json under its story: {"type": "x|instagram|tiktok", "handle": "...", "who": "<Name> (<role>, on X)", "kind": "official|movement|journalist", "match": "<optional keywords>", "verified": "<how you verified it>"}. If not (fan page, parody, private person, unverifiable), add it to "_ignored" as {"<platform>:<handle>": "<reason>"}. Never add private individuals.\n\n${lines.join("\n")}`;
    const q = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Editor queue")][0].number // empty'`);
    writeFileSync("/tmp/net.md", body);
    if (q) { sh(`gh issue comment ${q} --body-file /tmp/net.md`); net.proposed = net.proposed || {}; for (const [k] of cands) net.proposed[k] = new Date(now).toISOString(); }
    console.log(`Network discovery: proposed ${cands.length} account(s).`);
  }
  writeFileSync(netPath, JSON.stringify(net, null, 1));
}
