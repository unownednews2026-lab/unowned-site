/* Breaking-news scanner (no AI, no cost). Runs every 15 minutes.
   1. Our stories: when established outlets publish NEW headlines about a story we track (2+ outlets in the last
      3 hours, or 1 outlet with a serious development), it starts the full news desk right away (fact-checks,
      strict grades, publishing) instead of waiting for the hourly run.
   2. The briefing: when a new development has been published since today's briefing was written, it re-records
      the briefing (at most every 45 minutes), so the audio carries breaking news within the hour.
   3. New events: it watches for protests and movements breaking anywhere in the world. A country we don't cover yet
      that 3+ established outlets report on within 6 hours goes to the "Editor queue" as a possible new story.
   State lives in .breaking-state.json, kept between runs by the Actions cache (no commits). */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { headlinesSince } from "./signals.mjs";

const REPO = process.env.GITHUB_REPOSITORY;
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim(); } catch (e) { return ""; } };
const STATE = ".breaking-state.json";
const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
state.titles = state.titles || {}; state.flagged = state.flagged || {}; state.runs = state.runs || {};
const now = Date.now(), H = 36e5;
const unent = (s) => String(s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const outlets = JSON.parse(readFileSync("tools/outlets.json", "utf8")).domains || [];
const established = (d) => !!d && outlets.some((o) => d === o || d.endsWith("." + o));
const SERIOUS = /\b(killed|dead|deaths?|died|shot|shooting|clash\w*|curfew|state of emergency|martial law|arrest\w*|detain\w*|crackdown|banned?|resign\w*|ousted|dissolv\w*|riot\w*|tear gas|stormed|violence|general strike|verdict|ruling|internet (?:shutdown|blackout)|tués?|morts?|arrestat\w*|morti|scontri|Festnahm\w*|Tote)\b/i;
const log = [];

const stories = readdirSync("content/stories").filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(`content/stories/${f}`, "utf8")));
const busy = (wf, minutes) => sh(`gh api "repos/${REPO}/actions/workflows/${wf}/runs?per_page=5" --jq '[.workflow_runs[] | select(.status != "completed" or .created_at > "${new Date(now - minutes * 6e4).toISOString()}")] | length'`) !== "0";

/* 1. Breaking developments on our stories */
const breaking = [];
for (const s of stories) {
  let fresh = [];
  try { fresh = await headlinesSince(s); } catch (e) { log.push(`${s.slug}: Google News unavailable (${String(e.message).slice(0, 60)})`); continue; }
  const recent = fresh.filter((h) => h.pub > now - 3 * H && !state.titles[h.title]);
  const est = recent.filter((h) => established(h.domain));
  const outletsN = new Set(est.map((h) => h.domain)).size;
  if (outletsN >= 2 || (outletsN >= 1 && est.some((h) => SERIOUS.test(h.title)))) {
    breaking.push({ s, heads: est.slice(0, 4) });
    for (const h of recent) state.titles[h.title] = now;
  }
}
if (breaking.length) {
  const what = breaking.map((b) => `**${b.s.slug}**: ${b.heads.map((h) => `${h.title} (${h.outlet || h.domain}, ${new Date(h.pub).toISOString().slice(11, 16)}Z)`).join("; ")}`);
  if (!busy("freshness.yml", 12)) { sh(`gh api -X POST repos/${REPO}/actions/workflows/freshness.yml/dispatches -f ref=main`); log.push(`Breaking — news desk started now:\n- ${what.join("\n- ")}`); }
  else log.push(`Breaking — the news desk is already running or just ran; it will pick these up:\n- ${what.join("\n- ")}`);
}

/* 2. Briefing: re-record as soon as new developments are published */
try {
  const today = new Date(now).toISOString().slice(0, 10), path = `content/briefings/${today}.json`;
  if (existsSync(path) && new Date(now).getUTCHours() >= 8) {
    const gen = Date.parse(JSON.parse(readFileSync(path, "utf8")).generated || 0);
    const cutoff = new Date(now - 2 * 864e5).toISOString().slice(0, 10);
    const newer = stories.filter((s) => [...s.events, ...(s.ground || [])].some((e) => e.label !== "pending" && e.date >= cutoff && e.added && Date.parse(e.added) > gen));
    if (newer.length && now - gen > 45 * 6e4 && !busy("briefing-audio.yml", 40)) {
      sh(`gh api -X POST repos/${REPO}/actions/workflows/briefing-audio.yml/dispatches -f ref=main`);
      log.push(`Briefing re-recording with new developments in: ${newer.map((s) => s.region || s.slug).join(", ")}`);
    }
  }
} catch (e) { log.push(`briefing check skipped: ${String(e.message).slice(0, 80)}`); }

