# Unowned runbook: what stops the news, and what to do

Everything that keeps the site fresh depends on three things. Each can stop on its own. The outside watchdog
(`tools/watchdog-worker.js`, on Cloudflare) alerts the phone when any of them does.

| What stopped | How you know | Fix |
|---|---|---|
| **GitHub Actions** (billing, spending limit, minutes) | Workflow runs fail with "not started because recent account payments have failed or your spending limit needs to be increased"; watchdog says no desk has checked for 4+ hours | Public repositories get unlimited free minutes. Otherwise GitHub > Settings > Billing and plans: fix the payment method or raise the Actions spending limit |
| **Claude plan usage limit** (editor, inspector, briefing-script tasks) | `list_triggers` shows last run `USAGE_LIMIT_REACHED`; scorecard says "STOPPED: Editor"; unreviewed items wait 10+ hours | Wait for the reset. The free desk keeps publishing meanwhile (headline safety net), the editor catches up on its next run. Keep builder sessions short near the limit: they draw on the same plan |
| **Free AI providers** (Gemini, Groq, Cloudflare) rate-limited | Backup desk log shows 429 for every provider; articles "could not be read" | Usually clears within the hour. The safety net still publishes attributed headline items from two outlets |
| **Instagram Graph token** (expires after 60 days) | Scorecard "Graph token failure" alert | Graph API Explorer > extend token > update the `IG_GRAPH_TOKEN` secret |

## Rules the desk follows (tested in `test/`)
- The stalest story runs first, so a busy story can never starve quiet ones.
- A story with no new item for 12 hours gets an attributed headline item if two different established outlets cover it. The editor rewrites these when it runs.
- Review packets keep short excerpts only (this repository is public).

## Never
- Switch off the headline safety net (`HEADLINE_FALLBACK=0`) unless something else covers stories when the editor is down.
- Put keys, reader details or private names into issues, commits or packets.
