import { describe, expect, it } from "vitest";
import { processApplication } from "@/lib/engine/process";
import { THESIS_V1, CRITERIA_V1 } from "@/config/thesis";
import { PORTFOLIO_V1, INCOMPLETE_PORTFOLIO_WARNING } from "@/config/portfolio";
import type { DocInput } from "@/lib/engine/pipeline";
import { pagesFromPastedText } from "@/lib/engine/extraction/files";
import { seedDocs } from "../helpers";

const run = (docs: DocInput[], portfolio = PORTFOLIO_V1) =>
  processApplication({ applicationId: "t", cycleId: "c", actor: "riya", docs, thesis: THESIS_V1, criteria: CRITERIA_V1, portfolio, learningRules: [], now: "2026-11-18T00:00:00Z" });
const crit = (r: Awaited<ReturnType<typeof run>>, id: string) => r.evaluation.assessments.find((a) => a.criterion === id)!;
const text = (kind: "deck" | "form", t: string): DocInput => ({ filename: `${kind}.txt`, kind, pages: pagesFromPastedText(t), method: "pasted", sha256: kind, size: t.length });
const withForm = (key: string, patch: (t: string) => string): DocInput[] =>
  seedDocs(key).map((d) => (d.filename.includes("Form") ? { ...d, pages: d.pages.map((p) => ({ ...p, text: patch(p.text) })) } : d));

describe("Test 1 — deck and form contain conflicting traction numbers", () => {
  it("CAPilot: 31 paying firms (deck) vs 24 (form) is shown side by side, nothing chosen", async () => {
    const r = await run(seedDocs("CAPilot"));
    const c = r.analysis.conflicts.find((x) => x.metric === "count:firm|paying")!;
    expect(c.a.display).toMatch(/31/);
    expect(c.b.display).toMatch(/24/);
    expect(c.a.sourceLabel).toMatch(/^Deck p\d/);
    expect(c.b.sourceLabel).toMatch(/^Form p\d/);
    expect(c.status).toBe("open");
    expect(crit(r, "traction").evidenceState).toBe("conflicting");
  });
  it("detects every conflict in the supplied batch", async () => {
    const labels = async (k: string) => (await run(seedDocs(k))).analysis.conflicts.map((c) => c.metric);
    expect(await labels("StockSathi")).toEqual(expect.arrayContaining(["count:retailer|onboarded", "cac", "credit_funding"]));
    expect(await labels("EarnWise")).toEqual(expect.arrayContaining(["count:client|live", "founder_credentials"]));
    expect(await labels("Talkbook")).toEqual(expect.arrayContaining(["mrr"]));
    expect(await labels("RentRoute")).toEqual(expect.arrayContaining(["revenue"]));
    expect(await labels("Yatrika")).toEqual(expect.arrayContaining(["count:traveller"]));
    expect(await labels("GrainKind")).toEqual([]);
    expect(await labels("Pumpwise")).toEqual([]);
  });
});

describe("Test 2 — missing repeat metrics affect the appropriate criterion", () => {
  it("consumer brand without repeat data is penalised on traction by policy", async () => {
    const form = (sector: string) => `Company name Brandco (Brandco Pvt. Ltd.)\nSector (as selected) ${sector}\nStage (as selected) Pre-seed\nCustomers 2,000 paying customers.\nRevenue INR 5 L in October 2026.\nAmount raising INR 1 Cr`;
    const brand = await run([text("form", form("Consumer brands"))]);
    const fin = await run([text("form", form("Fintech"))]);
    const t = crit(brand, "traction");
    expect(t.opposing.find((s) => /No repeat rate reported/.test(s.text))?.effect).toBe(-1);
    expect(t.appliedRules.join(" ")).toMatch(/consumer_brand\/repeat/);
    expect(t.score!).toBeLessThan(crit(fin, "traction").score!);
    expect(brand.evaluation.revealedThesis.find((x) => x.patternId === "RP-2")?.result).toBe("concern");
    expect(brand.evaluation.criticalUnknowns.join(" ")).toMatch(/Repeat/);
  });
  it("GrainKind's cohort repeat data satisfies the policy", async () => {
    const r = await run(seedDocs("GrainKind"));
    expect(crit(r, "traction").appliedRules).toHaveLength(0);
    expect(r.evaluation.revealedThesis.find((x) => x.patternId === "RP-2")?.result).toBe("consistent");
  });
  it("a non-consumer-brand without repeat data is NOT penalised (unknown is not zero)", async () => {
    const r = await run(seedDocs("CAPilot"));
    expect(crit(r, "traction").appliedRules).toHaveLength(0);
    expect(crit(r, "traction").unknowns.join(" ")).toMatch(/Repeat/);
  });
});

describe("Test 3 — founder credentials do not substitute for evidence of execution", () => {
  it("credentials are recorded with zero effect", async () => {
    const r = await run([text("form", "Company name Acme\nSector (as selected) Fintech\nStage (as selected) Pre-seed\nFounder 1 Priya Shah, CEO. IIT Bombay, IIM Ahmedabad MBA, Ex-Google, Ex-McKinsey.\nAmount raising INR 1 Cr")]);
    const fq = crit(r, "founder_quality");
    expect(fq.notes.find((n) => /Credentials recorded but not scored/.test(n.text))?.effect).toBe(0);
    expect(fq.supporting).toHaveLength(0);
    expect(fq.score!).toBeLessThanOrEqual(3);
  });
  it("EarnWise: inflated deck credentials lower founder quality", async () => {
    const r = await run(seedDocs("EarnWise"));
    expect(crit(r, "founder_quality").score!).toBeLessThanOrEqual(2);
    expect(r.evaluation.recommendation).toBe("pass_for_consideration");
  });
});

