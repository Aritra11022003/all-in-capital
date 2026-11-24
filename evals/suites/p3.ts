// P3 data-integrity tests (written BEFORE the fix; see docs/P3_DATA_INTEGRITY_PLAN.md).
// Fixtures are the 10 committed seed applications plus constructed one-line edits (labelled per case).
// New P3 fields are read through the loose `P3*` views below so these tests compile before the data model
// changes; once implemented, they read the real fields.
import { vi } from "vitest";
import { processApplication, type ProcessResult } from "@/lib/engine/process";
import { THESIS_V1, CRITERIA_V1 } from "@/config/thesis";
import { PORTFOLIO_V1 } from "@/config/portfolio";
import type { DocInput } from "@/lib/engine/pipeline";
import type { Claim, Conflict } from "@/lib/shared/types";
import { confirmField, editField, latestEvaluation, recheckIntegrity, resolveConflict, restoreScreenedSpan, type WorkspaceData } from "@/lib/domain/workspace";
import { reevaluate } from "@/lib/domain/runner";
import { buildReport, reportToMarkdown } from "@/lib/engine/reports/report";
import { harness, SEED, seedDocs } from "../../tests/helpers";
import { loadBaselineV1, seedSnapshot } from "../baseline/snapshot";
import type { EvalCase, Suite } from "../framework/types";

const NOW = "2026-11-24T10:00:00.000Z";

// ------------------------------------------------------------------ loose views of the proposed P3 fields
type Relation = "contradiction" | "different_period" | "different_definition" | "possibly_updated" | "one_sided";
interface P3Side { claimId?: string; display: string; sourceLabel: string; excerpt: string; page?: number | null; docId?: string; asOf?: string; origin?: string }
type P3Conflict = Omit<Conflict, "status"> & { status: string; relation?: Relation; values?: P3Side[]; key?: string; scoring?: "scored" | "flag_only"; supersededReason?: string; cycleId?: string };
type P3Claim = Claim & { origin?: "applicant" | "human_correction"; correctsClaimIds?: string[]; correctedBy?: string; withdrawn?: boolean };
const conflictsOf = (r: ProcessResult) => r.analysis.conflicts as unknown as P3Conflict[];
const wsConflicts = (d: WorkspaceData, appId: string) => (d.conflicts as unknown as P3Conflict[]).filter((c) => c.applicationId === appId);
const find = (cs: P3Conflict[], metric: RegExp, relation?: Relation) => cs.filter((c) => metric.test(c.metric) && (!relation || c.relation === relation));
const sides = (c: P3Conflict): P3Side[] => c.values ?? [c.a, c.b];
/** Every side must show source, page and the exact passage. */
const provenanceOk = (c: P3Conflict) => sides(c).every((s) => !!s.sourceLabel && typeof s.page === "number" && !!s.excerpt && s.excerpt.length > 3);
const describe = (cs: P3Conflict[]) => (cs.length ? cs.map((c) => `${c.metric}/${c.relation ?? "?"}/${c.scoring ?? "?"}/${c.severity}`).join(", ") : "none");

const run = (docs: DocInput[], name?: string) => processApplication({ applicationId: "p3", cycleId: "p3", actor: "riya", docs, thesis: THESIS_V1, criteria: CRITERIA_V1, portfolio: PORTFOLIO_V1, learningRules: [], now: NOW, nameHint: name });
function addPage(key: string, where: "deck" | "form", text: string, docs = seedDocs(key)): DocInput[] {
  const out = structuredClone(docs);
  const d = out.find((x) => (where === "deck") === /deck/i.test(x.filename))!;
  d.pages.push({ index: d.pages[d.pages.length - 1].index + 1, text });
  d.sha256 = `${d.sha256}-p3`;
  return out;
}
const flagOnly = (cs: P3Conflict[]) => cs.length > 0 && cs.every((c) => c.scoring === "flag_only");

const cases: EvalCase<never>[] = [];
const add = <O,>(c: EvalCase<O>) => cases.push(c as unknown as EvalCase<never>);

/** Standard shape for "edit one seed, expect a new flag-only conflict of a given relation". */
function edited(id: string, title: string, key: string, where: "deck" | "form", text: string, metric: RegExp, relation: Relation, severity: "high" | "medium" | "low", extra?: EvalCase<{ base: ProcessResult; att: ProcessResult }>["assertions"]) {
  add<{ base: ProcessResult; att: ProcessResult }>({
    id,
    version: 1,
    suite: "data-integrity",
    category: relation,
    title,
    input: `Constructed fixture: ${key} ${where} + appended page: "${text.replace(/\n/g, " / ")}"`,
    expected: `A ${relation.replace(/_/g, " ")} conflict on ${metric.source} (severity ${severity}), flag-only, every side with source, page and exact passage; recommendation and scores unchanged.`,
    run: async () => ({ base: await run(seedDocs(key), key), att: await run(addPage(key, where, text), key) }),
    assertions: [
      { id: "detected", description: `Conflict on ${metric.source} with relation '${relation}'`, kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.att), metric, relation); return { pass: c.length > 0, actual: c.length ? describe(c) : `not detected (all: ${describe(conflictsOf(o.att))})` }; } },
      { id: "severity", description: `Severity is ${severity}`, kind: "hard", judge: "code", severity: "low", check: (o) => { const c = find(conflictsOf(o.att), metric, relation); return { pass: c.some((x) => x.severity === severity), actual: c.map((x) => x.severity).join(",") || "n/a" }; } },
      { id: "flag-only", description: "New conflict is flag-only (no score effect)", kind: "hard", judge: "code", severity: "critical", check: (o) => { const c = find(conflictsOf(o.att), metric, relation); return { pass: flagOnly(c), actual: c.length ? c.map((x) => x.scoring ?? "unset").join(",") : "no conflict" }; } },
      { id: "provenance", description: "Every side shows source, page and exact passage", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.att), metric, relation); return { pass: c.length > 0 && c.every(provenanceOk), actual: c.length ? c.map((x) => sides(x).map((s) => `${s.sourceLabel}/p${s.page ?? "?"}/${s.excerpt ? "excerpt" : "no-excerpt"}`).join(" vs ")).join("; ") : "no conflict" }; } },
      { id: "no-score-change", description: "Recommendation and every criterion score unchanged by the new conflict", kind: "hard", judge: "code", severity: "critical", check: (o) => { const s = (r: ProcessResult) => JSON.stringify([r.evaluation.recommendation, r.evaluation.assessments.map((a) => a.score)]); return { pass: s(o.base) === s(o.att), actual: s(o.base) === s(o.att) ? "unchanged" : `${o.base.evaluation.recommendation} → ${o.att.evaluation.recommendation}` }; } },
      ...(extra ?? []),
    ],
  });
}

