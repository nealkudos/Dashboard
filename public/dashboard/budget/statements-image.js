// Reads transactions from screenshots of a banking app (e.g. the Nationwide app's transaction list).
// Text recognition (Tesseract) runs on this device; nothing is sent anywhere until you press Import.
const V = "/assets/vendor/tesseract/";
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const MON = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// An amount at the end of a line: "-£12.50", "+ £2,255.51", "£9.99", "12.50" (OCR sometimes drops the £)
const AMOUNT = /([+\-−–]?)\s?(£|E|€)?\s?(\d{1,3}(?:[,.]\d{3})*|\d+)[.,](\d{2})\s*(CR|DR)?\s*$/i;
// The small decimal point sometimes goes missing ("-£888" for -£8.88): with a £ sign, the last two digits are pence
const AMOUNT_NODOT = /([+\-−–]?)\s?(£)\s?(\d{1,3}(?:,\d{3})*|\d+)(\d{2})\s*()$/;
const SKIP = /(balance|available|overdraft|arranged|pending|search|statements?\b|spending|insights|payments? due|see all|filter)/i;

let workerP = null;
function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Tesseract) return res();
    const s = document.createElement("script");
    s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load the screenshot reader."));
    document.head.append(s);
  });
}
async function worker(onProgress) {
  if (!workerP) {
    workerP = (async () => {
      await loadScript(V + "tesseract.min.js");
      return window.Tesseract.createWorker("eng", 1, {
        workerPath: V + "worker.min.js", corePath: V, langPath: V, gzip: true, workerBlobURL: false,
        logger: (m) => m.status === "recognizing text" && onProgress?.(m.progress),
      });
    })();
  }
  return workerP;
}

