// Reads PDF bank statements in the browser (Nationwide current account / credit card, American Express, most UK banks).
// Nothing leaves the device until you press Import. Uses pdf.js (vendored in /assets/vendor/pdfjs).
import { parseMoney } from "./statements.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const pad = (n) => String(n).padStart(2, "0");
const yy = (y) => (y && y.length === 2 ? 2000 + +y : y ? +y : null);
const MONEY = /^[-–]?£?(\d{1,3}(,\d{3})+|\d+)\.\d{2}(\s?(CR|DR|-))?$/i;   // 1,234.56 or 1234.56

let pdfjs;
async function loadPdfjs() {
  if (!pdfjs) {
    pdfjs = await import("/assets/vendor/pdfjs/pdf.min.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdfjs/pdf.worker.min.mjs";
  }
  return pdfjs;
}

/** Text items -> lines of {y, items:[{x, r, s}]} per page, top to bottom. */
async function pdfLines(file) {
  const lib = await loadPdfjs();
  let doc;
  try {
    doc = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (e) {
    if (e?.name === "PasswordException") throw new Error("That PDF is password-protected — save an unlocked copy and try again.");
    throw new Error("Couldn't open that PDF.");
  }
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((it) => it.str && it.str.trim())
      .map((it) => ({ x: it.transform[4], y: it.transform[5], r: it.transform[4] + (it.width || 0), s: it.str.replace(/\s+/g, " ").trim(), h: Math.abs(it.transform[3]) || 8 }));
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of items) {
      const tol = Math.max(2, it.h * 0.45);
      const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) {
      l.items.sort((a, b) => a.x - b.x);
      // pdf.js sometimes splits "12.50" from "CR", or "£" from the number — glue close neighbours back together
      const merged = [];
      for (const it of l.items) {
        const prev = merged[merged.length - 1];
        if (prev && it.x - prev.r < 1.5 && !(MONEY.test(prev.s) && MONEY.test(it.s))) { prev.s += it.s; prev.r = it.r; }
        else if (prev && /^(CR|DR)$/i.test(it.s) && MONEY.test(prev.s) && it.x - prev.r < 12) { prev.s += " " + it.s; prev.r = it.r; }
        else merged.push({ ...it });
      }
      l.items = merged;
      l.text = merged.map((i) => i.s).join(" ");
    }
    lines.sort((a, b) => b.y - a.y);
    pages.push(lines);
  }
  return pages;
}