// ------------------------------------------------------------------ DI-01 identity: mixed documents (closes APP-ID-02)
add<ProcessResult>({
  id: "DI-01",
  version: 1,
  suite: "data-integrity",
  category: "contradiction",
  title: "Deck and form name different companies",
  input: "Constructed: Pumpwise deck + CAPilot form submitted as one application.",
  expected: "Company-identity contradiction (high, flag-only) with both names, pages and passages; an identity warning on the application; no silent merge.",
  run: () => run([...seedDocs("Pumpwise", (f) => /deck/i.test(f.filename)), ...seedDocs("CAPilot", (f) => !/deck/i.test(f.filename))]),
  assertions: [
    { id: "detected", description: "fact:company_name contradiction", kind: "hard", judge: "code", severity: "high", check: (r) => { const c = find(conflictsOf(r), /^fact:company_name$/, "contradiction"); return { pass: c.length === 1, actual: describe(c) }; } },
    { id: "both-names", description: "Both company names appear as separate sides", kind: "hard", judge: "code", severity: "high", check: (r) => { const c = find(conflictsOf(r), /^fact:company_name$/)[0]; const t = c ? sides(c).map((s) => s.display).join(" | ") : ""; return { pass: /Pumpwise/i.test(t) && /CAPilot/i.test(t), actual: t || "no conflict" }; } },
    { id: "provenance", description: "Each side has source, page and passage", kind: "hard", judge: "code", severity: "high", check: (r) => { const c = find(conflictsOf(r), /^fact:company_name$/); return { pass: c.length > 0 && c.every(provenanceOk), actual: c.length ? sides(c[0]).map((s) => `${s.sourceLabel}/p${s.page}`).join(" vs ") : "none" }; } },
    { id: "warned", description: "Application warning names an identity mismatch", kind: "hard", judge: "code", severity: "high", check: (r) => ({ pass: r.analysis.warnings.some((w) => /identity|different compan/i.test(w)), actual: r.analysis.warnings.filter((w) => /identity|compan/i.test(w)).join(" | ") || "no identity warning" }) },
    { id: "flag-only", description: "Flag-only", kind: "hard", judge: "code", severity: "critical", check: (r) => { const c = find(conflictsOf(r), /^fact:company_name$/); return { pass: flagOnly(c), actual: c.map((x) => x.scoring ?? "unset").join(",") || "none" }; } },
  ],
});

// ------------------------------------------------------------------ DI-02 … DI-12 one-line edits
edited("DI-02", "Founder names on the deck's team slide differ from the form", "GrainKind", "deck", "Team\nRohan Mehta, CEO. 9 years at a dairy company.\nKavya Iyer, COO.", /^fact:founder$/, "contradiction", "high");
edited("DI-03", "Same founder, different role", "Talkbook", "deck", "Team\nMeenakshi S, CEO.", /^fact:founder_role$/, "contradiction", "medium");
edited("DI-04", "Amount raising differs (deck says ₹4 Cr; deck and form elsewhere say ₹1.5 Cr)", "CAPilot", "deck", "The ask\nRaising INR 4 Cr seed round.", /^raise$/, "contradiction", "high", [
  { id: "all-values", description: "Conflict lists every distinct value (₹4 Cr and ₹1.5 Cr), not just the first pair", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.att), /^raise$/)[0]; const v = c ? sides(c).map((s) => s.display).join(" | ") : ""; return { pass: /4 Cr/.test(v) && /1\.5 Cr/.test(v), actual: v || "no conflict" }; } },
]);
edited("DI-06b", "Incorporation year differs (same term on both sides)", "CAPilot", "deck", "Company\nIncorporated in 2019 in Pune.", /^fact:incorporated$/, "contradiction", "medium");
edited("DI-06a", "'Founded' in the deck vs 'incorporated' in the form", "CAPilot", "deck", "Company\nFounded in 2019 in Pune.", /^fact:(founded|incorporated)$/, "different_definition", "low");
edited("DI-07", "Stage differs (Series A vs Pre-seed)", "CAPilot", "deck", "Round\nSeries A round, first close in December.", /^fact:stage$/, "contradiction", "high");
edited("DI-08", "Newer, dated count differs from the form", "CAPilot", "deck", "Traction update\nAs of November 2026: 45 paying firms.", /^count:firm\|paying$/, "possibly_updated", "medium", [
  { id: "as-of-shown", description: "The dated side carries its 'as of' date", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.att), /^count:firm\|paying$/, "possibly_updated")[0]; const s = c ? sides(c).find((x) => /45/.test(x.display)) : undefined; return { pass: !!s?.asOf && /2026-11|November 2026/i.test(s.asOf), actual: s ? `asOf=${s.asOf ?? "missing"}` : "no conflict" }; } },
  { id: "original-kept", description: "The existing 31-vs-24 contradiction is still reported as a contradiction", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.att), /^count:firm\|paying$/, "contradiction"); return { pass: c.length >= 1, actual: describe(c) }; } },
]);
edited("DI-09b", "Annual revenue inconsistent with monthly revenue ×12", "CareCorner", "deck", "Revenue\nAnnual revenue INR 6 Cr across clinics.", /^(revenue|arr|mrr)$/, "different_period", "low");
edited("DI-12a", "Team size differs", "CareCorner", "deck", "Team\nTeam size 60, including 12 doctors.", /^fact:team_size$/, "contradiction", "medium");
// DI-18: a non-employee mention ("2 contract developers" on the RentRoute form) must not soften a 10× headcount gap.
edited("DI-18", "Large team-size gap stays a contradiction despite contract staff", "RentRoute", "deck", "Team\nTeam of 40.", /^fact:team_size$/, "contradiction", "medium");
edited("DI-12b", "Head-office location differs", "CareCorner", "deck", "HQ\nHeadquartered in Mumbai, Maharashtra.", /^fact:location$/, "contradiction", "low");

