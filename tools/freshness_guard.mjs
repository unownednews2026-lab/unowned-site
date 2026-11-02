/* Freshness guard (no AI, no cost). Runs every hour inside the "Freshness check" workflow and never fails the run.
   It checks every place our content appears, repairs what a machine can repair, and lists anything that needs
   the editor in ONE "Freshness guard" issue (which closes itself when everything is current).

   Checked every hour:
   1. Today's audio briefing: script written, audio recorded from the CURRENT script, video made for today,
      and the audio actually served by unownednews.com.            Repair: re-run the briefing recorder.
   2. Podcast feed (Spotify, Apple) carries today's episode.          Repair: same as 1 (it rebuilds with the site).
   3. Daily email went out today.                                     Repair: re-run the email job once.
   4. The hourly newsdesk is running (every story checked in the last 6 hours).
   5. Stories: no update waits more than 10 hours for the editor; no scheduled event is left "pending" after it
      happened; no "due on <date>"-style wording about dates that have passed; no story silent for 4+ days
      without anything scheduled.                                     Repair: the editor (it reads this issue). */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const SITE = "https://unownednews.com";
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch (e) { return ""; } };
const now = new Date(), hour = now.getUTCHours(), today = now.toISOString().slice(0, 10);
const DAY = 864e5;
const problems = [], repaired = [], forEditor = [];
const head = async (url) => { try { return (await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(20000) })).status; } catch { return 0; } };
const text = async (url) => { try { const r = await fetch(url, { signal: AbortSignal.timeout(20000) }); return r.ok ? await r.text() : ""; } catch { return ""; } };
const recentRun = (wf, minutes) => sh(`gh api "repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/${wf}/runs?per_page=5" --jq '[.workflow_runs[] | select(.created_at > "${new Date(Date.now() - minutes * 6e4).toISOString()}")] | length'`) !== "0";
const rerun = (wf, why) => {
  if (recentRun(wf, 90)) { problems.push(`${why} (a re-run is already under way)`); return; }
  sh(`gh workflow run ${wf}`); repaired.push(`${why}: re-ran ${wf}`);
};

/* 1–2. Briefing, video, live audio, podcast */
if (hour >= 8) {
  const json = `content/briefings/${today}.json`;
  const issues = [];
  if (!existsSync(json)) issues.push("today's briefing script is missing");
  else {
    const b = JSON.parse(readFileSync(json, "utf8"));
    const sha = createHash("sha256").update(JSON.stringify(b.script)).digest("hex").slice(0, 16);
    if (!existsSync(`static/briefings/${today}.mp3`)) issues.push("today's audio is missing");
    else if (existsSync(`static/briefings/${today}.sha`) && readFileSync(`static/briefings/${today}.sha`, "utf8").trim() !== sha) issues.push("today's audio was recorded from an older version of the script");
    const v = existsSync("static/briefings/latest-video.json") ? JSON.parse(readFileSync("static/briefings/latest-video.json", "utf8")) : {};
    if (v.date !== today) issues.push(`the briefing video is from ${v.date || "an unknown date"}, not today`);
  }
  if (issues.length) rerun("briefing-audio.yml", `Briefing: ${issues.join("; ")}`);
  else if (hour >= 9) {
    const st = await head(`${SITE}/briefings/${today}.mp3`);
    if (st !== 200) problems.push(`Today's audio is in the repository but unownednews.com does not serve it (HTTP ${st || "no answer"}): the site may not be publishing`);
    const feed = await text(`${SITE}/podcast.xml`);
    if (feed && !feed.includes(`unowned-briefing-${today}`)) problems.push("The podcast feed (Spotify, Apple Podcasts) does not have today's episode yet: the site may not be publishing");
  }
}

/* 3. Daily email */
if (hour >= 11) {
  const ok = sh(`gh api "repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/newsletter.yml/runs?per_page=10" --jq '[.workflow_runs[] | select(.created_at >= "${today}T00:00:00Z" and .conclusion == "success")] | length'`);
  if (ok === "0") rerun("newsletter.yml", "Daily email: no successful send today");
}

