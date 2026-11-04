/* Quality & freshness scorecard (no AI, no cost). Runs once an hour from the breaking-news workflow, so it is
   independent of the hourly desks it watches. It answers five questions and keeps ONE "Quality scorecard" issue:
     1. MISSING  — did 2+ established outlets report a development (last 24 h) that we have not published?
     2. BEHIND   — does any story have established-outlet headlines newer than our last update by 3+ hours?
     3. LATE     — how long after outlets first reported a development did we publish it? (target: 2 hours)
     4. ACCURACY — corrections and disproved reports this week, edits that failed, updates waiting for review,
                   open inspector findings, and whether every social/official report shows its track record.
     5. RUNNING  — has every part of the system run when it should (desks, scanner, editor, briefing, email)?
   Problems marked "Editor:" are fixed by the editor on its next run. When the scorecard turns from green to red it
   comments on the issue, which emails the founder. */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { headlinesSince } from "./signals.mjs";

const REPO = process.env.GITHUB_REPOSITORY;
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch { return ""; } };
const now = Date.now(), H = 36e5, DAY = 864e5;
const OUTLETS = JSON.parse(readFileSync("tools/outlets.json", "utf8")).domains;
const trusted = (d) => !!d && OUTLETS.some((o) => d === o || d.endsWith("." + o));
const OPINION = /^(opinion|comment|editorial|analysis|letters?|column|explainer|podcast|live|watch)\b|\b(opinion|editorial)\s*[:|]/i;
const STOP = new Set("the a an and or of to in on at for with from by as is are was were be been has have had will would after over amid into about against says said say new news latest live update updates more than this that their its his her who what when how why not but they them she he it we you our out up down off all one two three four five protest protests protesters student students government police".split(" "));
const words = (t) => new Set(String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 4 && !STOP.has(w)));
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n; };
const hhmm = (t) => new Date(t).toISOString().slice(5, 16).replace("T", " ") + "Z";

const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));
const red = [], amber = [], editor = [], green = [];
const latencies = [];

/* 1–3. Missing, behind, late — per story, from Google News headlines by established outlets */
for (const s of stories) {
  let heads = [];
  try { heads = (await headlinesSince(s)).filter((h) => trusted(h.domain) && !OPINION.test(h.title) && now - h.pub < DAY); }
  catch (e) { amber.push(`${s.slug}: could not read Google News (${String(e.message).slice(0, 50)})`); continue; }
  const items = [...s.events, ...(s.ground || [])].filter((e) => e.label !== "pending" && e.added).map((e) => ({ added: Date.parse(e.added), w: words(`${e.text || ""} ${e.shows || ""}`) }));
  // Group headlines that describe the same development (3+ shared distinctive words), across outlets.
  const clusters = [];
  for (const h of heads.sort((a, b) => a.pub - b.pub)) {
    const w = words(h.title);
    const c = clusters.find((c) => overlap(c.w, w) >= 3);
    if (c) { c.outlets.add(h.domain); c.heads.push(h); for (const x of w) c.w.add(x); }
    else clusters.push({ w, first: h.pub, outlets: new Set([h.domain]), heads: [h] });
  }
  for (const c of clusters.filter((c) => c.outlets.size >= 2)) {
    const match = items.filter((i) => overlap(i.w, c.w) >= 2 && i.added >= c.first - 12 * H).sort((a, b) => a.added - b.added)[0];
    if (match) { const lat = Math.max(0, (match.added - c.first) / H); latencies.push({ slug: s.slug, lat, title: c.heads[0].title }); }
    else if (now - c.first > 3 * H) {
      const line = `${s.slug}: possibly MISSING — ${c.outlets.size} established outlets reported "${c.heads[0].title}" (first at ${hhmm(c.first)}), and nothing on our timeline matches it`;
      editor.push(line); red.push(line);
    }
  }
  // Behind = a development reported by 2+ outlets (not a single, possibly re-dated, headline) newer than our last update.
  const newestHead = clusters.filter((c) => c.outlets.size >= 2).reduce((m, c) => Math.max(m, ...c.heads.map((h) => h.pub)), 0), ourLast = items.reduce((m, i) => Math.max(m, i.added), 0);
  if (newestHead && newestHead - ourLast > 3 * H && now - newestHead > H) amber.push(`${s.slug}: BEHIND — newest established-outlet headline ${hhmm(newestHead)}, our last update ${ourLast ? hhmm(ourLast) : "none"}`);
}
const lateOnes = latencies.filter((l) => l.lat > 3);
const med = latencies.length ? latencies.map((l) => l.lat).sort((a, b) => a - b)[Math.floor(latencies.length / 2)] : null;
if (lateOnes.length) amber.push(`LATE — ${lateOnes.length} of ${latencies.length} developments in the last 24 h were published 3+ hours after outlets first reported them: ${lateOnes.slice(0, 3).map((l) => `${l.slug} (${l.lat.toFixed(1)} h)`).join(", ")}`);
if (med !== null) (med <= 2 ? green : amber).push(`Speed: median ${med.toFixed(1)} h from first outlet report to our update (${latencies.length} developments, target 2 h)`);