/** Draw the screenshot onto a canvas; dark-mode screenshots are flipped to dark text on white, which reads far better. */
async function prepare(file) {
  const bmp = await createImageBitmap(file);
  const scale = bmp.width < 1300 ? 2 : 1;      // bigger text reads more reliably (decimal points especially)
  const c = document.createElement("canvas");
  c.width = bmp.width * scale; c.height = bmp.height * scale;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.drawImage(bmp, 0, 0, c.width, c.height);
  const img = g.getImageData(0, 0, c.width, c.height), px = img.data;
  let sum = 0;
  for (let i = 0; i < px.length; i += 16) sum += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const dark = sum / (px.length / 16) < 110;
  for (let i = 0; i < px.length; i += 4) {
    let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (dark) y = 255 - y;
    y = y > 200 ? 255 : y < 60 ? 0 : y;                 // a little contrast
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function headerDate(text, today) {
  const t = text.trim().replace(/[,.]/g, " ").replace(/\s+/g, " ");
  if (/^today\b/i.test(t)) return iso(today);
  if (/^yesterday\b/i.test(t)) return iso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  const m = t.match(new RegExp(`^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON}(?:\\s+(\\d{4}))?$`, "i"))
    || t.match(new RegExp(`^(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\\s+)?${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?$`, "i"));
  if (!m) return null;
  let d, mo, y;
  if (/^\d/.test(m[1])) { d = +m[1]; mo = MONTHS[m[2].slice(0, 3).toLowerCase()]; y = m[3] ? +m[3] : null; }
  else { mo = MONTHS[m[1].slice(0, 3).toLowerCase()]; d = +m[2]; y = m[3] ? +m[3] : null; }
  if (!mo || d < 1 || d > 31) return null;
  if (!y) y = mo > today.getMonth() + 1 ? today.getFullYear() - 1 : today.getFullYear();
  return `${y}-${pad(mo)}-${pad(d)}`;
}

// Money in unless it clearly says otherwise is risky; spending is far more common, so unsigned amounts are spending
// unless the description reads like money arriving. You can flip any row before importing.
const LOOKS_IN = /(bank credit|credit from|transfer from|refund|salary|kudos|interest|cash credit|received|deposit|payment from)/i;

export function parseLines(lines, today = new Date()) {
  const rows = [];
  let date = null, pendingText = null, last = null, balance = null, balanceDate = null;
  for (const raw of lines) {
    let text = raw.replace(/[|»«]/g, " ").replace(/\s+/g, " ").trim()
      .replace(/\s*[>›〉)\]}]+\s*$/, "")                // the chevron at the end of each row
      .replace(/^[A-Z]\s+(?=[A-Za-z])/, "");          // the letter badge at the start of a row ("M", "N")
    if (text.length < 2) continue;
    if (new RegExp(`^${MON}\\s+\\d{4}$`, "i").test(text)) { pendingText = null; last = null; continue; }   // "October 2026"
    // Day headers: "Monday 2 Nov" — Nationwide puts that day's closing balance on the same line
    const am = text.match(AMOUNT) || text.match(AMOUNT_NODOT);
    const hd = headerDate(am ? text.slice(0, am.index) : text, today);
    if (hd) {
      date = hd; pendingText = null; last = null;
      if (am && (!balanceDate || hd > balanceDate)) { balance = parseFloat(`${am[3].replace(/[,.]/g, "")}.${am[4]}`); balanceDate = hd; }
      continue;
    }
    if (SKIP.test(text) && !AMOUNT.test(text) && !AMOUNT_NODOT.test(text)) { pendingText = null; continue; }
    const m = text.match(AMOUNT) || text.match(AMOUNT_NODOT);
    if (m && date) {
      if (SKIP.test(text)) continue;                    // e.g. "Balance £1,234.56"
      const whole = m[3].replace(/[,.]/g, "");
      let amount = parseFloat(`${whole}.${m[4]}`);
      let desc = text.slice(0, m.index).replace(/[•·*]+/g, " ").trim();
      if (desc.length <= 2) desc = "";                  // just the letter badge — the name is on the line above
      if (!desc && pendingText) {
        desc = pendingText;
        // that line was the next transaction's name, not a note on the one before
        if (last && last.note) last.note = last.note.split(" · ").filter((n) => n !== pendingText).join(" · ");
      }
      if (!desc || /^\d+$/.test(desc)) { pendingText = null; continue; }
      const sign = m[1];
      if (sign === "+" || /CR/i.test(m[5] || "")) amount = Math.abs(amount);
      else if (sign && "-−–".includes(sign)) amount = -Math.abs(amount);
      else amount = LOOKS_IN.test(desc) ? Math.abs(amount) : -Math.abs(amount);
      last = { date, amount: Math.round(amount * 100) / 100, desc: desc.slice(0, 120), note: "", guessed: !sign };
      rows.push(last);
      pendingText = null;
      continue;
    } else if (date) {
      // A second line under a transaction (e.g. "Contactless", "Direct debit") or a description whose amount is on the next line
      if (last && !pendingText && text.length < 60 && /[A-Za-z]{3,}/.test(text)) { last.note = [last.note, text].filter(Boolean).join(" · ").slice(0, 120); }
      pendingText = text.length < 80 ? text : null;
    }
  }
  rows.balance = balance; rows.balanceDate = balanceDate;
  return rows;
}

/** Same shape as the other readers: { rows, balance, from, to, image: true } */
export async function readImageStatement(files, preset, onProgress) {
  const w = await worker();
  const today = new Date();
  let balance = null, balanceDate = null;
  const perShot = [];
  for (let i = 0; i < files.length; i++) {
    onProgress?.(`Reading screenshot ${i + 1} of ${files.length}…`);
    const canvas = await prepare(files[i]);
    const { data } = await w.recognize(canvas);
    const lines = (data.lines || []).map((l) => l.text);
    const rows = parseLines(lines.length ? lines : data.text.split("\n"), today);
    if (rows.balance != null && (!balanceDate || rows.balanceDate > balanceDate)) { balance = rows.balance; balanceDate = rows.balanceDate; }   // the newest day shown
    perShot.push(rows);
  }
  // Overlapping screenshots show some transactions twice: keep each one as many times as it appears in any single shot
  const count = {}, rows = [];
  for (const shot of perShot) {
    const here = {};
    for (const r of shot) {
      const k = `${r.date}|${r.amount}|${r.desc.toLowerCase()}`;
      here[k] = (here[k] || 0) + 1;
      if (here[k] > (count[k] || 0)) { count[k] = here[k]; rows.push(r); }
    }
  }
  if (!rows.length) throw new Error("Couldn't find any transactions in those screenshots. Make sure the dates (e.g. \"Monday 9 November\") are in the picture.");
  rows.sort((a, b) => b.date.localeCompare(a.date));
  const dates = rows.map((r) => r.date).sort();
  return { rows, balance, from: dates[0], to: dates[dates.length - 1], image: true };
}
