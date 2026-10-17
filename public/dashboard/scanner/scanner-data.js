// Shared by the Scanner page and the Scanner block.
export async function fetchScanner() {
  const res = await fetch("/api/scanner", { credentials: "same-origin" });
  if (res.status === 401) { location.replace("/"); throw new Error("Signed out"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.ok === false) throw new Error(body.error || `Error ${res.status}`);
  return body.data;
}