// DI-05: existing valuation detection is preserved AND keeps its existing (scored) behaviour.
add<{ base: ProcessResult; att: ProcessResult }>({
  id: "DI-05",
  version: 1,
  suite: "data-integrity",
  category: "contradiction",
  title: "Existing valuation conflict detection is preserved unchanged",
  input: 'Constructed fixture: CAPilot deck + appended page: "Terms / Valuation INR 40 Cr post-money."',
  expected: "Numeric valuation conflict still detected, still scored as before (existing rule), recommendation as before P3 (request info).",
  run: async () => ({ base: await run(seedDocs("CAPilot"), "CAPilot"), att: await run(addPage("CAPilot", "deck", "Terms\nValuation INR 40 Cr post-money."), "CAPilot") }),
  assertions: [
    { id: "still-detected", description: "Valuation conflict present", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.att), /^valuation$/); return { pass: c.length === 1, actual: describe(c) }; } },
    { id: "still-scored", description: "Existing rule keeps its scoring (not flag-only) and the pre-P3 outcome (request info)", kind: "hard", judge: "code", severity: "critical", check: (o) => { const c = find(conflictsOf(o.att), /^valuation$/)[0]; return { pass: !!c && c.scoring !== "flag_only" && o.att.evaluation.recommendation === "request_info", actual: `${c?.scoring ?? "unset"}; ${o.att.evaluation.recommendation}` }; } },
  ],
});

// DI-09a / DI-10: precision — consistent periods and equivalent units are NOT conflicts.
add<{ base: ProcessResult; att: ProcessResult; unit: ProcessResult }>({
  id: "DI-09a",
  version: 1,
  suite: "data-integrity",
  category: "precision",
  title: "Consistent periods and equivalent units raise nothing",
  input: 'Constructed: CareCorner deck + "Annual revenue INR 1.2 Cr across clinics." (≈ ₹9.8 L × 12); CAPilot deck + "Raising INR 150 L." (= ₹1.5 Cr).',
  expected: "No new conflict of any kind.",
  run: async () => ({ base: await run(seedDocs("CareCorner"), "CareCorner"), att: await run(addPage("CareCorner", "deck", "Revenue\nAnnual revenue INR 1.2 Cr across clinics."), "CareCorner"), unit: await run(addPage("CAPilot", "deck", "The ask\nRaising INR 150 L."), "CAPilot") }),
  assertions: [
    { id: "period-consistent", description: "DI-09a: annual ≈ 12 × monthly gives no conflict", kind: "hard", judge: "code", severity: "high", check: (o) => { const n = conflictsOf(o.att).length - conflictsOf(o.base).length; return { pass: n === 0, actual: `${n} new` }; } },
    { id: "unit-equivalent", description: "DI-10: ₹150 L vs ₹1.5 Cr gives no raise conflict", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.unit), /^raise$/); return { pass: c.length === 0, actual: describe(c) }; } },
  ],
});

// DI-11: within-document contradiction on a single-valued fact (deck only), and no flags on time series.
add<{ deckOnly: ProcessResult; series: ProcessResult[] }>({
  id: "DI-11",
  version: 1,
  suite: "data-integrity",
  category: "contradiction",
  title: "A document that contradicts itself on a single-valued fact",
  input: 'Constructed: CAPilot deck only (no form) + appended "Raising INR 4 Cr seed round."; plus the unedited GrainKind, Pumpwise and StockSathi seeds (month-by-month series).',
  expected: "Deck-internal raise contradiction flagged with both deck pages; no within-document flags on time-series metrics.",
  run: async () => ({ deckOnly: await run(addPage("CAPilot", "deck", "The ask\nRaising INR 4 Cr seed round.", seedDocs("CAPilot", (f) => /deck/i.test(f.filename))), "CAPilot"), series: await Promise.all(["GrainKind", "Pumpwise", "StockSathi"].map((k) => run(seedDocs(k), k))) }),
  assertions: [
    { id: "within-doc", description: "Raise conflict whose sides are all on the deck", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.deckOnly), /^raise$/, "contradiction")[0]; return { pass: !!c && sides(c).every((s) => /^Deck/.test(s.sourceLabel)) && new Set(sides(c).map((s) => s.page)).size >= 2, actual: c ? sides(c).map((s) => `${s.sourceLabel}`).join(" vs ") : "not detected" }; } },
    { id: "no-series-flags", description: "No within-document conflict on revenue/count series in the seeds", kind: "hard", judge: "code", severity: "high", check: (o) => { const w = o.series.flatMap((r) => conflictsOf(r).filter((c) => sides(c).every((s) => /^Deck/.test(s.sourceLabel)) && /^(revenue|mrr|count:|cac|price)/.test(c.metric))); return { pass: w.length === 0, actual: w.length ? describe(w) : "none" }; } },
  ],
});

