/* Applies small edit files from content/edits/*.json to the story files, so the editor never has to re-send a whole
   (large) story file. Runs in GitHub Actions when an edit file lands on main. Each edit file:
   {
     "story": "france-school-protests",            // story slug
     "note": "Freshness guard: past-tense wording",   // why (goes in the commit message)
     "ops": [
       {"op": "replace", "find": "exact old text", "with": "new text"},          // text inside any string field; must match exactly once
       {"op": "add_event", "event": {"date": "...", "phase": "...", "label": "...", "added": "...", "text": "...", "sources": ["key"]}},
       {"op": "remove_event", "find": "exact text that appears in that event's text"},
       {"op": "add_source", "key": "afpNov3", "name": "Outlet (AFP)", "url": "https://..."},
       {"op": "set", "field": "updatedAt", "value": "2026-11-03T12:00:00Z"},    // top-level field (gaps, summary, dek, status, updated, updatedAt)
       {"op": "add_gap", "text": "..."},
       {"op": "add_correction", "date": "2026-11-03", "text": "..."}
     ]
   }
   All edits in a file apply together or not at all. The story must still parse and the site build (with its label check)
   must pass, or nothing is changed and the reason is posted to the "Newsdesk run log" issue. Processed edit files are deleted. */
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const sh = (c) => execSync(c, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const dir = "content/edits";
const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).sort() : [];
const log = [];
for (const f of files) {
  const path = `${dir}/${f}`;
  let edit;
  try { edit = JSON.parse(readFileSync(path, "utf8")); } catch (e) { log.push(`${f}: not valid JSON (${e.message.slice(0, 80)})`); unlinkSync(path); continue; }
  const storyPath = `content/stories/${String(edit.story || "").replace(/[^a-z0-9-]/g, "")}.json`;
  if (!existsSync(storyPath)) { log.push(`${f}: unknown story "${edit.story}"`); unlinkSync(path); continue; }
  const before = readFileSync(storyPath, "utf8");
  try {
    let s = JSON.parse(before);
    for (const op of edit.ops || []) {
      if (op.op === "replace") {
        let json = JSON.stringify(s);
        const find = JSON.stringify(String(op.find)).slice(1, -1), repl = JSON.stringify(String(op.with)).slice(1, -1);
        const n = json.split(find).length - 1;
        if (n !== 1) throw new Error(`replace: text found ${n} times (must be exactly once): "${String(op.find).slice(0, 60)}"`);
        json = json.replace(find, () => repl);
        s = JSON.parse(json);
      } else if (op.op === "add_event") {
        const e = op.event || {};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date || "") || !e.text || !e.label || !Array.isArray(e.sources)) throw new Error("add_event: needs date, label, text and sources");
        if (e.added && Date.parse(e.added) > Date.now() + 5 * 6e4) throw new Error("add_event: 'added' is in the future");
        e.phase = e.phase || s.phases[s.phases.length - 1].id;
        e.added = e.added || new Date().toISOString().slice(0, 19) + "Z";
        for (const k of e.sources) if (!s.sources[k]) throw new Error(`add_event: unknown source key ${k} (add_source first)`);
        s.events.push(e);
      } else if (op.op === "remove_event") {
        const idx = s.events.map((e, i) => (e.text.includes(op.find) ? i : -1)).filter((i) => i >= 0);
        if (idx.length !== 1) throw new Error(`remove_event: matched ${idx.length} events (must be exactly one)`);
        s.events.splice(idx[0], 1);
      } else if (op.op === "add_source") {
        if (!op.key || !op.name || !/^https?:\/\//.test(op.url || "")) throw new Error("add_source: needs key, name and url");
        s.sources[op.key] = [op.name, op.url];
        const g = s.sourceGroups[s.sourceGroups.length - 1];
        const keys = Array.isArray(g) ? g[1] : g.keys || g.sources;
        if (!keys.includes(op.key)) keys.push(op.key);
      } else if (op.op === "set") {
        if (!["gaps", "summary", "dek", "status", "updated", "updatedAt", "checkedAt"].includes(op.field)) throw new Error(`set: field ${op.field} not allowed`);
        s[op.field] = op.value;
      } else if (op.op === "add_gap") {
        s.gaps = [...(s.gaps || []), String(op.text)];
      } else if (op.op === "add_correction") {
        s.corrections = [...(s.corrections || []), { date: op.date, text: op.text }];
      } else throw new Error(`unknown op ${op.op}`);
    }
    s.events.sort((a, b) => a.date.localeCompare(b.date));
    writeFileSync(storyPath, JSON.stringify(s, null, 2));
    sh(`node tools/fmt.js ${storyPath}`);
    const out = sh("node build.mjs 2>&1");
    if (/need attention/.test(out)) throw new Error("the label check failed after the edit");
    log.push(`${f}: applied to ${edit.story} (${(edit.ops || []).length} change(s)) — ${edit.note || ""}`);
  } catch (e) {
    writeFileSync(storyPath, before);
    log.push(`${f}: NOT applied to ${edit.story} — ${String(e.message).slice(0, 200)}`);
  }
  unlinkSync(path);
}
console.log(log.join("\n") || "no edit files");
writeFileSync("/tmp/edits.log", log.join("\n"));