/* 4. Accuracy */
const weekAgo = new Date(now - 7 * DAY).toISOString().slice(0, 10);
const corrections = stories.flatMap((s) => (s.corrections || []).filter((c) => (c.date || "") >= weekAgo).map(() => s.slug));
green.push(`Corrections this week: ${corrections.length}${corrections.length ? ` (${[...new Set(corrections)].join(", ")})` : ""}`);
if (corrections.length >= 5) amber.push(`ACCURACY — ${corrections.length} corrections in 7 days: check which desk is producing errors`);
const rec = existsSync("content/source-record.json") ? JSON.parse(readFileSync("content/source-record.json", "utf8")) : { items: [], accounts: {} };
const disproved = (rec.items || []).filter((i) => i.status === "disproved" && Date.parse(i.resolvedAt || 0) > now - 7 * DAY);
if (disproved.length) amber.push(`ACCURACY — ${disproved.length} social/official report(s) proved wrong this week (${[...new Set(disproved.map((d) => d.who))].join(", ")})`);
const waiting = stories.flatMap((s) => [...s.events, ...(s.ground || [])].filter((e) => e.desk === "backup" && e.added && now - Date.parse(e.added) > 10 * H).map(() => s.slug));
if (waiting.length) { amber.push(`REVIEW — ${waiting.length} automated update(s) waiting 10+ hours for the editor`); editor.push(`review the ${waiting.length} automated update(s) waiting 10+ hours (${[...new Set(waiting)].join(", ")})`); }
// Reputation alongside grade: every social/official report must be able to show its account's record.
const viaKeys = stories.flatMap((s) => [...s.events, ...(s.ground || [])].filter((e) => e.via).flatMap((e) => e.sources || []));
const tracked = new Set((rec.items || []).map((i) => i.key));
const untracked = viaKeys.filter((k) => !tracked.has(k));
if (untracked.length) amber.push(`REPUTATION — ${untracked.length} social/official report(s) are not in the track record, so readers can't see the account's record next to the grade`);
const issues = JSON.parse(sh(`gh api "repos/${REPO}/issues?state=open&per_page=100"`) || "[]");
const insp = issues.find((i) => /^Inspector findings/.test(i.title));
if (insp) { const open = (insp.body || "").match(/- \[ \]/g)?.length || 0; if (open) amber.push(`INSPECTOR — ${open} finding(s) not yet fixed (#${insp.number})`); }
const log2 = JSON.parse(sh(`gh api "repos/${REPO}/issues/2/comments?per_page=100&page=$(( ($(gh api repos/${REPO}/issues/2 --jq .comments) + 99) / 100 ))"`) || "[]");
const failedEdits = log2.filter((c) => /NOT applied/.test(c.body) && now - Date.parse(c.created_at) < DAY);
if (failedEdits.length) amber.push(`EDITS — ${failedEdits.length} editor edit file(s) failed to apply in the last 24 h`);

