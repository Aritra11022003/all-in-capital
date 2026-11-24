// Metric extraction: money amounts and counts with their meaning, period and exact source excerpt.
import type { MetricPeriod } from "@/lib/shared/types";
import { flat } from "../extraction/text";

export interface MetricHit {
  metric: string; // e.g. "mrr", "cac", "count:firm|paying"
  value: number;
  bound: "eq" | "lte" | "gte";
  unit: "INR" | "count" | "pct";
  period: MetricPeriod;
  projection: boolean; // future target / market sizing — never compared with traction
  excerpt: string;
  index: number;
  display: string;
  /** P3: explicit "as of <Month> <Year>" in the same sentence (YYYY-MM). */
  asOf?: string;
  /** P3: the sentence describes an annual figure. Used only by the period-consistency check; `period` is unchanged. */
  annualHint?: boolean;
}

const MONTH_NUM: Record<string, string> = { january: "01", february: "02", march: "03", april: "04", may: "05", june: "06", july: "07", august: "08", september: "09", october: "10", november: "11", december: "12" };
/** P3: explicit "as of / as on / as at <Month> <Year>" only — never inferred. */
export function asOfFrom(sentence: string): string | undefined {
  const m = /\bas (?:of|on|at) (january|february|march|april|may|june|july|august|september|october|november|december),? (\d{4})\b/i.exec(sentence);
  return m ? `${m[2]}-${MONTH_NUM[m[1].toLowerCase()]}` : undefined;
}
const ANNUAL_HINT = /\bannual(?:ly|ised|ized)?\b|\bper (?:year|annum)\b|\byearly\b/i;

export const MONEY_METRIC_LABELS: Record<string, string> = {
  mrr: "Monthly recurring revenue",
  arr: "Annual recurring revenue",
  cac: "Customer acquisition cost",
  raise: "Amount raising",
  valuation: "Valuation (post-money)",
  revenue: "Revenue",
  revenue_gross: "Revenue (gross)",
  revenue_net: "Revenue (net)",
  gmv: "GMV",
  volume: "Payment / transaction volume",
  disbursed: "Advances disbursed",
  price: "Price",
  capex: "Capex",
  cost_total: "Total cost",
  margin: "Margin",
};

const UNIT: [RegExp, number][] = [
  [/^lakh\s*(cr|crore)/i, 1e12],
  [/^(cr|crores?)$/i, 1e7],
  [/^(l|lakhs?|lac)$/i, 1e5],
  [/^(k|thousand)$/i, 1e3],
  [/^(m|mn|million)$/i, 1e6],
];

export function parseInr(num: string, unit?: string): number {
  const n = Number(num.replace(/,/g, ""));
  if (!unit) return n;
  for (const [re, mult] of UNIT) if (re.test(unit.trim())) return n * mult;
  return n;
}