// DI-13: human edit and P2 restoration re-run detection; originals and corrections kept separately.
add({
  id: "DI-13",
  version: 1,
  suite: "data-integrity",
  category: "recheck",
  title: "Human correction re-runs detection; original claim and correction are kept separately",
  input: "CAPilot through the job runner; Riya edits the form's customer answer to '31 paying CA firms'; re-evaluated.",
  expected: "Original founder claim (24) unchanged with provenance; a separate human-correction claim records who/when; the 31-vs-24 conflict is superseded (history kept, reason given); audited.",
  run: async () => {
    const h = harness();
    await h.load([{ key: "cap", label: "CAPilot", docs: seedDocs("CAPilot"), failures: [], duplicates: [] }]);
    const appId = h.d.applications[0].id;
    const before = structuredClone(h.d.claims.filter((c) => c.applicationId === appId));
    const conf0 = wsConflicts(h.d, appId).filter((c) => /paying/.test(c.metric));
    const field = h.d.fields.find((f) => f.applicationId === appId && f.field === "customers")!;
    h.mutate((d) => editField(d, "riya", field.id, "31 paying CA firms"));
    await reevaluate(h.mutate, h.read, appId, "riya");
    return { d: h.d, appId, before, conf0, fieldId: field.id };
  },
  assertions: [
    { id: "original-kept", description: "Every original founder claim still present and unchanged", kind: "hard", judge: "code", severity: "critical", check: (o) => { const now = o.d.claims; const missing = o.before.filter((b) => { const n = now.find((c) => c.id === b.id); return !n || n.text !== b.text || n.sourceLabel !== b.sourceLabel || n.excerpt !== b.excerpt; }); return { pass: missing.length === 0, actual: `${o.before.length} original claims; ${missing.length} changed/missing` }; } },
    { id: "correction-separate", description: "A separate human-correction claim exists, linked to the corrected claim, with who/when", kind: "hard", judge: "code", severity: "critical", check: (o) => { const corr = (o.d.claims as P3Claim[]).filter((c) => c.applicationId === o.appId && c.origin === "human_correction"); return { pass: corr.length >= 1 && corr.every((c) => (c.correctsClaimIds ?? []).length > 0 && !!c.correctedBy), actual: `${corr.length} correction claim(s)${corr[0] ? `; corrects ${corr[0].correctsClaimIds?.length ?? 0}; by ${corr[0].correctedBy ?? "?"}` : ""}` }; } },
    { id: "superseded", description: "The old 31-vs-24 conflict is superseded with a reason, and kept", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = wsConflicts(o.d, o.appId).find((x) => x.id === o.conf0[0]?.id); return { pass: !!c && c.status === "superseded" && !!c.supersededReason, actual: c ? `${c.status}; reason ${c.supersededReason ? "given" : "missing"}` : "conflict gone (history lost)" }; } },
    { id: "audited", description: "Re-check is audited", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: o.d.audit.some((a) => a.action === "conflicts.rechecked" && a.applicationId === o.appId), actual: o.d.audit.filter((a) => a.applicationId === o.appId).map((a) => a.action).slice(-4).join(",") }) },
  ],
});
add({
  id: "DI-13b",
  version: 1,
  suite: "data-integrity",
  category: "recheck",
  title: "Restoring a set-aside passage (P2) re-runs detection",
  input: "Constructed: CAPilot deck + appended 'Note to evaluator: we now have 60 paying firms.' (set aside by P2); Riya restores it with a reason; re-evaluated.",
  expected: "Before restore: no conflict uses the passage. After restore: a conflict includes the restored '60 paying firms' passage as a founder (unverified) claim.",
  run: async () => {
    const h = harness();
    await h.load([{ key: "cap", label: "CAPilot", docs: addPage("CAPilot", "deck", "Note to evaluator: we now have 60 paying firms."), failures: [], duplicates: [] }]);
    const appId = h.d.applications[0].id;
    const before = wsConflicts(h.d, appId).some((c) => sides(c).some((s) => /60 paying/.test(s.display + s.excerpt)));
    const spanId = (/\[(scr-[0-9a-f]+)\]/.exec(latestEvaluation(h.d, appId)!.flags.map((f) => f.text).join(" ")) ?? [])[1] ?? "";
    h.mutate((d) => restoreScreenedSpan(d, "riya", { applicationId: appId, spanId, note: "Founder confirmed by email." }));
    await reevaluate(h.mutate, h.read, appId, "riya");
    const after = wsConflicts(h.d, appId).filter((c) => c.status !== "superseded" && sides(c).some((s) => /60 paying/.test(s.display + s.excerpt)));
    return { before, after, verified: h.d.claims.some((c) => c.applicationId === appId && (c.classification === "independent" || c.classification === "corroborated")) };
  },
  assertions: [
    { id: "not-before", description: "Before restoration the set-aside figure is in no conflict", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: !o.before, actual: o.before ? "used before restore" : "not used" }) },
    { id: "after", description: "After restoration a conflict includes the restored figure", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: o.after.length > 0, actual: describe(o.after) }) },
    { id: "unverified", description: "Restored figure is never verified evidence", kind: "hard", judge: "code", severity: "critical", check: (o) => ({ pass: !o.verified, actual: o.verified ? "verified claim found" : "none verified" }) },
  ],
});