/* 5. Running: every part of the system ran when it should */
const lastRun = (wf, okOnly = true) => sh(`gh api "repos/${REPO}/actions/workflows/${wf}/runs?per_page=10" --jq '[.workflow_runs[] | select(${okOnly ? '.conclusion == "success"' : ".status == \"completed\""})][0].created_at // empty'`);
for (const [wf, name, hours] of [["freshness.yml", "Hourly news desks", 2], ["breaking.yml", "Breaking-news scanner", 1], ["briefing-audio.yml", "Audio briefing", 26], ["newsletter.yml", "Daily email", 26]]) {
  const t = lastRun(wf);
  if (!t) red.push(`STOPPED — ${name}: no successful run found`);
  else if (now - Date.parse(t) > hours * H) red.push(`STOPPED — ${name}: last successful run ${hhmm(Date.parse(t))} (expected within ${hours} h)`);
  else green.push(`${name}: ran ${Math.round((now - Date.parse(t)) / 6e4)} min ago`);
}
const lastEditor = log2.filter((c) => /— editor:/.test(c.body)).map((c) => Date.parse(c.created_at)).sort((a, b) => b - a)[0];
if (!lastEditor || now - lastEditor > 9 * H) red.push(`STOPPED — Editor (Sonnet): last run ${lastEditor ? hhmm(lastEditor) : "not found"} (expected every 4 hours, 8 at night)`);
else green.push(`Editor: last run ${Math.round((now - lastEditor) / 6e4)} min ago`);

/* Instagram official API: its token can expire. The desk records failures in the desk log; flag them here. */
try {
  const blog = issues.find((i) => i.title === "Backup desk log");
  if (blog) {
    const cs = JSON.parse(sh(`gh api "repos/${REPO}/issues/${blog.number}/comments?per_page=100&page=$(( ($(gh api repos/${REPO}/issues/${blog.number} --jq .comments) + 99) / 100 ))"`) || "[]");
    const bad = cs.filter((c) => now - Date.parse(c.created_at) < 6 * H && /graph: (Error validating access token|.*expired|.*Invalid OAuth)/i.test(c.body));
    if (bad.length) red.push("STOPPED — Instagram official API: the access token has expired or is invalid; renew IG_GRAPH_TOKEN");
  }
} catch {}

/* Report: one issue; comment (emails the founder) when it turns red */
const status = red.length ? "red" : amber.length ? "amber" : "green";
const title = `Quality scorecard: ${status === "green" ? "all good" : `${red.length} urgent, ${amber.length} to watch`}`;
const body = `Updated ${new Date(now).toISOString().slice(0, 16)}Z — checked every hour. Status: **${status.toUpperCase()}**\n\n` +
  (red.length ? `### Urgent\n${red.map((x) => `- [ ] ${x}`).join("\n")}\n\n` : "") +
  (amber.length ? `### To watch\n${amber.map((x) => `- ${x}`).join("\n")}\n\n` : "") +
  (editor.length ? `### For the editor\n${editor.map((x) => `- [ ] **Editor:** ${x}`).join("\n")}\n\n` : "") +
  `### Working\n${green.map((x) => `- ${x}`).join("\n")}`;
writeFileSync("/tmp/scorecard.md", body);
const open = issues.find((i) => /^Quality scorecard/.test(i.title));
if (!open) sh(`gh issue create --title "${title}" --body-file /tmp/scorecard.md`);
else {
  const was = /all good/.test(open.title) ? "green" : /^Quality scorecard: 0 urgent/.test(open.title) ? "amber" : "red";
  sh(`gh issue edit ${open.number} --title "${title}" --body-file /tmp/scorecard.md`);
  if (status === "red" && was !== "red") { writeFileSync("/tmp/sc-alert.md", `Needs attention:\n\n${red.map((x) => `- ${x}`).join("\n")}`); sh(`gh issue comment ${open.number} --body-file /tmp/sc-alert.md`); }
  if (status !== "red" && was === "red") sh(`gh issue comment ${open.number} --body "Back to ${status}: the urgent problems are resolved."`);
}
console.log(`${title}\n${body}`);
