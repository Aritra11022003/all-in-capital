// P3 · Data-integrity checks layered on top of the six existing conflict rules (which are unchanged and
// still scored). Everything added here is FLAG-ONLY: shown, audited, never scored.
//
// Every conflict gets:
//   relation — contradiction | different_period | different_definition | possibly_updated | one_sided | possible_match
//   values   — every disagreeing claim (source, page, exact passage, as-of, origin), incl. several in one document
//   key      — type|metric|relation;  valueSig — the normalised values;  id = hash(appId, key, valueSig)
// so a reviewer's resolution carries over only while the evidence is unchanged.
import type { Claim, Conflict, ConflictRelation, ConflictSide, CriterionId } from "@/lib/shared/types";
import { MONEY_METRIC_LABELS, formatInr } from "./metrics";
import { side } from "./conflicts";
import { matchCompany, matchPerson } from "./identity";

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const within = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol * Math.max(a, b);
const active = (c: Claim) => !c.withdrawn;
const isProjection = (c: Claim) => !!c.metric?.startsWith("projection:");

const RELATION_OF: Record<string, ConflictRelation> = { numeric: "contradiction", magnitude: "contradiction", credential: "contradiction", qualitative: "contradiction", arithmetic: "contradiction", definition: "different_definition" };

/** Value signature used in the stable identity. */
function sigOf(values: ConflictSide[], claims: Claim[]): string {
  const norm = (s: ConflictSide) => {
    const c = claims.find((x) => x.id === s.claimId);
    const v = c?.fact?.normalized ?? (c?.value != null ? String(Math.round(c.value)) : s.display.toLowerCase().replace(/\s+/g, " "));
    return `${s.sourceLabel.split(" ")[0]}:${v}`;
  };
  return [...new Set(values.map(norm))].sort().join("|");
}

export function identify(appId: string, c: Conflict, claims: Claim[]): Conflict {
  const relation = c.relation ?? RELATION_OF[c.type] ?? "contradiction";
  const values = c.values ?? [c.a, c.b];
  const key = `${c.type}|${c.metric}|${relation}`;
  const valueSig = sigOf(values, claims);
  return { ...c, relation, values, key, valueSig, scoring: c.scoring ?? "scored", id: `cf-${fnv(`${appId}|${key}|${valueSig}`)}` };
}

function flag(appId: string, o: { type: Conflict["type"]; metric: string; relation: ConflictRelation; label: string; values: Claim[]; note: string; severity: Conflict["severity"]; criteria?: CriterionId[] }): Conflict {
  const values = o.values.map(side);
  return {
    id: "",
    applicationId: appId,
    type: o.type,
    metric: o.metric,
    label: o.label,
    a: values[0],
    b: values[1] ?? values[0],
    values,
    note: `${o.note} Flag only — shown for review; does not change any score or recommendation.`,
    criteria: o.criteria ?? [],
    severity: o.severity,
    status: "open",
    relation: o.relation,
    scoring: "flag_only",
  };
}

// Single-valued money facts are compared only when the amount is bound to its own keyword in the passage
// ("Amount raising INR 2 Cr", "Valuation expectation INR 12 Cr post-money"). Amounts that merely sit nearby
// ("Existing investors: one angel, INR 15 L", "seed round of INR 9 Cr raised in 2024") are never compared.
const AMOUNT = /(?:\bINR|\bRs\.|₹)\s?(\d[\d,]*(?:\.\d+)?)\s*(lakh\s+(?:Cr|crore)|lakhs?|lac|L|Cr|crores?|K|thousand|million|mn)?(?![\w])/gi;
const unitOf = (u = "") => (/^lakh\s/i.test(u) ? 1e12 : /^(cr|crore)/i.test(u) ? 1e7 : /^(l|lakh|lac)/i.test(u) ? 1e5 : /^(k|thousand)$/i.test(u) ? 1e3 : /^(million|mn)$/i.test(u) ? 1e6 : 1);
const RAISE_KW = /\b(?:rais(?:e|ing)|the ask|ask\s*:|seeking|fundrais\w*)\b[^.]*$/i;
const VAL_KW = /\b(?:valuation|valued|pre-money|post-money)\b[^.]*$/i;
const VAL_AFTER = /^\s*(?:pre|post)-money\b/i;
export function moneyBinding(c: Claim): "raise" | "valuation" | null {
  if (c.value == null || isProjection(c)) return null;
  const ms = [...c.excerpt.matchAll(AMOUNT)];
  const pick = ms
    .map((m, i) => ({ m, i, v: Number(m[1].replace(/,/g, "")) * unitOf(m[2]) }))
    .sort((x, y) => Math.abs(x.v - c.value!) - Math.abs(y.v - c.value!))[0];
  if (!pick || Math.abs(pick.v - c.value) > 0.01 * c.value) return null;
  const start = pick.m.index!;
  const prevEnd = pick.i > 0 ? ms[pick.i - 1].index! + ms[pick.i - 1][0].length : 0;
  // A leading "post-money" belongs to the PREVIOUS amount ("INR 11 Cr post-money Existing investors INR 30 L").
  const before = c.excerpt.slice(Math.max(prevEnd, start - 40), start).replace(/^\W*(?:pre|post)-money\b/i, "");
  const after = c.excerpt.slice(start + pick.m[0].length, start + pick.m[0].length + 14);
  if (VAL_KW.test(before) || VAL_AFTER.test(after)) return "valuation";
  if (RAISE_KW.test(before)) return "raise";
  return null;
}