// DI-13c: corrections keep the right editor and time. Confirming a correction changes nothing; a second edit by
// another reviewer creates a NEW correction (their identity and time) linked to the earlier one, which is kept.
// Time is controlled with fixed instants (Date only), so the result is deterministic.
const T = { load: "2026-11-24T09:00:00.000Z", riya: "2026-11-24T09:10:00.000Z", confirm: "2026-11-24T09:20:00.000Z", other: "2026-11-24T09:30:00.000Z", kushal: "2026-11-24T09:40:00.000Z" };
add({
  id: "DI-13c",
  version: 2,
  suite: "data-integrity",
  category: "recheck",
  title: "Corrections keep the right editor and time: confirming changes nothing; a second edit is a new, linked correction",
  input: "CAPilot through the runner at fixed times. 09:10 Riya edits customers to '31 paying CA firms' (UI edit flow); 09:20 Kushal calls confirmField on it; 09:30 Riya edits location (another re-check) and re-evaluates; 09:40 Kushal edits customers to '35 paying CA firms'.",
  expected: "Confirm creates no correction and changes no timestamp. Kushal's edit creates new correction records (Kushal, 09:40) linked to Riya's (Riya, 09:10), which are kept unchanged. The 31-vs-24 conflict's superseded reason credits Riya at 09:10. Founder claims unchanged throughout.",
  run: async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(T.load));
      const h = harness();
      await h.load([{ key: "cap", label: "CAPilot", docs: seedDocs("CAPilot"), failures: [], duplicates: [] }]);
      const appId = h.d.applications[0].id;
      const originals = structuredClone(h.d.claims.filter((c) => c.applicationId === appId));
      const field = h.d.fields.find((f) => f.applicationId === appId && f.field === "customers")!;
      const conflictId = wsConflicts(h.d, appId).find((c) => /paying/.test(c.metric))!.id;
      const corrOf = () => structuredClone((h.d.claims as P3Claim[]).filter((c) => c.applicationId === appId && c.origin === "human_correction" && c.fieldId === field.id));
      vi.setSystemTime(new Date(T.riya));
      h.mutate((d) => editField(d, "riya", field.id, "31 paying CA firms"));
      const riyaCorr = corrOf();
      const reason0 = wsConflicts(h.d, appId).find((c) => c.id === conflictId)!.supersededReason;
      vi.setSystemTime(new Date(T.confirm));
      h.mutate((d) => confirmField(d, "kushal", field.id));
      const afterConfirm = corrOf();
      vi.setSystemTime(new Date(T.other));
      const loc = h.d.fields.find((f) => f.applicationId === appId && f.field === "location")!;
      h.mutate((d) => editField(d, "riya", loc.id, `${loc.value ?? ""} (office)`));
      await reevaluate(h.mutate, h.read, appId, "riya");
      const f1 = structuredClone(h.d.fields.find((x) => x.id === field.id)!);
      const afterRecheck = corrOf();
      vi.setSystemTime(new Date(T.kushal));
      h.mutate((d) => editField(d, "kushal", field.id, "35 paying CA firms"));
      const afterKushal = corrOf();
      return { d: h.d, appId, originals, f1, riyaCorr, afterConfirm, afterRecheck, afterKushal, reason0, conflict: wsConflicts(h.d, appId).find((c) => c.id === conflictId)! };
    } finally {
      vi.useRealTimers();
    }
  },
  assertions: [
    { id: "first-correction", description: "Riya's correction records Riya and her edit time (09:10)", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: o.riyaCorr.length > 0 && o.riyaCorr.every((c) => c.correctedBy === "riya" && (c as Claim).correctedAt === T.riya), actual: o.riyaCorr.map((c) => `${c.correctedBy}@${(c as Claim).correctedAt}`).join(", ") || "none" }) },
    { id: "confirm-no-new-correction", description: "Confirming the correction creates no correction and changes no record or timestamp", kind: "hard", judge: "code", severity: "critical", check: (o) => ({ pass: JSON.stringify(o.afterConfirm) === JSON.stringify(o.riyaCorr), actual: `${o.riyaCorr.length} → ${o.afterConfirm.length} record(s); ${JSON.stringify(o.afterConfirm) === JSON.stringify(o.riyaCorr) ? "identical" : "CHANGED"}` }) },
    { id: "ui-confirm-hidden", description: "The UI's Confirm action is not offered on a corrected field (page shows it only when validation is 'parsed')", kind: "hard", judge: "code", severity: "low", check: (o) => ({ pass: o.f1.validation !== "parsed", actual: `validation ${o.f1.validation}` }) },
    { id: "field-kept", description: "After confirm and an unrelated re-check, the field stays human-edited by Riya with the founder's original value kept", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: o.f1.validation === "human_edited" && o.f1.editedBy === "riya" && !!o.f1.originalValue && /24 paying/.test(o.f1.originalValue), actual: `${o.f1.validation} by ${o.f1.editedBy}; original ${o.f1.originalValue ? "kept" : "lost"}` }) },
    { id: "correction-kept", description: "An unrelated re-check keeps Riya's correction records unchanged (same ids, editor, time)", kind: "hard", judge: "code", severity: "critical", check: (o) => ({ pass: JSON.stringify(o.afterRecheck) === JSON.stringify(o.riyaCorr), actual: JSON.stringify(o.afterRecheck) === JSON.stringify(o.riyaCorr) ? `${o.riyaCorr.length} record(s) unchanged` : "CHANGED" }) },
    { id: "second-correction", description: "Kushal's edit creates new correction records with Kushal and his edit time (09:40), linked to Riya's", kind: "hard", judge: "code", severity: "critical", check: (o) => { const riyaIds = new Set(o.riyaCorr.map((c) => c.id)); const k = o.afterKushal.filter((c) => !riyaIds.has(c.id)); const ok = k.length > 0 && k.every((c) => c.correctedBy === "kushal" && (c as Claim).correctedAt === T.kushal && !c.withdrawn && /35 paying/.test(c.text) && o.riyaCorr.every((r) => ((c as Claim).supersedesCorrectionIds ?? []).includes(r.id))); return { pass: ok, actual: k.map((c) => `${c.correctedBy}@${(c as Claim).correctedAt} links ${((c as Claim).supersedesCorrectionIds ?? []).length}`).join(", ") || "no new record" }; } },
    { id: "history-kept", description: "Riya's correction records still exist and are byte-for-byte unchanged after Kushal's edit", kind: "hard", judge: "code", severity: "critical", check: (o) => { const now = o.riyaCorr.map((r) => o.afterKushal.find((c) => c.id === r.id)); const ok = now.every((c, i) => !!c && JSON.stringify(c) === JSON.stringify(o.riyaCorr[i])); return { pass: ok, actual: ok ? `${o.riyaCorr.length} Riya record(s) kept unchanged` : "Riya's records changed or missing" }; } },
    { id: "superseded-reason", description: "The 31-vs-24 conflict's superseded reason credits the correction that superseded it: Riya at 09:10", kind: "hard", judge: "code", severity: "high", check: (o) => { const r = o.conflict.supersededReason ?? ""; return { pass: o.conflict.status === "superseded" && r.includes(`by Riya at ${T.riya}`) && !/Kushal/.test(r) && r === o.reason0, actual: r.slice(0, 110) || o.conflict.status }; } },
    { id: "originals-kept", description: "Every founder claim still present and unchanged after both edits", kind: "hard", judge: "code", severity: "critical", check: (o) => { const bad = o.originals.filter((b) => { const n = o.d.claims.find((c) => c.id === b.id); return !n || n.text !== b.text || n.excerpt !== b.excerpt || n.sourceLabel !== b.sourceLabel; }); return { pass: bad.length === 0, actual: `${bad.length} changed/missing of ${o.originals.length}` }; } },
    { id: "audited", description: "Kushal's confirmation is audited without replacing the editor; both edits are audited with their own actor and time", kind: "hard", judge: "code", severity: "high", check: (o) => { const conf = o.d.audit.find((x) => x.action === "extraction.confirmed" && x.actor === "kushal" && x.applicationId === o.appId); const edits = o.d.audit.filter((x) => x.action === "extraction.edited" && x.applicationId === o.appId && /Customers/.test(x.detail)).map((x) => `${x.actor}@${x.at}`); const ok = !!conf && /correction/.test(conf.detail) && /Riya/.test(conf.detail) && edits.includes(`riya@${T.riya}`) && edits.includes(`kushal@${T.kushal}`); return { pass: ok, actual: `confirm ${conf ? "audited" : "missing"}; edits ${edits.join(", ")}` }; } },
  ],
});

