import { describe, expect, it } from "vitest";
import { applyProcessResult, correctScore, confirmSlot, effectiveAssessment, latestEvaluation, markViewed, recordDecision, reopen, submitForReview } from "@/lib/domain/workspace";
import { runJob, reevaluate } from "@/lib/domain/runner";
import { enqueueGroups } from "@/lib/domain/runner";
import { buildIcs } from "@/lib/domain/scheduling";
import { buildReport, reportToMarkdown } from "@/lib/engine/reports/report";
import { appByName, harness, loadCaseBatch, seedDocs } from "../helpers";

describe("end-to-end: intake → evaluation → review → decision → scheduling → report", () => {
  it("processes the whole case batch to Ready for review", async () => {
    const h = await loadCaseBatch();
    expect(h.d.applications).toHaveLength(10);
    expect(h.d.applications.every((a) => a.processingStatus === "ready_for_review")).toBe(true);
    expect(h.d.jobs.every((j) => j.status === "succeeded")).toBe(true);
    expect(h.d.evaluations).toHaveLength(10);
    expect(h.d.research.length).toBeGreaterThan(90);
  });

  it("runs the full human workflow for GrainKind", async () => {
    const h = await loadCaseBatch();
    const id = appByName(h.d, "GrainKind").id;
    h.mutate((d) => submitForReview(d, "riya", id, "Strong cohorts; single co-packer risk"));
    expect(appByName(h.d, "GrainKind").decisionStatus).toBe("awaiting_partner_review");
    h.mutate((d) => markViewed(d, id, "kushal"));
    h.mutate((d) => recordDecision(d, "kushal", { applicationId: id, decision: "approve_call", rationale: "Giva-like cohort fluency", now: new Date("2026-11-18T06:00:00Z") }));
    expect(appByName(h.d, "GrainKind").decisionStatus).toBe("call_approved");
    const slots = h.d.slots.filter((s) => s.applicationId === id);
    expect(slots).toHaveLength(3);
    const report = reportToMarkdown(buildReport(h.d, id));
    expect(report).toMatch(/SIMULATED REPORT/);
    for (let i = 1; i <= 17; i++) expect(report).toContain(`## ${i}. `);
  });
});

describe("Test 9 — corrections preserve original AI assessments", () => {
  it("keeps the original score, records reviewer, reason and versions", async () => {
    const h = await loadCaseBatch();
    const ev = latestEvaluation(h.d, appByName(h.d, "Yatrika").id)!;
    const before = structuredClone(ev.assessments.find((a) => a.criterion === "market")!);
    h.mutate((d) => correctScore(d, "riya", { evaluationId: ev.id, criterion: "market", score: 2, evidenceState: "weak", confidence: "low", reason: "Single top-down number only", category: "evidence_misread", scope: "case_specific" }));
    const after = h.d.evaluations.find((e) => e.id === ev.id)!.assessments.find((a) => a.criterion === "market")!;
    expect(after).toEqual(before); // AI assessment untouched
    const c = h.d.corrections[0];
    expect(c.original.score).toBe(before.score);
    expect(c.revised.score).toBe(2);
    expect(c).toMatchObject({ reviewer: "riya", reason: "Single top-down number only", criteriaVersionId: ev.criteriaVersionId, provider: ev.provider, approval: "not_required" });
    expect(effectiveAssessment(h.d, h.d.evaluations.find((e) => e.id === ev.id)!, "market").score).toBe(2);
    expect(() => h.mutate((d) => correctScore(d, "riya", { evaluationId: ev.id, criterion: "market", score: 3, evidenceState: "weak", confidence: "low", reason: "", category: "other", scope: "case_specific" }))).toThrow(/reason/);
  });
});

describe("Test 15 — AI failure does not cause false pass/reject states", () => {
  it("a provider outage leaves processing Failed and the decision Not reviewed", async () => {
    const h = harness();
    const ids = enqueueGroups(h.mutate, "riya", [{ key: "x", label: "Outage Co", docs: seedDocs("CAPilot"), failures: [], duplicates: [] }], "b", h.pending);
    const job = h.d.jobs.find((j) => j.applicationId === ids[0])!;
    await runJob(h.mutate, h.read, job.id, seedDocs("CAPilot"), "riya", { simulateFailure: true });
    const app = h.d.applications[0];
    expect(app.processingStatus).toBe("failed");
    expect(app.decisionStatus).toBe("not_reviewed");
    expect(h.d.evaluations).toHaveLength(0);
    expect(() => h.mutate((d) => submitForReview(d, "riya", app.id, ""))).toThrow(/Processing failed/);
  });
});

describe("Test 18 — source citations link to actual stored evidence", () => {
  it("every cited signal points at a stored claim whose document page exists", async () => {
    const h = await loadCaseBatch();
    let cited = 0;
    for (const ev of h.d.evaluations) {
      for (const a of ev.assessments) {
        for (const s of [...a.supporting, ...a.opposing, ...a.notes]) {
          if (!s.claimId) continue;
          cited++;
          const claim = h.d.claims.find((c) => c.id === s.claimId);
          expect(claim, s.text).toBeTruthy();
          const doc = h.d.documents.find((d) => d.id === claim!.sourceDocId);
          expect(doc).toBeTruthy();
          if (claim!.page) expect(doc!.pages.some((p) => p.index === claim!.page)).toBe(true);
          expect(s.ref).toBe(claim!.sourceLabel);
        }
      }
    }
    expect(cited).toBeGreaterThan(100);
    // every claim has an evidence-ledger record with provenance
    const ledgerClaimIds = new Set(h.d.evidence.flatMap((e) => e.claimIds));
    expect(h.d.claims.filter((c) => !c.text.startsWith("Deck slide")).every((c) => ledgerClaimIds.has(c.id))).toBe(true);
  });
});