/* 4–5. Newsdesk and stories */
const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const year = now.getUTCFullYear();
for (const s of stories) {
  const checked = s.checkedAt || s.updatedAt;
  if (checked && Date.now() - Date.parse(checked) > 6 * 36e5) problems.push(`${s.slug}: the hourly newsdesk has not checked this story for ${Math.round((Date.now() - Date.parse(checked)) / 36e5)} hours`);
  for (const e of s.events) {
    if (e.desk === "backup" && e.added && Date.now() - Date.parse(e.added) > 10 * 36e5) forEditor.push(`${s.slug}: an automated update from ${e.added.slice(0, 16)}Z is still waiting for the editor's review`);
    if (e.label === "pending" && Date.parse(e.date + "T23:59:59Z") < Date.now() - DAY) forEditor.push(`${s.slug}: the scheduled item dated ${e.date} has passed — report what happened and update it ("${e.text.slice(0, 80)}…")`);
  }
  const newest = s.events.filter((e) => e.label !== "pending").reduce((m, e) => (e.date > m ? e.date : m), "");
  const soon = s.events.some((e) => e.label === "pending" && Date.parse(e.date) >= Date.now() - DAY && Date.parse(e.date) <= Date.now() + 10 * DAY);
  if (newest && Date.now() - Date.parse(newest + "T23:59:59Z") > 4 * DAY && !soon) forEditor.push(`${s.slug}: no new development since ${newest} — search for news; if there is none, the site and briefing already say so`);
  // Wording that looks ahead to a date that has passed ("due on November 4", "set for October 29").
  const prose = [s.dek, ...(s.summary || []), ...(s.gaps || []), ...(s.claims || []).map((c) => c.status || "")].join(" \n ");
  const re = /\b(due|scheduled|expected|planned|set|will|to be held|upcoming|is to)\b[^.\n]{0,80}?\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})\b/gi;
  for (const m of prose.matchAll(re)) {
    const d = new Date(Date.UTC(year, MONTHS.indexOf(m[2].toLowerCase()), +m[3]));
    if (d > now) continue;                                   // still ahead: fine
    if (Date.now() - d.getTime() > 1.5 * DAY && Date.now() - d.getTime() < 120 * DAY) forEditor.push(`${s.slug}: wording looks ahead to a date that has passed: "…${m[0].slice(0, 100)}…" — update it with what happened`);
  }
}

/* Report: one issue, closes itself when everything is current. */
const all = [...problems.map((p) => `- [ ] ${p}`), ...forEditor.map((p) => `- [ ] **Editor:** ${p}`)];
const open = sh(`gh api "repos/${process.env.GITHUB_REPOSITORY}/issues?state=open&per_page=100" --jq '[.[] | select(.title|startswith("Freshness guard"))][0].number // empty'`);
for (const r of repaired) console.log(`::notice::Freshness guard repaired: ${r}`);
if (all.length) {
  const body = `Updated ${now.toISOString().slice(0, 16)}Z. Everything below is checked every hour; this issue closes itself when all of it is current.\n\n${all.join("\n")}${repaired.length ? `\n\nAutomatic repairs this hour:\n${repaired.map((r) => `- ${r}`).join("\n")}` : ""}`;
  writeFileSync("/tmp/guard.md", body);
  if (open) sh(`gh issue edit ${open} --body-file /tmp/guard.md --title "Freshness guard: ${all.length} item(s)"`);
  else sh(`gh issue create --title "Freshness guard: ${all.length} item(s)" --body-file /tmp/guard.md`);
  console.log(`Freshness guard: ${all.length} item(s)\n${all.join("\n")}`);
} else {
  if (open) sh(`gh issue close ${open} --comment "Everything is current."`);
  console.log("Freshness guard: everything is current.");
}
