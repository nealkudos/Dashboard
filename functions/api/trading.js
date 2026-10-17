// /api/trading — trade history for the Trading page and block (signed-in only; see _lib/copier.js).
import { fromCopier } from "../_lib/copier.js";

export async function onRequestGet({ request, env }) {
  const days = Math.max(1, Math.min(90, parseInt(new URL(request.url).searchParams.get("days"), 10) || 7));
  return fromCopier(env, `/api/data?days=${days}`);
}
