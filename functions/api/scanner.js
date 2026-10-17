// /api/scanner — chart scanner state (trend per timeframe, setups, signals) from the bot (signed-in only).
import { fromCopier } from "../_lib/copier.js";

export async function onRequestGet({ env }) {
  return fromCopier(env, "/api/scanner", 60000);
}
