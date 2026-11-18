import { describe, expect, it } from "vitest";
import { MEMOS, runBacktest, stageConfound, summarise } from "@/lib/engine/backtest/backtest";

describe("historical memos", () => {
  it("contains 12 deals: 6 invested and 6 passed", () => {
    expect(MEMOS).toHaveLength(12);
    expect(MEMOS.filter((m) => m.decision === "invested")).toHaveLength(6);
  });
});

describe("Test 10 — point-in-time backtesting excludes hindsight", () => {
  it("point-in-time mode never reads founder assessments, risks, rationale or later notes", () => {
    for (const r of runBacktest("point_in_time")) {
      expect(r.inputsUsed).toEqual(["What it does", "Sector / stage / source"]);
      expect(r.inputsExcluded.join(" ")).toMatch(/Founder assessment/);
      expect(r.signals.every((s) => s.dimension === "thesis")).toBe(true);
    }
  });
  it("the decision rationale (the label) never influences either mode", () => {
    const before = { r: runBacktest("retrospective"), p: runBacktest("point_in_time") };
    const saved = MEMOS.map((m) => m.rationale);
    MEMOS.forEach((m) => (m.rationale = m.decision === "invested" ? "This is outside the areas we back. Crypto." : "Founders stayed with a hard problem for years."));
    try {
      expect(runBacktest("retrospective").map((x) => x.modelCall)).toEqual(before.r.map((x) => x.modelCall));
      expect(runBacktest("point_in_time").map((x) => x.modelCall)).toEqual(before.p.map((x) => x.modelCall));
    } finally {
      MEMOS.forEach((m, i) => (m.rationale = saved[i]));
    }
  });
  it("Prepnest's later competitor success is not an input", () => {
    const p = runBacktest("point_in_time").find((r) => r.name === "Prepnest")!;
    expect(p.signals.map((s) => s.text).join(" ")).not.toMatch(/competitor|since done well/i);
  });
});

describe("agreement is reported honestly", () => {
  it("summarises agreement and classifies every disagreement", () => {
    for (const mode of ["retrospective", "point_in_time"] as const) {
      const rows = runBacktest(mode);
      const s = summarise(rows);
      expect(s.n).toBe(12);
      for (const r of rows.filter((x) => !x.agrees)) expect(r.suggestedCause).toBeTruthy();
    }
    expect(summarise(runBacktest("point_in_time")).undetermined).toBeGreaterThan(6);
  });
  it("surfaces the stage-label artefact instead of exploiting it", () => {
    expect(stageConfound()).toMatch(/Early round/);
  });
});
