/* Early warning (no AI, no cost): if any story has fresh headlines from established outlets but no update for 12+ hours,
   open ONE "Story falling behind" issue (GitHub emails the owner once). It closes itself when every story has caught up.
   Runs inside the hourly "Freshness check" workflow. Never fails the run. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { headlinesSince } from "./signals.mjs";

const REPO = process.env.GITHUB_REPOSITORY;
const OUTLETS = JSON.parse(readFileSync("tools/outlets.json", "utf8")).domains;
const trusted = (h) => OUTLETS.some((d) => h === d || h.endsWith("." + d));
const OPINION = /^(opinion|comment|editorial|analysis|letters?|column|explainer|podcast)\b|\b(opinion|editorial)\s*[:|]/i;
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const behind = [];
for (const f of readdirSync("content/stories").filter((x) => x.endsWith(".json"))) {
  const s = JSON.parse(readFileSync(`content/stories/${f}`, "utf8"));
  const age = (Date.now() - Date.parse(s.updatedAt || s.updated)) / 36e5;
  if (age < 12) continue;
  const h = (await headlinesSince(s).catch(() => [])).filter((x) => x.domain && trusted(x.domain) && !OPINION.test(x.title));
  if (h.length) behind.push(`- **${s.title}**: last update ${Math.round(age)} hours ago; ${h.length} newer headline(s) from established outlets, e.g. "${h[0].title}"`);
}
try {
  const open = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title|startswith("Story falling behind"))][0].number // empty'`);
  if (behind.length && !open) {
    writeFileSync("/tmp/behind.md", `These stories have news from established outlets but no update for 12+ hours:\n\n${behind.join("\n")}\n\nThe backup desk adds a short attributed item after 20 hours if nothing else gets through. This issue closes itself when every story has caught up.`);
    sh(`gh issue create --title "Story falling behind: ${behind.length} story(ies)" --body-file /tmp/behind.md`);
    console.log(`::warning::${behind.length} story(ies) falling behind`);
  } else if (!behind.length && open) {
    sh(`gh issue close ${open} --comment "All stories have caught up."`);
  }
  console.log(behind.length ? behind.join("\n") : "All stories are up to date with established-outlet headlines.");
} catch (e) { console.log(`lag alert skipped: ${String(e.message).slice(0, 200)}`); }