const DEFINITION_MAX_RATIO = 3;
const NON_EMPLOYEE = /\boutsourc\w*|\bcontract(?:ed|or|ors)?\s+(?:developers?|engineers?|staff|employees?)\b|\bfreelanc\w*|\bpart[- ]time\b|\binterns?\b|\bconsultants?\b/i;

const uniqBy = <T,>(xs: T[], k: (x: T) => string) => [...new Map(xs.map((x) => [k(x), x])).values()];

/**
 * Annotates the existing (scored) conflicts and adds the P3 flag-only checks.
 * `claims` are the effective claims: applicant claims (not withdrawn, not superseded by a human correction)
 * plus active human corrections.
 */
export function finaliseConflicts(appId: string, cycleId: string, scored: Conflict[], claims: Claim[], docKinds: { deck: boolean; form: boolean }): Conflict[] {
  const live = claims.filter(active);
  const metricClaims = (m: string) => live.filter((c) => c.metric === m && c.value != null && !isProjection(c));
  const out: Conflict[] = [];

  // 1. Existing rules: keep exactly; attach relation, every disagreeing value and provenance.
  for (const c of scored) {
    let values: ConflictSide[] = [c.a, c.b];
    if (c.type === "numeric") values = uniqBy([...metricClaims(c.metric)].map(side), (s) => s.claimId);
    out.push({ ...c, relation: RELATION_OF[c.type] ?? "contradiction", values, scoring: "scored" });
  }
  const has = (metric: string) => out.some((c) => c.metric === metric);

  // 2. Single-valued money facts: every distinct value, across AND within documents.
  const money = live.filter((c) => (c.metric === "raise" || c.metric === "valuation") && c.value != null && !isProjection(c));
  const boundTo = (m: string) => money.filter((c) => moneyBinding(c) === m);
  for (const m of ["raise", "valuation"]) {
    const cs = boundTo(m);
    const groups: number[] = [];
    for (const c of cs) if (!groups.some((g) => within(g, c.value!))) groups.push(c.value!);
    if (groups.length < 2) continue;
    if (has(m)) continue; // an existing scored conflict already covers it (its values now list every claim)
    out.push(flag(appId, { type: "numeric", metric: m, relation: "contradiction", severity: "high", label: `${MONEY_METRIC_LABELS[m]}: the documents state ${groups.length} different amounts`, values: cs, note: `Stated amounts: ${groups.map(formatInr).join(" vs ")}. Ask which is current.` }));
  }

  // 3. Possibly updated: a dated figure that differs from other figures for the same metric.
  for (const metric of [...new Set(live.filter((c) => c.asOf && c.value != null && !isProjection(c)).map((c) => c.metric!))]) {
    const dated = live.filter((c) => c.metric === metric && c.asOf && c.value != null);
    const others = live.filter((c) => c.metric === metric && c.value != null && !isProjection(c) && !dated.includes(c));
    const differing = others.filter((o) => dated.every((d) => !within(d.value!, o.value!)));
    if (!dated.length || !differing.length) continue;
    out.push(flag(appId, { type: "update", metric, relation: "possibly_updated", severity: "medium", label: `${metric.startsWith("count:") ? "Count" : MONEY_METRIC_LABELS[metric] ?? metric}: a dated figure (as of ${dated[0].asOf}) differs from other figures`, values: [...dated, ...differing], note: "One document states a figure with an explicit date; it may simply be more recent. Ask which is current rather than treating it as a contradiction." }));
  }

  // 4. Different periods: an annual revenue figure inconsistent with a monthly one × 12 (> 30% apart).
  const fam = /^(revenue|revenue_gross|revenue_net|gmv)$/;
  const annual = live.filter((c) => c.metric && fam.test(c.metric) && c.value != null && !isProjection(c) && c.period !== "monthly" && /\bannual(?:ly|ised|ized)?\b|\bper (?:year|annum)\b|\byearly\b/i.test(c.excerpt));
  const monthly = live.filter((c) => c.metric && fam.test(c.metric) && c.value != null && !isProjection(c) && c.period === "monthly");
  for (const a of annual) {
    const bad = monthly.filter((m) => Math.abs(a.value! - m.value! * 12) / Math.max(a.value!, m.value! * 12) > 0.3);
    if (bad.length && bad.length === monthly.length) {
      out.push(flag(appId, { type: "period", metric: a.metric!, relation: "different_period", severity: "low", label: `${MONEY_METRIC_LABELS[a.metric!]}: annual figure inconsistent with monthly figures`, values: [a, ...bad], note: `Annual ${formatInr(a.value!)} vs monthly ${bad.map((m) => formatInr(m.value!)).join(", ")} (× 12 ≈ ${formatInr(bad[0].value! * 12)}). Different periods; check whether both can be true.` }));
      break;
    }
  }

  // 5. One-sided: the raise appears in only one of the two documents.
  if (docKinds.deck && docKinds.form) {
    const r = boundTo("raise");
    const kinds = new Set(r.map((c) => c.sourceKind));
    if (r.length && kinds.size === 1) out.push(flag(appId, { type: "coverage", metric: "raise", relation: "one_sided", severity: "low", label: `Amount raising stated only in the ${[...kinds][0]}`, values: r, note: "The other document does not state the raise. Information, not a contradiction." }));
  }

  // 6. Facts (identity, roles, dates, stage, location, team size).
  const facts = (k: string) => live.filter((c) => c.fact?.key === k);
  const deckF = (k: string) => facts(k).filter((c) => c.sourceKind === "deck");
  const formF = (k: string) => facts(k).filter((c) => c.sourceKind !== "deck");

  // 6a. Company identity (three outcomes; never merged).
  {
    const d = deckF("company_name"), f = formF("company_name");
    if (d.length && f.length) {
      const outcomes = d.flatMap((x) => f.map((y) => matchCompany(x.fact!.value, y.fact!.value)));
      if (outcomes.every((o) => o === "different")) out.push(flag(appId, { type: "identity", metric: "fact:company_name", relation: "contradiction", severity: "high", label: `Company identity: the deck names "${d[0].fact!.value}", the form names "${f[0].fact!.value}"`, values: [...d, ...f], note: "The documents appear to describe different companies. Not linked to any existing company record; a person must review before relying on either document." }));
      else if (!outcomes.includes("same")) out.push(flag(appId, { type: "identity", metric: "fact:company_name", relation: "possible_match", severity: "medium", label: `Company name may differ: "${d[0].fact!.value}" vs "${f[0].fact!.value}"`, values: [...d, ...f], note: "Abbreviation, partial name or ambiguous similarity. Needs human review; not merged automatically." }));
    }
  }
  // 6b. Founders.
  {
    const d = deckF("founder"), f = formF("founder");
    if (d.length && f.length) {
      const best = (x: Claim) => (f.some((y) => matchPerson(x.fact!.value, y.fact!.value) === "same") ? "same" : f.some((y) => matchPerson(x.fact!.value, y.fact!.value) === "possible") ? "possible" : "different");
      const diff = d.filter((x) => best(x) === "different"), poss = d.filter((x) => best(x) === "possible");
      if (diff.length) out.push(flag(appId, { type: "identity", metric: "fact:founder", relation: "contradiction", severity: "high", label: `Founder names on the deck not on the form: ${diff.map((x) => x.fact!.value).join(", ")}`, values: [...diff, ...f], note: "The deck lists people the form does not. Never merged; confirm who the founders are." }));
      if (poss.length) out.push(flag(appId, { type: "identity", metric: "fact:founder", relation: "possible_match", severity: "medium", label: `Founder names may refer to the same people: ${poss.map((x) => x.fact!.value).join(", ")}`, values: [...poss, ...f], note: "Initials or partial names. Needs human review; not merged automatically." }));
    }
  }
  // 6c. Same person, different role.
  {
    const d = deckF("founder_role"), f = formF("founder_role");
    const split = (c: Claim) => c.fact!.normalized.split("=");
    const pairs = d.flatMap((x) => f.filter((y) => matchPerson(x.fact!.value.split(":")[0], y.fact!.value.split(":")[0]) === "same" && split(x)[1] !== split(y)[1]).map((y) => [x, y] as const));
    if (pairs.length) out.push(flag(appId, { type: "fact", metric: "fact:founder_role", relation: "contradiction", severity: "medium", label: `Founder role differs between deck and form: ${pairs.map(([x, y]) => `${x.fact!.value} / ${y.fact!.value.split(":").slice(1).join(":").trim()}`).join("; ")}`, values: uniqBy(pairs.flat(), (c) => c.id), note: "The same person is given different roles." }));
  }
  // 6d. Founded / incorporated.
  {
    const inc = facts("incorporated"), fnd = facts("founded");
    const incYears = new Set(inc.map((c) => c.fact!.normalized));
    if (incYears.size > 1) out.push(flag(appId, { type: "fact", metric: "fact:incorporated", relation: "contradiction", severity: "medium", label: `Incorporation year differs: ${[...incYears].join(" vs ")}`, values: inc, note: "The same date is stated differently." }));
    const defDiff = fnd.filter((x) => inc.length && inc.every((y) => y.fact!.normalized !== x.fact!.normalized));
    if (defDiff.length) out.push(flag(appId, { type: "fact", metric: "fact:founded", relation: "different_definition", severity: "low", label: `"Founded" ${defDiff[0].fact!.normalized} vs "incorporated" ${inc[0].fact!.normalized}`, values: [...defDiff, ...inc], note: "Founding and incorporation can legitimately differ (a company can operate before it is incorporated). Confirm both dates." }));
  }
  // 6e. Stage, location, team size.
  for (const [key, sev, labelTxt] of [["stage", "high", "Stage"], ["location", "low", "Head-office location"]] as const) {
    const all = facts(key);
    const vals = new Set(all.map((c) => c.fact!.normalized));
    if (vals.size > 1 && all.some((c) => c.sourceKind === "deck") && all.some((c) => c.sourceKind !== "deck")) out.push(flag(appId, { type: "fact", metric: `fact:${key}`, relation: "contradiction", severity: sev, label: `${labelTxt} differs: ${[...new Set(all.map((c) => c.fact!.value))].join(" vs ")}`, values: all, note: `The documents state different ${labelTxt.toLowerCase()} values.` }));
  }
  {
    const all = facts("team_size");
    const nums = all.map((c) => Number(c.fact!.normalized)).filter((n) => n > 0);
    if (nums.length > 1) {
      const lo = Math.min(...nums), hi = Math.max(...nums);
      // A passage that counts non-employees (outsourced, contract, freelance, part-time, interns, consultants) may
      // define "team" differently: a possible definition discrepancy, not a confirmed contradiction — but only while
      // the gap is plausibly a counting difference (larger figure at most DEFINITION_MAX_RATIO × the smaller).
      // A bigger gap stays a contradiction even when non-employees are mentioned.
      const mixed = all.some((c) => NON_EMPLOYEE.test(c.excerpt)) && hi <= DEFINITION_MAX_RATIO * lo;
      if (hi - lo > Math.max(2, 0.2 * hi))
        out.push(
          mixed
            ? flag(appId, { type: "fact", metric: "fact:team_size", relation: "different_definition", severity: "medium", label: `Team size may be counted differently: ${[...new Set(nums)].join(" vs ")}`, values: all, note: "Possible definition discrepancy: one document itemises its headcount including non-employee staff (e.g. outsourced or contract), so the figures may count different people. Not a confirmed contradiction until the founder clarifies." })
            : flag(appId, { type: "fact", metric: "fact:team_size", relation: "contradiction", severity: "medium", label: `Team size differs: ${[...new Set(nums)].join(" vs ")}`, values: all, note: "Headcount is stated differently." }),
        );
    }
  }

  return out.map((c) => ({ ...identify(appId, c, claims), cycleId }));
}

/** Conflicts that may influence scoring (D1): the existing scored rules, not superseded, not flag-only. */
export const scoredConflicts = (conflicts: Conflict[]) => conflicts.filter((c) => c.scoring !== "flag_only" && c.status !== "superseded");
/** Claims the evaluator sees: founder-provided claims only (no facts, no human corrections, nothing withdrawn). */
export const scoringClaims = (claims: Claim[]) => claims.filter((c) => !c.fact && !c.metric?.startsWith("fact:") && !c.withdrawn && c.origin !== "human_correction");
