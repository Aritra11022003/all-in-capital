// Detects disagreements between documents. Never picks a winner: both sides are kept with provenance.
import type { Claim, Conflict, CriterionId } from "@/lib/shared/types";
import { MONEY_METRIC_LABELS, formatInr, extractVagueMagnitudes } from "./metrics";
import type { DocBundle } from "../pipeline";
import { flat } from "../extraction/text";

let seq = 0;
const cid = (appId: string) => `${appId}-cf${++seq}`;

function within(a: Claim, b: Claim, tol = 0.05): boolean {
  if (a.value == null || b.value == null) return false;
  const lo = (c: Claim) => (c.bound === "lte" ? 0 : c.value!);
  const hi = (c: Claim) => (c.bound === "gte" ? Infinity : c.value!);
  if (a.bound !== "eq" || b.bound !== "eq") {
    // ranges overlap?
    return lo(a) <= hi(b) * (1 + tol) && lo(b) <= hi(a) * (1 + tol);
  }
  return Math.abs(a.value - b.value) <= tol * Math.max(a.value, b.value);
}

function metricLabel(metric: string): string {
  if (metric.startsWith("count:")) {
    const [noun, status] = metric.slice(6).split("|");
    return `${status === "none" ? "" : status + " "}${noun}s`.replace(/ys$/, "ies");
  }
  return MONEY_METRIC_LABELS[metric] ?? metric;
}

const CRIT_FOR_METRIC = (m: string): CriterionId[] =>
  /cac|price|margin|revenue_net|revenue_gross/.test(m) ? ["business_model", "traction"] : /raise|valuation/.test(m) ? ["capital_fit"] : ["traction"];

const side = (c: Claim) => ({ claimId: c.id, display: c.text, sourceLabel: c.sourceLabel, excerpt: c.excerpt });

