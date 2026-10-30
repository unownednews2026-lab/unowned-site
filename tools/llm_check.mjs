/* Health check of every free AI provider: asks each one to reply "OK" and prints what happened (as notes on the run page). */
import { checkAll } from "./llm.mjs";
for (const [name, result] of await checkAll()) console.log(`::notice::AI check — ${name}: ${result}`);