/* 3. New events anywhere: protests and movements in countries we don't cover yet */
const COUNTRIES = "Afghanistan,Albania,Algeria,Angola,Argentina,Armenia,Australia,Austria,Azerbaijan,Bangladesh,Belarus,Belgium,Benin,Bolivia,Bosnia,Brazil,Bulgaria,Burkina Faso,Cambodia,Cameroon,Canada,Chad,Chile,China,Colombia,Congo,Costa Rica,Croatia,Cuba,Czech,Denmark,Dominican Republic,Ecuador,Egypt,El Salvador,Ethiopia,Fiji,Finland,France,Gabon,Georgia,Germany,Ghana,Greece,Guatemala,Guinea,Haiti,Honduras,Hong Kong,Hungary,Iceland,India,Indonesia,Iran,Iraq,Ireland,Israel,Italy,Ivory Coast,Jamaica,Japan,Jordan,Kazakhstan,Kenya,Kosovo,Kyrgyzstan,Laos,Latvia,Lebanon,Liberia,Libya,Lithuania,Madagascar,Malawi,Malaysia,Maldives,Mali,Mexico,Moldova,Mongolia,Montenegro,Morocco,Mozambique,Myanmar,Namibia,Nepal,Netherlands,New Zealand,Nicaragua,Niger,Nigeria,North Macedonia,Norway,Pakistan,Palestine,Panama,Paraguay,Peru,Philippines,Poland,Portugal,Romania,Russia,Rwanda,Saudi Arabia,Senegal,Serbia,Sierra Leone,Singapore,Slovakia,Slovenia,Somalia,South Africa,South Korea,Spain,Sri Lanka,Sudan,Sweden,Switzerland,Syria,Taiwan,Tajikistan,Tanzania,Thailand,Togo,Tunisia,Turkey,Uganda,Ukraine,United Kingdom,Britain,United States,Uruguay,Uzbekistan,Venezuela,Vietnam,Yemen,Zambia,Zimbabwe".split(",");
const ALIAS = { "U.S.": "United States", US: "United States", UK: "United Kingdom", Britain: "United Kingdom", "Türkiye": "Turkey", Czechia: "Czech", Kenyan: "Kenya", Nepali: "Nepal", Nepalese: "Nepal", Indonesian: "Indonesia", Peruvian: "Peru", Moroccan: "Morocco", Malagasy: "Madagascar", Filipino: "Philippines", Serbian: "Serbia", Georgian: "Georgia", Turkish: "Turkey", Mexican: "Mexico", Bangladeshi: "Bangladesh", Pakistani: "Pakistan", Nigerian: "Nigeria", Iranian: "Iran", Spanish: "Spain", Greek: "Greece", Bulgarian: "Bulgaria", Slovak: "Slovakia", Hungarian: "Hungary", Togolese: "Togo", Paraguayan: "Paraguay", Mongolian: "Mongolia", Argentine: "Argentina", Bolivian: "Bolivia", Ecuadorian: "Ecuador", Colombian: "Colombia", Venezuelan: "Venezuela", Thai: "Thailand", Korean: "South Korea" };
const covered = new Set(stories.map((s) => s.region).filter(Boolean));
const QUERIES = ['"Gen Z" protest', "student protests", "youth protesters", "anti-government protests", "mass protests police", "general strike protesters", "protest movement crackdown"];
const byCountry = {};
for (const q of QUERIES) {
  try {
    const xml = await (await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(q + " when:6h")}&hl=en-US&gl=US&ceid=US:en`, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(20000) })).text();
    for (const it of xml.split("<item>").slice(1)) {
      const title = unent((it.match(/<title>([\s\S]*?)<\/title>/) || [])[1]).replace(/\s+-\s+[^-]+$/, "");
      const link = unent((it.match(/<link>([\s\S]*?)<\/link>/) || [])[1]);
      const src = it.match(/<source url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/) || [];
      let domain = ""; try { domain = new URL(src[1] || "").hostname.replace(/^www\./, ""); } catch {}
      if (!established(domain)) continue;
      const names = [...COUNTRIES, ...Object.keys(ALIAS)].filter((c) => new RegExp(`(^|[^\\w])${c.replace(/[.]/g, "\\.")}(?=[^\\w]|$)`).test(title));
      for (const n of new Set(names.map((c) => ALIAS[c] || c))) {
        if (covered.has(n)) continue;
        (byCountry[n] = byCountry[n] || {})[domain] = byCountry[n][domain] || { title, link, outlet: unent(src[2] || domain) };
      }
    }
  } catch (e) { log.push(`discovery query "${q}" failed (${String(e.message).slice(0, 40)})`); }
}
const flags = [];
for (const [country, by] of Object.entries(byCountry)) {
  if (Object.keys(by).length < 3) continue;
  if (state.flagged[country] && now - state.flagged[country] < 24 * H) continue;
  state.flagged[country] = now;
  flags.push(`**Possible new story: ${country}** — ${Object.keys(by).length} established outlets in the last 6 hours:\n${Object.values(by).slice(0, 5).map((h) => `  - ${h.title} (${h.outlet}) ${h.link}`).join("\n")}`);
}
if (flags.length) {
  const q = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Editor queue")][0].number // empty'`);
  writeFileSync("/tmp/flags.md", `${new Date(now).toISOString().slice(0, 16)}Z — breaking-news scanner\n\nEvents we don't cover yet. Editor: decide whether each is a people-led movement or protest within our mission and is still developing; if so, verify with 2 independent outlets and open a new story; if not, reply "not a new story: <reason>".\n\n${flags.join("\n\n")}`);
  if (q) sh(`gh issue comment ${q} --body-file /tmp/flags.md`);
  log.push(`Flagged to the editor as possible new stories: ${flags.length}`);
}

/* Remember headlines for 3 days, flags for 2 */
for (const [k, t] of Object.entries(state.titles)) if (now - t > 3 * 864e5) delete state.titles[k];
for (const [k, t] of Object.entries(state.flagged)) if (now - t > 2 * 864e5) delete state.flagged[k];
writeFileSync(STATE, JSON.stringify(state));
if (log.length) {
  const n = sh(`gh api "repos/${REPO}/issues?state=open&per_page=100" --jq '[.[] | select(.title=="Backup desk log")][0].number // empty'`);
  writeFileSync("/tmp/breaking.md", `${new Date(now).toISOString().slice(0, 16)}Z — breaking-news scanner\n\n${log.join("\n\n")}`);
  if (n && (breaking.length || flags.length)) sh(`gh issue comment ${n} --body-file /tmp/breaking.md`);
}
console.log(log.join("\n") || "Breaking-news scanner: nothing new.");
