import { describe, expect, it } from "vitest";
import { can, canViewDocuments, MATRIX, PermissionError } from "@/lib/domain/permissions";
import { comment, correctScore, recordDecision, reopen, visibleDocuments, markViewed, decideLearningRule, approveCriteriaVersion, proposeCriteriaVersion, latestEvaluation } from "@/lib/domain/workspace";
import { MockAIProvider } from "@/lib/engine/evaluation/provider";
import { appByName, loadCaseBatch } from "../helpers";

describe("Test 11 — AI recommendations cannot finalise decisions", () => {
  it("processing leaves every application 'not reviewed' regardless of recommendation", async () => {
    const h = await loadCaseBatch();
    expect(h.d.applications.every((a) => a.decisionStatus === "not_reviewed")).toBe(true);
    expect(h.d.decisions).toHaveLength(0);
  });
  it("the AI provider interface exposes no decision capability", () => {
    expect(Object.keys(MockAIProvider).sort()).toEqual(["evaluate", "id", "label", "simulated", "status"]);
  });
  it("only Kushal can record a decision; Riya and Aditya are refused", async () => {
    const h = await loadCaseBatch();
    const app = appByName(h.d, "GrainKind");
    h.mutate((d) => markViewed(d, app.id, "kushal"));
    for (const role of ["riya", "aditya"] as const) {
      expect(() => h.mutate((d) => recordDecision(d, role, { applicationId: app.id, decision: "approve_call", rationale: "x" }))).toThrow(PermissionError);
    }
    expect(MATRIX["decision.record"]).toEqual(["kushal"]);
  });
  it("a decision requires a rationale, and a pass requires a reason", async () => {
    const h = await loadCaseBatch();
    const app = appByName(h.d, "Settlr");
    h.mutate((d) => markViewed(d, app.id, "kushal"));
    expect(() => h.mutate((d) => recordDecision(d, "kushal", { applicationId: app.id, decision: "pass", rationale: "" }))).toThrow(/rationale/);
    expect(() => h.mutate((d) => recordDecision(d, "kushal", { applicationId: app.id, decision: "pass", rationale: "Series A" }))).toThrow(/pass reason/);
    h.mutate((d) => recordDecision(d, "kushal", { applicationId: app.id, decision: "pass", rationale: "Series A lead round", passReason: "capital_mismatch" }));
    const dec = h.d.decisions[0];
    expect(dec).toMatchObject({ decidedBy: "kushal", decision: "pass", passReason: "capital_mismatch", recommendationAtTime: "pass_for_consideration" });
    expect(dec.decidedAt).toBeTruthy();
    expect(appByName(h.d, "Settlr").decisionStatus).toBe("passed_by_partner");
    expect(h.d.audit.some((a) => a.action === "decision.recorded" && a.actor === "kushal")).toBe(true);
  });
});

describe("Test 12 — Kushal sees every application", () => {
  it("Kushal can view every application, and cannot decide one he has not opened", async () => {
    const h = await loadCaseBatch();
    expect(can("kushal", "application.view")).toBe(true);
    for (const a of h.d.applications) expect(visibleDocuments(h.d, "kushal", a.id).allowed).toBe(true);
    const app = appByName(h.d, "Pumpwise");
    expect(() => h.mutate((d) => recordDecision(d, "kushal", { applicationId: app.id, decision: "approve_call", rationale: "Strong" }))).toThrow(/must open/);
  });
});

describe("Test 13 — users cannot access unauthorised documents", () => {
  it("Aditya can open deeptech documents only", async () => {
    const h = await loadCaseBatch();
    expect(visibleDocuments(h.d, "aditya", appByName(h.d, "Pumpwise").id).allowed).toBe(true);
    const cap = visibleDocuments(h.d, "aditya", appByName(h.d, "CAPilot").id);
    expect(cap.allowed).toBe(false);
    expect(cap.docs).toHaveLength(0);
    expect(canViewDocuments("riya", { tags: [], sectorKey: "fintech" })).toBe(true);
  });
  it("role-restricted actions are refused server-side in the domain layer", async () => {
    const h = await loadCaseBatch();
    const id = appByName(h.d, "Yatrika").id;
    expect(() => h.mutate((d) => reopen(d, "riya", id, "x"))).toThrow(PermissionError);
    const vid = proposeCriteriaVersion(h.d, "riya", { traction: 2 }, "test");
    expect(() => approveCriteriaVersion(h.d, "riya", vid)).toThrow(PermissionError);
    expect(() => comment(h.d, "aditya", id, "Technical view")).not.toThrow();
  });
});

describe("learning rules need partner approval", () => {
  it("a reusable correction proposes a rule that Riya cannot approve", async () => {
    const h = await loadCaseBatch();
    const ev = latestEvaluation(h.d, appByName(h.d, "Talkbook").id)!;
    h.mutate((d) => correctScore(d, "riya", { evaluationId: ev.id, criterion: "traction", score: 2.5, evidenceState: "conflicting", confidence: "low", reason: "MRR conflict plus seats x price mismatch", category: "evidence_misread", scope: "reusable" }));
    const rule = h.d.learningRules[0];
    expect(rule.status).toBe("proposed");
    expect(() => h.mutate((d) => decideLearningRule(d, "riya", rule.id, "approved"))).toThrow(PermissionError);
    h.mutate((d) => decideLearningRule(d, "aditya", rule.id, "approved"));
    expect(h.d.learningRules[0].status).toBe("approved");
  });
});