export function formatInr(v: number): string {
  if (v >= 1e7) return `INR ${+(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `INR ${+(v / 1e5).toFixed(2)} L`;
  return `INR ${v.toLocaleString("en-IN")}`;
}

// Order matters only for tie-breaking; the keyword nearest to the amount wins.
const MONEY_RULES: [string, RegExp][] = [
  ["valuation", /post-money|valuation/gi],
  ["raise", /\braising\b|the ask|amount raising|\braise\b/gi],
  ["cost_total", /field cost|total cost|cost of \d+ pilots|pilots at/gi],
  ["cac", /\bCAC\b|cost per (?:new |paid |registered )?(?:customer|patient|store|user|team|SME|booking)|per registered user|acquisition cost|paid acquisition|per new patient/gi],
  ["revenue_net", /net revenue/gi],
  ["revenue_gross", /\bgross\b(?! margin)/gi],
  ["mrr", /monthly recurring|\bMRR\b/gi],
  ["arr", /annual recurring|annuali[sz]ed|\bARR\b/gi],
  ["gmv", /\bGMV\b/gi],
  ["volume", /\bvolume\b|rent paid|of rent|booking value/gi],
  ["disbursed", /disbursed|\badvanced\b/gi],
  ["margin", /\bmargin\b/gi],
  ["capex", /\bcapex\b/gi],
  ["price", /per seat|per sensor|per firm|a month per|per drafted|per month/gi],
  ["revenue", /\brevenue\b/gi],
];

const PROJECTION = /\bIn \d+ (?:months|years):|\b(?:next|within) \d+ (?:months|years)|\bby (?:FY|20)\d+|\btarget\b|\bgoal\b|\bSOM\b|\bTAM\b|\bSAM\b|at maturity|would mean|capturing just|even 1%|opportunity for|in three years|\s[x×]\s|\b(?:annual|total|yearly)\b[^.]{0,60}\bin India\b|\bmarket (?:size|opportunity)\b/i;
// P3 (EXG-02): market sizing stated on the line AFTER the amount ("INR 1.5 lakh Cr / annual urban rent paid in India").
const MARKET_SIZING = /\b(?:annual|total|yearly)\b[^.]{0,60}\bin India\b|\bmarket (?:size|opportunity)\b/i;

/** Flatten text but remember line boundaries so "sentences" never span a whole slide. */
function flatWithLines(text: string): { t: string; sentenceAt: (idx: number) => string } {
  const lines = text.split("\n");
  const starts: number[] = [];
  let t = "";
  for (const l of lines) {
    starts.push(t.length);
    t += (t ? " " : "") + l.trim();
  }
  t = t.replace(/\s+/g, " ");
  const sentenceAt = (idx: number) => {
    let li = 0;
    for (let i = 0; i < starts.length; i++) if (starts[i] <= idx) li = i;
    const lineStart = starts[Math.max(0, li - 1)];
    const lineEnd = starts[li + 1] ?? t.length;
    const dotBefore = t.lastIndexOf(". ", idx);
    const dotAfter = t.indexOf(". ", idx);
    const a = Math.max(lineStart, dotBefore + 1);
    const b = Math.min(lineEnd, dotAfter === -1 ? t.length : dotAfter + 1);
    return t.slice(a, Math.max(a, b));
  };
  return { t, sentenceAt };
}
const CUMULATIVE = /since launch|since (?:july|june|march|april|may|aug|sept?|oct|nov|dec|jan|feb)\w*|cumulative|in total|to date|last (?:three|3|six|6|twelve|12) months|in \d+ months|disbursed since/i;
const MONTHLY = /monthly|a month|per month|\bin (?:january|february|march|april|may|june|july|august|september|october|november|december)\b|october|september|\bMRR\b/i;

function nearestRule(pre: string, post: string): string | null {
  let best: { key: string; dist: number } | null = null;
  for (const [key, re] of MONEY_RULES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(post))) {
      const d = m.index; // distance after amount
      if (!best || d < best.dist) best = { key, dist: d };
    }
    re.lastIndex = 0;
    while ((m = re.exec(pre))) {
      const d = pre.length - (m.index + m[0].length) + 10; // bias toward labels that follow the amount (deck style)
      if (!best || d < best.dist) best = { key, dist: d };
    }
  }
  return best && best.dist < 60 ? best.key : null;
}

const MONEY_RE = /(under|below|less than|over|more than|about|around|~)?\s*(?:\bINR|\bRs\.|₹)\s?(\d[\d,]*(?:\.\d+)?)\s*\+?\s*(lakh\s+(?:Cr|crore)|lakhs?|lac|L|Cr|crores?|K|thousand|million|mn)?(?![\w])/gi;

export function extractMoney(text: string): MetricHit[] {
  const { t, sentenceAt } = flatWithLines(text);
  const hits: MetricHit[] = [];
  const matches = [...t.matchAll(MONEY_RE)];
  matches.forEach((m, i) => {
    const idx = m.index!;
    const prevEnd = i > 0 ? matches[i - 1].index! + matches[i - 1][0].length : 0;
    const nextStart = i < matches.length - 1 ? matches[i + 1].index! : t.length;
    const pre = t.slice(Math.max(prevEnd, idx - 60), idx);
    const rawPost = t.slice(idx + m[0].length, Math.min(nextStart, idx + m[0].length + 45));
    // P3 (EXG-01): stop at the end of the amount's sentence, so "INR 380. Revenue mix: …" is not revenue.
    const stop = /[.!?](?=\s|$)/.exec(rawPost);
    const post = stop ? rawPost.slice(0, stop.index + 1) : rawPost;
    const metric = nearestRule(pre, post);
    if (!metric) return;
    const value = parseInr(m[2], m[3]);
    if (!isFinite(value) || value <= 0) return;
    const qual = (m[1] ?? "").toLowerCase();
    const bound: MetricHit["bound"] = /under|below|less/.test(qual) ? "lte" : /over|more/.test(qual) ? "gte" : "eq";
    // sentence window for projection / period detection
    const sentence = sentenceAt(idx);
    const local = pre.slice(-40) + m[0] + post;
    const projection = PROJECTION.test(sentence) || MARKET_SIZING.test(post);
    const period: MetricPeriod = CUMULATIVE.test(local)
      ? "cumulative"
      : metric === "arr"
        ? "annual"
        : MONTHLY.test(local) || metric === "mrr"
          ? "monthly"
          : "unknown";
    hits.push({
      metric,
      value,
      bound,
      unit: "INR",
      period,
      projection,
      excerpt: (pre.slice(-50) + m[0] + post.slice(0, 45)).trim(),
      index: idx,
      display: `${bound === "lte" ? "under " : bound === "gte" ? "over " : ""}${formatInr(value)}`,
      asOf: asOfFrom(sentence),
      annualHint: ANNUAL_HINT.test(local),
    });
  });
  return hits;
}

const NOUNS =
  "customers|customer|clients|client|users|retailers|stores|firms|teams|seats|sensors|SMEs|clinics|bookings|travellers|workers|pilots|families|payments|farmers|households";
const STATUS = /\b(paying|paid|live|pilots?|trial|churned|onboarded|registered|enabled|open|active)\b/i;

function singular(n: string): string {
  const s = n.toLowerCase();
  if (s === "smes") return "sme";
  if (s.endsWith("ies")) return s.slice(0, -3) + "y";
  return s.replace(/s$/, "");
}

export function extractCounts(text: string): MetricHit[] {
  const { t, sentenceAt } = flatWithLines(text);
  const re = new RegExp(`(?<![\\d.,%₹])(\\d{1,3}(?:,\\d{3})+|\\d+)(?![\\d.,%])\\s+((?:[A-Za-z][\\w-]*\\s+){0,3}?)(${NOUNS})\\b`, "g");
  const hits: MetricHit[] = [];
  for (const m of t.matchAll(re)) {
    const idx = m.index!;
    const before = t.slice(Math.max(0, idx - 12), idx);
    if (/\b\d+\s+of\s*$/.test(before) || /(INR|Rs\.?|₹)\s*$/.test(before)) continue; // "22 of 38", money
    const qualifier = m[2].trim();
    if (/\bof\b/.test(qualifier) && /^\s*of\b/.test(qualifier)) continue;
    const after = t.slice(idx + m[0].length, idx + m[0].length + 22);
    if (/^\s*of\s+\d/.test(t.slice(idx + m[1].length, idx + m[1].length + 6))) continue; // "6 of 11"
    const statusMatch = STATUS.exec(qualifier) ?? STATUS.exec(after.split(/[,.;]/)[0]);
    const status = statusMatch ? statusMatch[1].toLowerCase().replace(/^paid$/, "paying").replace(/^pilots$/, "pilot") : "none";
    const projection = PROJECTION.test(sentenceAt(idx));
    const value = Number(m[1].replace(/,/g, ""));
    const noun = singular(m[3]);
    hits.push({
      metric: `count:${noun}|${status}`,
      value,
      bound: "eq",
      unit: "count",
      period: "point",
      projection,
      excerpt: t.slice(Math.max(0, idx - 30), idx + m[0].length + 30).trim(),
      index: idx,
      display: `${value.toLocaleString("en-IN")} ${m[2]}${m[3]}`.replace(/\s+/g, " "),
      asOf: asOfFrom(sentenceAt(idx)),
    });
  }
  return hits;
}

/** Vague magnitude claims such as "thousands of travellers". */
export function extractVagueMagnitudes(text: string): { noun: string; floor: number; excerpt: string; phrase: string }[] {
  const t = flat(text);
  const out: { noun: string; floor: number; excerpt: string; phrase: string }[] = [];
  const re = new RegExp(`\\b(hundreds|thousands|lakhs|millions)\\s+of\\s+(?:[a-z]+\\s+){0,2}?(${NOUNS})\\b`, "gi");
  for (const m of t.matchAll(re)) {
    const floor = { hundreds: 200, thousands: 2000, lakhs: 200000, millions: 2000000 }[m[1].toLowerCase()]!;
    out.push({ noun: singular(m[2]), floor, phrase: m[0], excerpt: t.slice(Math.max(0, m.index! - 40), m.index! + m[0].length + 40) });
  }
  return out;
}

export function extractPercent(text: string, keyword: RegExp): { value: number; excerpt: string }[] {
  const t = flat(text);
  const out: { value: number; excerpt: string }[] = [];
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s?%/g)) {
    const w = t.slice(Math.max(0, m.index! - 50), m.index! + 40);
    if (keyword.test(w)) out.push({ value: Number(m[1]), excerpt: w.trim() });
  }
  return out;
}