// DI-19: recheckIntegrity enforces the permission model itself.
add({
  id: "DI-19",
  version: 1,
  suite: "data-integrity",
  category: "recheck",
  title: "Integrity re-checks are authorised inside recheckIntegrity",
  input: "CAPilot through the runner; recheckIntegrity called directly by Aditya (no extraction.edit, no screening.restore), then by Riya and by Kushal.",
  expected: "Aditya refused with a PermissionError and the workspace unchanged (no claims, conflicts or audit events); Riya and Kushal allowed, each audited as conflicts.rechecked under their own name.",
  run: async () => {
    const h = harness();
    await h.load([{ key: "cap", label: "CAPilot", docs: seedDocs("CAPilot"), failures: [], duplicates: [] }]);
    const appId = h.d.applications[0].id;
    // Called directly on a copy (not through the harness, which would discard a failed mutation anyway).
    const copy = structuredClone(h.d);
    const before = JSON.stringify(copy);
    let refused = "allowed";
    try { recheckIntegrity(copy, "aditya", appId, "direct call"); } catch (e) { refused = `${(e as Error).name}: ${(e as Error).message}`; }
    const unchanged = JSON.stringify(copy) === before;
    const allowed: string[] = [];
    for (const r of ["riya", "kushal"] as const) { try { h.mutate((d) => recheckIntegrity(d, r, appId, "direct call")); allowed.push(r); } catch { /* recorded as not allowed */ } }
    const audited = h.d.audit.filter((a) => a.action === "conflicts.rechecked" && a.applicationId === appId).map((a) => a.actor);
    return { refused, unchanged, allowed, audited };
  },
  assertions: [
    { id: "unauthorised-refused", description: "A role without extraction.edit or screening.restore is refused with a PermissionError", kind: "hard", judge: "code", severity: "critical", check: (o) => ({ pass: o.refused.startsWith("PermissionError"), actual: o.refused.slice(0, 100) }) },
    { id: "refusal-no-side-effects", description: "A refused re-check changes nothing and writes no audit event", kind: "hard", judge: "code", severity: "critical", check: (o) => ({ pass: o.unchanged, actual: o.unchanged ? "workspace unchanged" : "workspace CHANGED" }) },
    { id: "authorised-audited", description: "Riya and Kushal can re-check; each run is audited under their own name", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: o.allowed.join(",") === "riya,kushal" && o.audited.includes("riya") && o.audited.includes("kushal"), actual: `allowed ${o.allowed.join(",") || "none"}; audited ${o.audited.join(",") || "none"}` }) },
  ],
});