describe("Test 4 — founder quality and path to market remain separate", () => {
  it("changing acquisition channels moves path-to-market but not founder quality", async () => {
    const base = await run(seedDocs("Talkbook"));
    const alt = await run(withForm("Talkbook", (t) => t.replace(/Customer acquisition [^\n]*(\n[^\n]*consultants 2\.)?/, "Customer acquisition Mostly the founders' network.")).map((d) => (d.filename.includes("Deck") ? { ...d, pages: d.pages.filter((p) => !/Go-to-market/.test(p.text)) } : d)));
    expect(crit(alt, "path_to_market").score).not.toBe(crit(base, "path_to_market").score);
    expect(crit(alt, "founder_quality").score).toBe(crit(base, "founder_quality").score);
    for (const s of [...crit(base, "founder_quality").supporting, ...crit(base, "founder_quality").opposing]) expect(s.text).not.toMatch(/channel|acquisition cost/i);
  });
});

describe("Test 5 — deeptech regulatory milestone plans are evaluated", () => {
  it("Pumpwise: certification budgeted without a milestone sequence is an opposing signal and a named unknown", async () => {
    const r = await run(seedDocs("Pumpwise"));
    const ptm = crit(r, "path_to_market");
    expect(ptm.opposing.some((s) => /no milestone sequence/i.test(s.text))).toBe(true);
    expect(ptm.unknowns.join(" ")).toMatch(/milestone/i);
    expect(r.evaluation.flags.some((f) => /Aditya/.test(f.text))).toBe(true);
  });
  it("a stated milestone sequence is recognised as support", async () => {
    const r = await run(withForm("Pumpwise", (t) => t + "\nRegulatory plan Milestone 1: BIS certification by Q2 2027; milestone 2: field trials with 3 OEMs."));
    expect(crit(r, "path_to_market").supporting.some((s) => /milestone sequence/.test(s.text))).toBe(true);
  });
});

describe("Test 6 — founders' ownership of credit risk is assessed", () => {
  it("StockSathi (first-loss, personal follow-up) is consistent with RP-1; EarnWise (partner NBFC + savings) is a concern", async () => {
    const ss = await run(seedDocs("StockSathi"));
    const ew = await run(seedDocs("EarnWise"));
    expect(ss.evaluation.revealedThesis.find((x) => x.patternId === "RP-1")?.result).toBe("consistent");
    expect(ew.evaluation.revealedThesis.find((x) => x.patternId === "RP-1")?.result).toBe("concern");
    expect(crit(ew, "founder_quality").unknowns.join(" ")).toMatch(/Who owns underwriting/);
  });
  it("non-lending businesses are not subjected to the check", async () => {
    const r = await run(seedDocs("GrainKind"));
    expect(r.evaluation.revealedThesis.find((x) => x.patternId === "RP-1")?.result).toBe("not_applicable");
  });
});

describe("Tests 7 & 8 — portfolio overlap", () => {
  it("Talkbook is flagged against MeetRecord as a possible (not confirmed) direct competitor", async () => {
    const r = await run(seedDocs("Talkbook"));
    const m = r.overlap.results.find((x) => x.portfolioName === "MeetRecord")!;
    expect(m.relationship).toBe("direct_competitor");
    expect(r.overlap.reviewerDecision).toBe("pending");
    expect(r.overlap.comparedCount).toBe(PORTFOLIO_V1.companies.length);
    expect(r.evaluation.recommendation).not.toBe("take_call");
  });
  it("an incomplete portfolio never produces an unqualified clear result", async () => {
    const r = await run(seedDocs("CAPilot"));
    expect(r.overlap.results).toHaveLength(0);
    expect(r.overlap.status).toBe("no_match_incomplete");
    expect(r.overlap.statusText).toContain(INCOMPLETE_PORTFOLIO_WARNING);
    const verified = await run(seedDocs("CAPilot"), { ...PORTFOLIO_V1, verified: true });
    expect(verified.overlap.status).toBe("no_match_verified");
  });
});

describe("Test 14 — mock outputs are clearly labelled", () => {
  it("every evaluation is stamped simulated and never claims verification", async () => {
    const r = await run(seedDocs("GrainKind"));
    expect(r.evaluation.simulated).toBe(true);
    expect(r.evaluation.providerLabel).toMatch(/simulated/i);
    expect(r.evaluation.flags.some((f) => /No external research performed/.test(f.text))).toBe(true);
    expect(r.research.every((t) => t.status === "not_started" && /no research provider/i.test(t.providerNote))).toBe(true);
    for (const a of r.evaluation.assessments) expect(a.confidence).not.toBe("high");
  });
});

describe("recommendations on the supplied batch are coherent", () => {
  it("stage mismatch, thesis mismatch and strong fits land where expected", async () => {
    const rec = async (k: string) => (await run(seedDocs(k))).evaluation.recommendation;
    expect(await rec("Settlr")).toBe("pass_for_consideration");
    expect(await rec("CareCorner")).toBe("pass_for_consideration");
    expect(await rec("GrainKind")).toBe("take_call");
    expect(await rec("Pumpwise")).toBe("take_call");
  });
});
