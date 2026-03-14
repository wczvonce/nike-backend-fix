/**
 * Run: node scripts/test-support-matrix.js
 * Ensures claimed compare support is explicit and conservative.
 */
import { getAllMarketHandlers, getCompareEnabledMarketTypes } from "../src/markets/handlers.js";

let failed = 0;
function ok(cond, msg) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("OK:", msg);
  }
}

const handlers = getAllMarketHandlers();
const enabled = getCompareEnabledMarketTypes();

ok(handlers.length >= 7, "handlers registry contains planned market families");
ok(enabled.has("double_chance"), "double_chance compare enabled");
ok(enabled.has("match_winner_2way"), "match_winner_2way compare enabled");
ok(!enabled.has("european_handicap_2way"), "european handicap compare disabled");
ok(!enabled.has("over_under_2way"), "over_under compare disabled until Nike emits equivalent markets");
ok(!enabled.has("asian_handicap_2way"), "asian handicap compare disabled until Nike emits equivalent markets");
ok(!enabled.has("draw_no_bet_2way"), "draw_no_bet compare disabled until Nike emits equivalent markets");
ok(!enabled.has("both_teams_to_score"), "BTTS compare disabled until Nike emits equivalent markets");

if (failed > 0) {
  console.error("\nTotal failures:", failed);
  process.exit(1);
}
console.log("\nAll checks passed.");