// DI-14: resolutions carry over by stable identity and appear in the report.
add({
  id: "DI-14",
  version: 1,
  suite: "data-integrity",
  category: "carry-over",
  title: "A reviewer's resolution survives re-checks and re-scoring, and is in the report",
  input: "CAPilot through the runner; Riya marks the 31-vs-24 conflict 'explained' with a note; an unrelated field (location) is then edited (triggering a re-check) and the application re-scored.",
  expected: "Same conflict ID, status 'explained' and note kept; the report shows relation, status and note.",
  run: async () => {
    const h = harness();
    await h.load([{ key: "cap", label: "CAPilot", docs: seedDocs("CAPilot"), failures: [], duplicates: [] }]);
    const appId = h.d.applications[0].id;
    const c = wsConflicts(h.d, appId).find((x) => /paying/.test(x.metric))!;
    h.mutate((d) => resolveConflict(d, "riya", c.id, "explained", "Deck is newer; founder confirmed 31 is current."));
    const loc = h.d.fields.find((f) => f.applicationId === appId && f.field === "location")!;
    h.mutate((d) => editField(d, "riya", loc.id, `${loc.value ?? ""} (verified address)`));
    await reevaluate(h.mutate, h.read, appId, "riya");
    return { c, after: wsConflicts(h.d, appId).find((x) => x.id === c.id), md: reportToMarkdown(buildReport(h.d, appId)) };
  },
  assertions: [
    { id: "stable-and-kept", description: "Same conflict ID still explained with its note", kind: "hard", judge: "code", severity: "critical", check: (o) => ({ pass: o.after?.status === "explained" && !!o.after.resolutionNote, actual: o.after ? `${o.after.status}; note ${o.after.resolutionNote ? "kept" : "lost"}` : "conflict ID changed or lost" }) },
    { id: "in-report", description: "Report shows the relation, status and resolution note", kind: "hard", judge: "code", severity: "high", check: (o) => ({ pass: /explained/i.test(o.md) && /founder confirmed 31 is current/i.test(o.md) && /contradiction/i.test(o.md), actual: `status ${/explained/i.test(o.md)}; note ${/founder confirmed 31/i.test(o.md)}; relation ${/contradiction/i.test(o.md)}` }) },
  ],
});

// DI-15: one-sided information is recorded as information, not a contradiction.
const ONE_FORM: DocInput = { filename: "OneSided_Form.txt", kind: "form", method: "txt", sha256: "eval-one-form", size: 200, pages: [{ index: 1, text: "Company name One Sided Co (One Sided Pvt. Ltd.)\nSector (as selected) Fintech\nStage (as selected) Pre-seed\nAmount raising INR 2 Cr" }] };
const ONE_DECK: DocInput = { filename: "OneSided_Deck.txt", kind: "deck", method: "txt", sha256: "eval-one-deck", size: 120, pages: [{ index: 1, text: "One Sided Co\nPayments for small shops" }, { index: 2, text: "Traction\n40 paying shops." }] };
add<ProcessResult>({
  id: "DI-15",
  version: 1,
  suite: "data-integrity",
  category: "one_sided",
  title: "A key fact stated in only one document",
  input: "Constructed: a form that states the raise and a deck that does not.",
  expected: "Raise recorded as one-sided information (low, flag-only), never as a contradiction.",
  run: () => run([ONE_DECK, ONE_FORM], "One Sided Co"),
  assertions: [
    { id: "one-sided", description: "Raise marked one-sided", kind: "hard", judge: "code", severity: "high", check: (r) => { const c = find(conflictsOf(r), /^raise$/, "one_sided"); return { pass: c.length === 1 && flagOnly(c), actual: describe(conflictsOf(r)) }; } },
    { id: "not-contradiction", description: "No contradiction on the raise", kind: "hard", judge: "code", severity: "high", check: (r) => ({ pass: find(conflictsOf(r), /^raise$/, "contradiction").length === 0, actual: describe(find(conflictsOf(r), /^raise$/, "contradiction")) }) },
  ],
});