// A date at the start of a line: "05 Oct", "5 Oct 2026", "05/10/2026", "05/10/26", "Oct 05", "05.10.26"
function leadingDate(text) {
  let m;
  if ((m = text.match(new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?[\\s.-]+${MON}\\.?(?:[\\s.-]+(\\d{4}|\\d{2}))?\\b`, "i")))) {
    return { d: +m[1], m: MONTHS[m[2].slice(0, 3).toLowerCase()], y: yy(m[3]), len: m[0].length };
  }
  if ((m = text.match(new RegExp(`^${MON}\\.?\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?\\b`, "i")))) {
    return { d: +m[2], m: MONTHS[m[1].slice(0, 3).toLowerCase()], y: yy(m[3]), len: m[0].length };
  }
  if ((m = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/))) return { d: +m[1], m: +m[2], y: yy(m[3]), len: m[0].length };
  return null;
}

// The statement period, so dates without a year ("05 Oct") get the right one
function statementEnd(allText) {
  const found = [];
  const re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}\\.?,?\\s+(\\d{4})\\b`, "gi");
  let m;
  while ((m = re.exec(allText))) found.push(`${m[3]}-${pad(MONTHS[m[2].slice(0, 3).toLowerCase()])}-${pad(m[1])}`);
  const re2 = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g;
  while ((m = re2.exec(allText))) if (+m[2] <= 12) found.push(`${m[3]}-${pad(m[2])}-${pad(m[1])}`);
  const re3 = new RegExp(`\\b${MON}\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi");
  while ((m = re3.exec(allText))) found.push(`${m[3]}-${pad(MONTHS[m[1].slice(0, 3).toLowerCase()])}-${pad(m[2])}`);
  const now = new Date().toLocaleDateString("en-CA");
  const ok = found.filter((d) => d <= now && d >= "2000-01-01").sort();
  return ok.length ? ok[ok.length - 1] : now;
}

function toIso(dt, end) {
  if (!dt || !dt.m || dt.m > 12 || !dt.d || dt.d > 31) return null;
  let y = dt.y;
  if (!y) {
    const [ey, em] = end.split("-").map(Number);
    y = dt.m > em ? ey - 1 : ey;            // a December line on a January statement is last year
  }
  return `${y}-${pad(dt.m)}-${pad(dt.d)}`;
}

const SKIP = /(balance (brought|carried) forward|brought forward|carried? forward|balance from (previous )?statement|balance to carry|opening balance|closing balance|previous balance|new balance|^total|total (paid|payments|spend|credits|debits|money)|minimum payment|statement balance|^balance$|^page \d)/i;
const BAL_LINE = /(balance carried forward|carried? forward|balance to carry|closing balance|end balance|new balance)/i;

/** Returns the same shape as the CSV reader: { rows, balance, from, to, hasInOut }. */
export async function readPdfStatement(file, preset) {
  const pages = await pdfLines(file);
  const allText = pages.flat().map((l) => l.text).join("\n");
  if (allText.replace(/\s/g, "").length < 40) throw new Error("This PDF has no readable text (it may be a scan or a photo). Download the statement from your bank's app or website instead.");
  const end = statementEnd(allText);
  // Card statements list purchases as positive numbers
  // (a statement with separate Out / In columns is a bank account, whatever it mentions)
  const cardHint = preset.spendPositive || /credit card/i.test(preset.name || "") || /credit limit|minimum payment/i.test(allText.slice(0, 4000));

  const rows = [];
  let cols = null;            // {out, in, balance, amount} -> right-edge x of each column heading
  let lastDate = null, pending = [], lastBal = null, runBal = null, justAdded = false, closing = null, hasInOut = false, sawBalanceCol = false;

  for (const lines of pages) {
    for (const line of lines) {
      const t = line.text;
      const low = t.toLowerCase();
      const wasAdded = justAdded;
      justAdded = false;

      // Column headings (repeated on each page)
      if (/\bdate\b/.test(low) && /(paid out|money out|£ ?out|\bout\b|withdrawal|debit|paid in|money in|\bin\b|deposit|credit|amount|balance)/.test(low) && !leadingDate(t)) {
        const c = {};
        for (const it of line.items) {
          if (it.s.length > 24) continue;            // headings are short; long text is a sentence that happens to say "date"
          const s = it.s.toLowerCase();
          if (/(paid out|money out|^£? ?out|withdrawals?|debits?|payments? out)/.test(s)) c.out = it;
          else if (/(paid in|money in|^£? ?in$|deposits?|credits?|payments? in)/.test(s)) c.in = it;
          else if (/balance/.test(s)) c.balance = it;
          else if (/amount/.test(s)) c.amount = it;
        }
        if (c.out || c.in || c.amount || c.balance) { cols = c; hasInOut ||= !!(c.out || c.in); sawBalanceCol ||= !!c.balance; }
        pending = [];
        continue;
      }

      const money = line.items.filter((i) => MONEY.test(i.s));
      const dt = leadingDate(t);

      if (SKIP.test(low.replace(/^\S+\s+\S+\s+/, "")) || SKIP.test(low)) {
        // remember the balance on "balance brought/carried forward" lines
        if (money.length) {
          const v = parseMoney(money[money.length - 1].s.replace(/\s?CR$/i, ""));
          const isOd = /DR$/i.test(money[money.length - 1].s);
          if (v !== null) { lastBal = runBal = isOd ? -Math.abs(v) : v; if (BAL_LINE.test(low)) closing = lastBal; }
        }
        if (dt) lastDate = toIso(dt, end);
        pending = [];
        continue;
      }

      if (!money.length) {
        // A description line on its own (some banks wrap long descriptions, or put the date on the first line only)
        if (dt) { lastDate = toIso(dt, end); const rest = t.slice(dt.len).trim(); pending = rest ? [rest] : []; }
        else if (wasAdded && !pending.length && t.length < 80) {
          // Nationwide puts extra detail on the line underneath ("Salary", "APPLEPAY ****1234")
          const last = rows[rows.length - 1];
          last.note = [last.note, t].filter(Boolean).join(" · ").slice(0, 120);
          justAdded = true;
          continue;
        }
        else if (lastDate && t.length < 80 && rows.length + pending.length > 0) pending.push(t);
        if (pending.length > 3) pending = pending.slice(-3);
        continue;
      }

      const date = dt ? toIso(dt, end) : lastDate;
      if (!date) continue;
      if (dt) lastDate = date;

      // Work out which money item is amount / out / in / balance by its column
      let out = null, inn = null, bal = null, amt = null;
      const nearest = (it) => {
        if (!cols) return null;
        let best = null, dist = 1e9;
        for (const [k, h] of Object.entries(cols)) {
          const d = Math.min(Math.abs(it.r - h.r), Math.abs((it.x + it.r) / 2 - (h.x + h.r) / 2));
          if (d < dist) { dist = d; best = k; }
        }
        return dist < 70 ? best : null;
      };
      for (const it of money) {
        const k = nearest(it);
        const v = parseMoney(it.s.replace(/\s?(CR|DR)$/i, ""));
        const dr = /DR$/i.test(it.s);
        if (k === "out") out = Math.abs(v);
        else if (k === "in") inn = Math.abs(v);
        else if (k === "balance") bal = dr ? -Math.abs(v) : v;
        else amt = v;
      }
      if (!cols) {
        // No headings found: last number is the balance if there are two, otherwise it's the amount
        if (money.length >= 2) { amt = parseMoney(money[money.length - 2].s); bal = parseMoney(money[money.length - 1].s); }
        else amt = parseMoney(money[0].s);
      }

      let amount;
      if (out !== null || inn !== null) amount = (inn || 0) - (out || 0);
      else if (amt !== null) {
        // Card statements: purchases are positive, refunds/payments are marked CR or with a minus sign
        const crFlag = money.some((i) => /CR$/i.test(i.s));
        if (cardHint && !hasInOut) amount = crFlag || amt < 0 ? Math.abs(amt) : -amt;
        else amount = crFlag ? Math.abs(amt) : amt;
      } else continue;

      // A running balance is the most reliable guide to direction
      // (only when the row before also had a balance, so the difference is this one transaction)
      if (bal !== null && runBal !== null && Math.abs(Math.abs(bal - runBal) - Math.abs(amount)) < 0.005) amount = Math.round((bal - runBal) * 100) / 100;
      runBal = bal;
      if (bal !== null) lastBal = bal;
      if (!amount) continue;

      // Description: text between the date and the first number, plus any wrapped lines before it
      const firstMoneyX = money[0].x;
      let own = line.items.filter((i) => i.x < firstMoneyX && !MONEY.test(i.s)).map((i) => i.s).join(" ");
      if (dt) own = own.slice(Math.min(own.length, dt.len)).trim();
      // Amex prints a second (processing) date before the description
      const second = leadingDate(own);
      if (second) own = own.slice(second.len).trim();
      own = own.replace(/\s{2,}/g, " ").trim();
      const desc = own || pending.join(" ") || "Transaction";
      const note = own && pending.length ? pending.join(" ") : "";
      rows.push({ date, amount: Math.round(amount * 100) / 100, desc: desc.slice(0, 120), note: note.slice(0, 120) });
      pending = [];
      justAdded = true;
    }
  }

  if (!rows.length) throw new Error("Couldn't find any transactions in that PDF. If it keeps happening, send me the statement layout to tune it.");
  const dates = rows.map((r) => r.date).sort();
  const balance = cardHint && !hasInOut ? null : (closing ?? (sawBalanceCol ? lastBal : null));
  return { rows, balance, from: dates[0], to: dates[dates.length - 1], hasInOut, pdf: true };
}
