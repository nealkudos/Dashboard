// /api/trading-health — is the trading bot running? Telegram, MT5 and each background job (signed-in only).
import { fromCopier } from "../_lib/copier.js";

export async function onRequestGet({ env }) {
  return fromCopier(env, "/api/health", 10000);
}