export function detectConflicts(appId: string, claims: Claim[], bundle: DocBundle): Conflict[] {
  seq = 0;
  const out: Conflict[] = [];
  const metricClaims = claims.filter((c) => c.metric && c.value != null && c.period !== undefined);
  const deck = metricClaims.filter((c) => c.sourceKind === "deck");
  const form = metricClaims.filter((c) => c.sourceKind === "form");

  // 1. Same metric, disjoint values (deck vs form). Counts need a status on both sides.
  const keys = new Set(deck.map((c) => c.metric!));
  for (const key of keys) {
    if (key.startsWith("count:") && key.endsWith("|none")) continue;
    if (["price", "margin", "cost_total", "capex"].includes(key)) continue;
    const d = deck.filter((c) => c.metric === key);
    const periods = new Set(d.map((c) => c.period));
    const f = form.filter((c) => c.metric === key && (periods.has(c.period!) || c.period === "unknown" || periods.has("unknown")));
    if (!d.length || !f.length) continue;
    const anyMatch = d.some((a) => f.some((b) => within(a, b)));
    if (anyMatch) continue;
    const a = d[0];
    const b = f[0];
    out.push({
      id: cid(appId),
      applicationId: appId,
      type: "numeric",
      metric: key,
      label: `${metricLabel(key)}: deck and form disagree`,
      a: side(a),
      b: side(b),
      note: `Deck states ${a.text}; form states ${b.text}. Neither is independently verified. Ask the founder which figure is current and how it is defined.`,
      criteria: CRIT_FOR_METRIC(key),
      severity: "high",
      status: "open",
    });
  }

  // 2. Revenue definition: deck "revenue" equals form "gross", and the form gives a different net figure.
  const deckRev = deck.filter((c) => c.metric === "revenue");
  const formGross = form.filter((c) => c.metric === "revenue_gross");
  const formNet = form.filter((c) => c.metric === "revenue_net");
  for (const r of deckRev) {
    const g = formGross.find((x) => within(r, x));
    if (g && formNet.length && !within(r, formNet[0])) {
      out.push({
        id: cid(appId),
        applicationId: appId,
        type: "definition",
        metric: "revenue",
        label: "Revenue definition: deck shows gross as revenue",
        a: side(r),
        b: side(formNet[0]),
        note: `The deck presents ${formatInr(r.value!)} as revenue. The form says this is gross and net revenue is ${formatInr(formNet[0].value!)}.`,
        criteria: ["business_model", "traction"],
        severity: "medium",
        status: "open",
      });
      break;
    }
  }

  // 3. Arithmetic: seats x price vs MRR; MRR x 12 vs ARR.
  const seats = metricClaims.find((c) => /^count:seat\|(paying|none)/.test(c.metric!) && !c.text.includes("x"));
  const price = metricClaims.find((c) => c.metric === "price" && /seat/i.test(c.excerpt));
  const mrrs = metricClaims.filter((c) => c.metric === "mrr");
  if (seats && price && mrrs.length) {
    const implied = seats.value! * price.value!;
    const off = mrrs.filter((m) => Math.abs(m.value! - implied) / m.value! > 0.1);
    if (off.length) {
      out.push({
        id: cid(appId),
        applicationId: appId,
        type: "arithmetic",
        metric: "mrr",
        label: "MRR does not reconcile with seats × price",
        a: side(off[0]),
        b: { claimId: seats.id, display: `${seats.value} seats × ${formatInr(price.value!)} = ${formatInr(implied)}`, sourceLabel: `${seats.sourceLabel} / ${price.sourceLabel}`, excerpt: `${seats.excerpt} … ${price.excerpt}` },
        note: `Implied MRR from seats and list price is ${formatInr(implied)}; stated MRR ${off.map((m) => `${formatInr(m.value!)} (${m.sourceLabel})`).join(", ")}. Discounts or non-seat revenue may explain it — ask.`,
        criteria: ["traction", "business_model"],
        severity: "medium",
        status: "open",
      });
    }
  }
  const arr = metricClaims.find((c) => c.metric === "arr");
  if (arr && mrrs.length && !mrrs.some((m) => Math.abs(m.value! * 12 - arr.value!) / arr.value! <= 0.1)) {
    out.push({
      id: cid(appId),
      applicationId: appId,
      type: "arithmetic",
      metric: "arr",
      label: "ARR is not 12 × MRR",
      a: side(arr),
      b: side(mrrs[0]),
      note: "Annualised revenue does not equal twelve months of the stated MRR.",
      criteria: ["traction"],
      severity: "low",
      status: "open",
    });
  }

  // 4. Vague magnitude in deck vs specific count in form ("thousands of travellers" vs 1,300).
  for (const v of extractVagueMagnitudes(bundle.deckText)) {
    const specific = form.filter((c) => c.metric?.startsWith(`count:${v.noun}|`));
    const max = Math.max(0, ...specific.map((c) => c.value!));
    if (specific.length && max < v.floor) {
      const s = specific.find((c) => c.value === max)!;
      const deckClaim = claims.find((c) => c.sourceKind === "deck" && c.excerpt.includes(v.phrase.split(" ")[0])) ?? null;
      out.push({
        id: cid(appId),
        applicationId: appId,
        type: "magnitude",
        metric: `count:${v.noun}`,
        label: `Deck says "${v.phrase}"; form gives ${max.toLocaleString("en-IN")}`,
        a: deckClaim ? side(deckClaim) : { claimId: "", display: v.phrase, sourceLabel: "Deck", excerpt: v.excerpt },
        b: side(s),
        note: `"${v.phrase}" implies at least ${v.floor.toLocaleString("en-IN")}. The form reports ${max.toLocaleString("en-IN")}.`,
        criteria: ["traction", "founder_quality"],
        severity: "medium",
        status: "open",
      });
    }
  }

  // 5. Credentials in the deck that the form does not support.
  const deckTeam = bundle.deckPages.filter((p) => /team|founder/i.test(p.text.split("\n")[0] ?? ""));
  const formFounderText = flat(bundle.formFounderText).toLowerCase();
  if (deckTeam.length && formFounderText) {
    const brandRe = /\bEx-([A-Z][\w&]*(?:\s[A-Z][\w&]*)?)|\b((?:IIT|IIM|ISB|BITS|NIT|AIIMS)\s+[A-Z][a-z]+)|\b(Goldman Sachs|McKinsey|BCG|Bain|Google|Microsoft|Amazon|Meta|Flipkart|Harvard|Stanford|Wharton|INSEAD|Oxford|Cambridge)\b/g;
    const missing: { token: string; page: number; excerpt: string }[] = [];
    for (const p of deckTeam) {
      const t = flat(p.text);
      for (const m of t.matchAll(brandRe)) {
        const token = (m[1] ?? m[2] ?? m[3]).trim();
        if (!formFounderText.includes(token.toLowerCase()) && !missing.some((x) => x.token === token)) {
          missing.push({ token, page: p.index, excerpt: t.slice(Math.max(0, m.index! - 40), m.index! + 60) });
        }
      }
    }
    if (missing.length) {
      const deckClaim = claims.find((c) => c.sourceKind === "deck" && c.page === missing[0].page && /Deck slide headline/.test(c.text)) ?? null;
      const formClaim = claims.find((c) => c.sourceKind === "form" && /^Founder/i.test(c.text)) ?? null;
      out.push({
        id: cid(appId),
        applicationId: appId,
        type: "credential",
        metric: "founder_credentials",
        label: `Deck credentials not supported by the form: ${missing.map((m) => m.token).join(", ")}`,
        a: deckClaim ? { ...side(deckClaim), excerpt: missing[0].excerpt } : { claimId: "", display: missing.map((m) => m.token).join(", "), sourceLabel: `Deck p${missing[0].page}`, excerpt: missing[0].excerpt },
        b: formClaim ? side(formClaim) : { claimId: "", display: bundle.formFounderText.slice(0, 160), sourceLabel: "Form", excerpt: bundle.formFounderText.slice(0, 200) },
        note: "The deck names brands or institutions that the form's own founder description does not mention, or describes differently. Credentials are never scored, but an inconsistency in how the founder presents themself is recorded.",
        criteria: ["founder_quality"],
        severity: "high",
        status: "open",
      });
    }
  }

  // 6. How credit is funded (deck vs form).
  const dFlat = flat(bundle.deckText);
  const fFlat = flat(bundle.formText);
  const deckOwn = /own capital|our own (?:money|funds|balance sheet)|founders?'? savings/i.exec(dFlat);
  const deckPending = /NBFC[^.]{0,40}(?:discussion|talks|in principle)|(?:discussion|talks)[^.]{0,30}NBFC/i.test(dFlat);
  const formEstablished = /through our NBFC partner|provided through (?:an? |our )?NBFC|funded by our partner NBFC/i.exec(fFlat);
  if (deckOwn && deckPending && formEstablished) {
    const dc = claims.find((c) => c.sourceKind === "deck" && /Deck slide headline/.test(c.text) && /own capital|NBFC/i.test(c.excerpt)) ?? null;
    const fc = claims.find((c) => c.sourceKind === "form" && !c.metric && /NBFC/i.test(c.text)) ?? null;
    out.push({
      id: cid(appId),
      applicationId: appId,
      type: "qualitative",
      metric: "credit_funding",
      label: "Who funds the credit book: deck and form disagree",
      a: dc ? { ...side(dc), display: "Credit funded from own capital; NBFC partnership in discussion" } : { claimId: "", display: deckOwn[0], sourceLabel: "Deck", excerpt: dFlat.slice(Math.max(0, deckOwn.index - 80), deckOwn.index + 120) },
      b: fc ? side(fc) : { claimId: "", display: formEstablished[0], sourceLabel: "Form", excerpt: fFlat.slice(Math.max(0, formEstablished.index - 60), formEstablished.index + 120) },
      note: "Deck: credit is funded from the company's own capital and an NBFC partnership is still in discussion. Form: credit is provided through an NBFC partner. This changes the regulatory position and who bears losses.",
      criteria: ["business_model", "path_to_market", "founder_quality"],
      severity: "high",
      status: "open",
    });
  }
  return out;
}
