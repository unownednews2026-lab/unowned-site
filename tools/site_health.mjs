/* Site health (no AI, no cost). Runs inside the hourly "Freshness check" workflow and never fails the run.
   1. Live site: is unownednews.com actually showing what's in the repository? If publishing to Cloudflare stalls,
      the repository keeps updating but readers see old news. Opens ONE "Site alert" issue; closes it when fixed.
   2. Broken sources (once a day, 05:xx UTC): checks every source link added in the last 30 days, plus a rotating
      slice of older ones. Links that are gone (404/410) or dead go to ONE "Broken source links" issue for the editor. */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const REPO = process.env.GITHUB_REPOSITORY;
const SITE = "https://unownednews.com";
const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));
const issue = (prefix) => sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title|startswith("${prefix}"))][0].number // empty'`);

/* 1. Is the live site current? Compare the time of the site's last build (dist/version.json, written by every build)
   with the newest commit: if a commit is more than 90 minutes old and the site still hasn't been rebuilt since, publishing
   is stuck. (Comparing news items was wrong: the live feed deliberately leaves out older-dated items.) */
try {
  const lastCommit = sh("git log -1 --format=%cI");
  let built = "", err = "";
  for (let i = 0; i < 2 && !built; i++) {
    try {
      const r = await fetch(`${SITE}/version.json?t=${Date.now()}`, { headers: { "User-Agent": "unowned-health" }, signal: AbortSignal.timeout(20000) });
      if (r.status === 404) { built = "unknown"; break; }
      if (!r.ok) { err = `HTTP ${r.status}`; continue; }
      built = (await r.json()).built || "";
    } catch (e) { err = String(e.message || e).slice(0, 80); }
  }
  const behindMin = built && built !== "unknown" ? (Date.parse(lastCommit) - Date.parse(built)) / 6e4 : 0;
  const stale = built && built !== "unknown" && behindMin > 0 && Date.now() - Date.parse(lastCommit) > 90 * 6e4;
  const problem = !built ? `the live site could not be read (${err})` : stale ? `the live site was last built at ${built}, but the newest change (${lastCommit}) is more than 90 minutes old and still not live` : "";
  const open = issue("Site alert");
  if (problem && !open) {
    writeFileSync("/tmp/site.md", `Readers may not be seeing the latest news: ${problem}.\n\nLikely cause: a Cloudflare Pages deployment failed or is stuck. Check the latest deployment of "unowned-site" in Cloudflare (Workers & Pages) and retry it. This issue closes itself once the live site catches up.`);
    sh(`gh issue create --title "Site alert: live site not updating" --body-file /tmp/site.md`);
    console.log(`::warning::Site alert: ${problem}`);
  } else if (!problem && open) sh(`gh issue close ${open} --comment "The live site is current."`);
  console.log(problem ? `Site alert: ${problem}` : `Live site is current (last built ${built}).`);
} catch (e) { console.log(`live-site check skipped: ${String(e.message).slice(0, 200)}`); }

/* 2. Broken source links, once a day. */
if (new Date().getUTCHours() === 5 || process.env.CHECK_LINKS) {
  try {
    const since = new Date(Date.now() - 30 * 864e5).toISOString();
    const all = [];
    for (const s of stories) {
      const recent = new Set(s.events.filter((e) => (e.added || "") >= since).flatMap((e) => e.sources || []));
      for (const [k, v] of Object.entries(s.sources || {})) {
        const url = Array.isArray(v) ? v[1] : v?.url;
        if (url && /^https?:/.test(url)) all.push({ slug: s.slug, k, url, recent: recent.has(k) });
      }
    }
    const day = Math.floor(Date.now() / 864e5);
    const pick = all.filter((x, i) => x.recent || i % 14 === day % 14);         // every recent link, and 1/14 of the rest each day
    const broken = [];
    for (let i = 0; i < pick.length; i += 8) {
      await Promise.all(pick.slice(i, i + 8).map(async (x) => {
        let status = 0;
        for (const method of ["HEAD", "GET"]) {
          try {
            const r = await fetch(x.url, { method, redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (link check)" }, signal: AbortSignal.timeout(15000) });
            status = r.status; if (status < 400 || ![404, 405, 410].includes(status)) break;
          } catch { status = -1; }
        }
        if (status === 404 || status === 410) broken.push(`- \`${x.slug}\` source \`${x.k}\` (${status}): ${x.url}`);
      }));
    }
    const open = issue("Broken source links");
    if (broken.length) {
      const body = `These source links no longer load (gone or not found). Editor: find the same report at its new address, an archived copy (web.archive.org), or an equivalent report from an established outlet; update the source, or relabel the item if nothing else supports it.\n\n${broken.join("\n")}`;
      writeFileSync("/tmp/links.md", body);
      if (open) sh(`gh issue comment ${open} --body-file /tmp/links.md`);
      else sh(`gh issue create --title "Broken source links: ${broken.length}" --body-file /tmp/links.md`);
    }
    console.log(`Checked ${pick.length} source link(s): ${broken.length} broken.`);
  } catch (e) { console.log(`link check skipped: ${String(e.message).slice(0, 200)}`); }
}
