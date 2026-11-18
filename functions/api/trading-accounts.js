// /api/trading-accounts — which MT5 accounts the bot has: the demo one, and the real-money one if it's set up.
import { fromCopier } from "../_lib/copier.js";

export async function onRequestGet({ env }) {
  return fromCopier(env, "/api/accounts", 10000);
}