// DI-16: seed precision — decisions and scores identical; every new seed conflict is flag-only and listed for review.
add({
  id: "DI-16",
  version: 1,
  suite: "data-integrity",
  category: "seed-precision",
  title: "No decision or score change on the 10 seed applications; new seed conflicts listed for human review",
  input: "All 10 seed applications vs the frozen pre-P2 baseline (scores/recommendations) and the pre-P3 conflict lists.",
  expected: "Recommendations, overall and criterion scores identical; every conflict not in the baseline is flag-only; the list of new conflicts is reported for review.",
  run: async () => ({ now: await seedSnapshot(), base: loadBaselineV1().apps, conflicts: await Promise.all(SEED.map(async (s) => [s.key, conflictsOf(await run(seedDocs(s.key), s.key))] as const)) }),
  assertions: [
    { id: "decisions-identical", description: "Recommendation, overall and criterion scores identical to the baseline", kind: "hard", judge: "code", severity: "critical", check: (o) => { const k = (a: { recommendation: string; overall: number | null; criteria: Record<string, { score: number | null }> }) => JSON.stringify([a.recommendation, a.overall, Object.values(a.criteria).map((x) => x.score)]); const diff = Object.keys(o.base).filter((x) => k(o.now[x]) !== k(o.base[x])); return { pass: diff.length === 0, actual: diff.length ? `changed: ${diff.join(",")}` : "10/10 identical" }; } },
    { id: "new-are-flag-only", description: "Every conflict not present before P3 is flag-only", kind: "hard", judge: "code", severity: "critical", check: (o) => { const bad: string[] = []; for (const [k, cs] of o.conflicts) for (const c of cs) { const old = o.base[k].conflicts.some((b) => b.startsWith(`${c.type}|${c.metric}|`)); if (!old && c.scoring !== "flag_only") bad.push(`${k}:${c.metric}`); } return { pass: bad.length === 0, actual: bad.length ? bad.join(", ") : "all new conflicts flag-only" }; } },
    { id: "review-list", description: "List of new seed conflicts (for human review before any re-baseline)", kind: "soft", judge: "human", severity: "high", rubric: "Is each newly detected seed conflict a genuine inconsistency in the committed seed documents (not an extraction error)?", reviewMaterial: (o) => o.conflicts.flatMap(([k, cs]) => cs.filter((c) => !o.base[k].conflicts.some((b) => b.startsWith(`${c.type}|${c.metric}|`))).map((c) => `${k}: ${c.metric} ${c.relation ?? ""} — ${sides(c).map((s) => `${s.display} [${s.sourceLabel}]`).join(" vs ")}`)).join("\n") },
  ],
});

// DI-17: the two seed findings approved for the v2 baseline keep their approved classification.
add<{ ew: ProcessResult; ya: ProcessResult }>({
  id: "DI-17",
  version: 1,
  suite: "data-integrity",
  category: "seed-precision",
  title: "Approved seed findings keep their approved classification (EarnWise team size, Yatrika raise)",
  input: "Seed EarnWise (form 'Team size 5 (founder, 2 outsourced developers, …)' vs deck 'Team of 12.') and seed Yatrika (form 'Amount raising INR 1.2 Cr'; deck states no amount).",
  expected: "EarnWise: possible definition discrepancy, medium, flag-only, not a contradiction. Yatrika: one-sided, low, flag-only, not a contradiction. Neither changes a score or recommendation.",
  run: async () => ({ ew: await run(seedDocs("EarnWise"), "EarnWise"), ya: await run(seedDocs("Yatrika"), "Yatrika") }),
  assertions: [
    { id: "earnwise-definition", description: "EarnWise team size is a medium, flag-only possible definition discrepancy", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.ew), /^fact:team_size$/); return { pass: c.length === 1 && c[0].relation === "different_definition" && c[0].severity === "medium" && c[0].scoring === "flag_only", actual: describe(c) }; } },
    { id: "earnwise-not-contradiction", description: "EarnWise team size is not labelled a contradiction", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.ew), /^fact:team_size$/, "contradiction"); return { pass: c.length === 0, actual: c.length ? describe(c) : "none" }; } },
    { id: "yatrika-one-sided", description: "Yatrika raise is low, flag-only, one-sided information listing INR 1.2 Cr", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.ya), /^raise$/); return { pass: c.length === 1 && c[0].relation === "one_sided" && c[0].severity === "low" && c[0].scoring === "flag_only" && sides(c[0]).some((x) => /1\.2 Cr/.test(x.display)), actual: describe(c) }; } },
    { id: "yatrika-not-contradiction", description: "The deck's omission is not labelled a contradiction", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = find(conflictsOf(o.ya), /^raise$/, "contradiction"); return { pass: c.length === 0, actual: c.length ? describe(c) : "none" }; } },
  ],
});

// ------------------------------------------------------------------ extraction guards
add<{ gk: ProcessResult }>({
  id: "EXG-01",
  version: 1,
  suite: "data-integrity",
  category: "extraction-guard",
  title: "GrainKind: 'INR 380' after promos is not revenue",
  input: "Seed GrainKind deck p7: '…after promos, sampling INR 380. Revenue mix: …'",
  expected: "No revenue claim with value 380.",
  run: async () => ({ gk: await run(seedDocs("GrainKind"), "GrainKind") }),
  assertions: [{ id: "not-revenue", description: "No revenue claim of ₹380", kind: "hard", judge: "code", severity: "high", check: (o) => { const c = o.gk.analysis.claims.filter((x) => x.metric === "revenue" && x.value === 380); return { pass: c.length === 0, actual: c.length ? `revenue=380 on ${c[0].sourceLabel}` : "none" }; } }],
});
add<ProcessResult>({
  id: "EXG-02",
  version: 1,
  suite: "data-integrity",
  category: "extraction-guard",
  title: "RentRoute: '₹1.5 lakh Cr annual urban rent paid in India' is market sizing, not traction",
  input: "Seed RentRoute deck p5 market slide.",
  expected: "That figure is classified as projection / market sizing, not as the company's volume.",
  run: () => run(seedDocs("RentRoute"), "RentRoute"),
  assertions: [{ id: "market-not-traction", description: "No traction 'volume' claim ≥ ₹1 lakh Cr", kind: "hard", judge: "code", severity: "high", check: (r) => { const c = r.analysis.claims.filter((x) => x.metric === "volume" && (x.value ?? 0) >= 1e12); return { pass: c.length === 0, actual: c.length ? `volume ${c[0].value} on ${c[0].sourceLabel} counted as traction` : "classified as market sizing" }; } }],
});

export const dataIntegritySuite: Suite = { id: "data-integrity", title: "P3 data integrity (conflicts, provenance, re-checks)", kind: "gating", description: "Identity, dates, stage, money, counts, periods and definitions across and within documents; re-checks after edits and restorations; extraction guards.", cases };
