// Reads bank statement CSV files in the browser (nothing leaves your device until you press Import).
// Handles Nationwide (current account and credit card), American Express, Monzo and most other UK CSVs.

export const PRESETS = [
  { id: "nationwide", bank: "Nationwide", name: "Current account", spendPositive: false },
  { id: "nationwide-cc", bank: "Nationwide", name: "Credit card", spendPositive: false },
  { id: "amex", bank: "American Express", name: "Credit card", spendPositive: true },   // Amex lists purchases as positive
  { id: "monzo", bank: "Monzo", name: "Current account", spendPositive: false },
  { id: "other", bank: "Other", name: "Account", spendPositive: false },
];

function decode(buf) {
  const utf8 = new TextDecoder("utf-8").decode(buf);
  if (!utf8.includes("�")) return utf8.replace(/^﻿/, "");
  return new TextDecoder("windows-1252").decode(buf);     // Nationwide exports in Windows encoding
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.map((r) => r.map((f) => f.trim())).filter((r) => r.some((f) => f));
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function parseDate(s) {
  s = String(s || "").trim();
  let m;
  const pad = (n) => String(n).padStart(2, "0");
  const yy = (y) => (y.length === 2 ? 2000 + +y : +y);
  if ((m = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) return `${m[1]}-${m[2]}-${m[3]}`;
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) return `${yy(m[3])}-${pad(m[2])}-${pad(m[1])}`;   // UK day first
  if ((m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{2,4})/)) && MONTHS[m[2].toLowerCase()]) {
    return `${yy(m[3])}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(m[1])}`;
  }
  return null;
}

export function parseMoney(s) {
  s = String(s ?? "").trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s.replace(/[£$€\s]/g, "")) || /\bDR\b/i.test(s);
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return null;
  return neg ? -n : n;
}

const find = (head, re) => head.findIndex((h) => re.test(h));

/** Returns { rows:[{date, amount, desc, note}], balance, from, to, hasInOut, columns } or throws. */
export async function readStatement(file, preset) {
  if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
    const { readPdfStatement } = await import("./statements-pdf.js");
    return readPdfStatement(file, preset);
  }
  const text = decode(await file.arrayBuffer());
  const all = parseCsv(text);
  // The header row is the first one with a date column and some money column
  const hi = all.findIndex((r) => {
    const l = r.map((x) => x.toLowerCase());
    return l.some((x) => /^(date|transaction date|posting date|completed date)$/.test(x)) &&
      l.some((x) => /amount|paid out|paid in|debit|credit|money out|money in|value/.test(x));
  });
  if (hi < 0) throw new Error("Couldn't find the column headings — is this a CSV statement export?");
  const head = all[hi].map((h) => h.toLowerCase());
  const col = {
    date: find(head, /^(date|transaction date|posting date|completed date)$/),
    desc: find(head, /^(description|transactions|details|name|merchant|narrative|payee|transaction description)$/),
    type: find(head, /^(transaction type|type)$/),
    amount: find(head, /^(amount|value|amount \(gbp\)|local amount)$/),
    out: find(head, /(paid out|debit|money out|withdrawal)/),
    in: find(head, /(paid in|credit|money in|deposit)/),
    balance: find(head, /^balance/),
    extra: find(head, /^(extended details|reference|notes and #tags|notes)$/),
  };
  if (col.date < 0 || (col.amount < 0 && col.out < 0 && col.in < 0)) throw new Error("This file doesn't have date and amount columns I recognise.");
  const hasInOut = col.amount < 0;

  const rows = [];
  const balances = [];
  for (const r of all.slice(hi + 1)) {
    const date = parseDate(r[col.date]);
    if (!date) continue;
    let amount;
    if (hasInOut) amount = (parseMoney(r[col.in]) || 0) - Math.abs(parseMoney(r[col.out]) || 0);
    else {
      amount = parseMoney(r[col.amount]);
      if (amount === null) continue;
      if (preset.spendPositive) amount = -amount;
    }
    if (!amount) continue;
    const desc = (col.desc >= 0 ? r[col.desc] : "") || (col.type >= 0 ? r[col.type] : "") || "Transaction";
    const note = [col.type >= 0 && col.desc >= 0 ? r[col.type] : "", col.extra >= 0 ? r[col.extra] : ""].filter(Boolean).join(" · ");
    rows.push({ date, amount: Math.round(amount * 100) / 100, desc, note });
    balances.push(col.balance >= 0 ? parseMoney(r[col.balance]) : null);
  }
  // Statements run newest-first or oldest-first: the balance is the one on the newest row
  let balance = null;
  if (rows.length) {
    const newestFirst = rows[0].date >= rows[rows.length - 1].date;
    balance = newestFirst ? balances[0] : balances[balances.length - 1];
  }
  if (!rows.length) throw new Error("No transactions found in that file.");
  const dates = rows.map((r) => r.date).sort();
  return { rows, balance, from: dates[0], to: dates[dates.length - 1], hasInOut };
}
