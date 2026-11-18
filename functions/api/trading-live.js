// /api/trading-live — gold price + open trades right now, for the Live panel (signed-in only).
import { fromCopier } from "../_lib/copier.js";

export async function onRequestGet({ env, request }) {
  const live = new URL(request.url).searchParams.get("account") === "live";
  return fromCopier(env, live ? "/api/live?account=live" : "/api/live", 10000);
}