describe("Test 19 — reopening an application preserves history", () => {
  it("creates a new cycle, keeps old decisions/evaluations, and new evaluations attach to the new cycle", async () => {
    const h = await loadCaseBatch();
    const id = appByName(h.d, "RentRoute").id;
    h.mutate((d) => markViewed(d, id, "kushal"));
    h.mutate((d) => recordDecision(d, "kushal", { applicationId: id, decision: "pass", rationale: "Regulatory dependency", passReason: "regulatory_market_risk" }));
    const oldCycle = appByName(h.d, "RentRoute").currentCycleId;
    h.mutate((d) => reopen(d, "kushal", id, "Founders sent net revenue cohorts"));
    const app = appByName(h.d, "RentRoute");
    expect(app.decisionStatus).toBe("reopened");
    expect(app.currentCycleId).not.toBe(oldCycle);
    expect(h.d.cycles.filter((c) => c.applicationId === id)).toHaveLength(2);
    expect(h.d.decisions.find((x) => x.applicationId === id)!.cycleId).toBe(oldCycle);
    await reevaluate(h.mutate, h.read, id, "riya");
    const evs = h.d.evaluations.filter((e) => e.applicationId === id);
    expect(evs).toHaveLength(2);
    expect(evs[0].cycleId).toBe(oldCycle);
    expect(evs[1].cycleId).toBe(app.currentCycleId);
  });
});

describe("Test 20 — scheduling does not claim unconfirmed calendar bookings", () => {
  it("slots are Tue/Thu afternoon IST, 30 minutes, never calendar-synced; .ics says so", async () => {
    const h = await loadCaseBatch();
    const id = appByName(h.d, "Pumpwise").id;
    h.mutate((d) => markViewed(d, id, "kushal"));
    h.mutate((d) => recordDecision(d, "kushal", { applicationId: id, decision: "approve_call", rationale: "Deeptech with paying customers", now: new Date("2026-11-18T06:00:00Z") }));
    const slots = h.d.slots.filter((s) => s.applicationId === id);
    for (const s of slots) {
      const ist = new Date(Date.parse(s.start) + 330 * 60000);
      expect([2, 4]).toContain(ist.getUTCDay());
      expect(ist.getUTCHours()).toBeGreaterThanOrEqual(14);
      expect(Date.parse(s.end) - Date.parse(s.start)).toBe(30 * 60000);
      expect(s.calendarSynced).toBe(false);
      expect(s.status).toBe("proposed");
      expect(s.attendees).toContain("aditya"); // deeptech
    }
    h.mutate((d) => confirmSlot(d, "riya", slots[0].id));
    const confirmed = h.d.slots.find((s) => s.id === slots[0].id)!;
    expect(confirmed.status).toBe("confirmed_manual");
    expect(h.d.slots.filter((s) => s.applicationId === id && s.status === "proposed")).toHaveLength(0);
    const ics = buildIcs(confirmed, "Pumpwise", "2026-11-18T06:00:00.000Z");
    expect(ics).toMatch(/BEGIN:VEVENT[\s\S]*DTSTART:\d{8}T\d{6}Z/);
    expect(ics).toContain("NOT created in or confirmed by any connected calendar");
  });
  it("non-deeptech calls do not include Aditya", async () => {
    const h = await loadCaseBatch();
    const id = appByName(h.d, "GrainKind").id;
    h.mutate((d) => markViewed(d, id, "kushal"));
    h.mutate((d) => recordDecision(d, "kushal", { applicationId: id, decision: "approve_call", rationale: "ok" }));
    expect(h.d.slots.every((s) => !s.attendees.includes("aditya"))).toBe(true);
  });
});

describe("learning rules apply only after approval, transparently", () => {
  it("an approved rule changes future evaluations and is named; the past evaluation is unchanged", async () => {
    const h = await loadCaseBatch();
    const id = appByName(h.d, "RentRoute").id;
    const ev = latestEvaluation(h.d, id)!;
    const { decideLearningRule } = await import("@/lib/domain/workspace");
    h.mutate((d) => correctScore(d, "kushal", { evaluationId: ev.id, criterion: "path_to_market", score: 1, evidenceState: "weak", confidence: "medium", reason: "Card-network rule risk should weigh more", category: "thesis_interpretation", scope: "reusable", keywords: ["card networks"] }));
    await reevaluate(h.mutate, h.read, id, "riya");
    expect(latestEvaluation(h.d, id)!.appliedLearningRules).toHaveLength(0); // proposed only
    h.mutate((d) => decideLearningRule(d, "kushal", "LR-1", "approved"));
    await reevaluate(h.mutate, h.read, id, "riya");
    const latest = latestEvaluation(h.d, id)!;
    expect(latest.appliedLearningRules).toEqual(["LR-1"]);
    expect(h.d.evaluations.find((e) => e.id === ev.id)!.appliedLearningRules).toHaveLength(0);
  });
});

void applyProcessResult;
