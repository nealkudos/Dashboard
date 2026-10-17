// /api/trading-live — gold price + open trades right now, for the Live panel (signed-in only).
import { fromCopier } from "../_lib/copier.js";

export async function onRequestGet({ env }) {
  return fromCopier(env, "/api/live", 10000);
}
