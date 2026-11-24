// Entry point: `npm run eval` (runs the existing tests first, then this file under vitest.evals.config.mts).
// Runs every suite twice to prove determinism, writes reports, and fails if a kill criterion fires.
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSuites, summarise } from "./framework/runner";
import { writeReports, type RunMeta } from "./framework/report";
import { SUITE_VERSION, type HumanVerdict, type Suite } from "./framework/types";
import { adversarialSuite, appSuite } from "./suites/app";
import { buildLoopSuites } from "./suites/loops";
import { existingTestsSuite } from "./suites/existing";
import { p2AdversarialCases, regressionSuite, residualRiskSuite } from "./suites/p2";
import { dataIntegritySuite } from "./suites/p3";
import { datasetFingerprints, OFFLINE_DIR, writeOfflineDatasets } from "./datasets/loops";

const VERDICTS = "evals/judgements/verdicts.json";
// data/private is read (optional B6 exports) but never written by a normal run. Writing the private review queue
// and the offline dataset copies is an explicit opt-in: EVAL_WRITE_PRIVATE=1 (npm run eval:review-queue).
// Human verdicts come only from VERDICTS; without one, a soft assertion stays needs_review and never passes.
const WRITE_PRIVATE = process.env.EVAL_WRITE_PRIVATE === "1";
const sh = (cmd: string) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};

function build(): { suites: Suite[]; loops: ReturnType<typeof buildLoopSuites>; existingSummary: string } {
  const existing = existingTestsSuite();
  const loops = buildLoopSuites();
  const adversarial = { ...adversarialSuite, cases: [...adversarialSuite.cases, ...p2AdversarialCases] } as typeof adversarialSuite;
  return { suites: [existing.suite, appSuite, adversarial, regressionSuite, residualRiskSuite, dataIntegritySuite, ...loops.suites], loops, existingSummary: existing.summary };
}

describe("All In Capital evaluation suite", () => {
  it("runs every suite, writes the report, and enforces kill criteria", async () => {
    const startedAt = new Date().toISOString();
    const offline = WRITE_PRIVATE ? writeOfflineDatasets() : [];
    const privatePresent = Object.keys(datasetFingerprints()).length > 0;
    const verdicts: HumanVerdict[] = existsSync(VERDICTS) ? JSON.parse(readFileSync(VERDICTS, "utf8")) : [];

    const first = build();
    const run1 = await runSuites(first.suites, verdicts);
    const s1 = summarise(run1.results);
    const second = build();
    const run2 = await runSuites(second.suites, verdicts);
    const s2 = summarise(run2.results);

    const finishedAt = new Date().toISOString();
    const runId = `run-${startedAt.replace(/[-:]/g, "").replace(/\..*/, "")}-${s1.resultsHash.slice(0, 8)}`;
    const meta: RunMeta = {
      runId,
      startedAt,
      finishedAt,
      suiteVersion: SUITE_VERSION,
      gitCommit: sh("git rev-parse --short HEAD") || "unknown",
      gitDirty: sh("git status --porcelain").length > 0,
      node: process.version,
      datasetFingerprints: datasetFingerprints(),
      determinism: { secondRunHash: s2.resultsHash, matches: s1.resultsHash === s2.resultsHash },
      existingTests: first.existingSummary,
      notes: [
        "No AI model is called anywhere in this run; the application's evaluator is the deterministic, simulated MockAIProvider.",
        "Soft assertions are judged by a human (no LLM judge is configured). Until a verdict is recorded they are 'needs review' and never counted as passed.",
        "Loop 1/Loop 2 suites read the private B6 exports from data/private/ (git-ignored). Reports contain record IDs and aggregates only.",
        !privatePresent
          ? "Private datasets absent: Loop suites skipped."
          : offline.length
            ? `Offline datasets written to ${OFFLINE_DIR.replace(process.cwd() + "/", "")} (git-ignored; EVAL_WRITE_PRIVATE=1).`
            : "Private datasets read only; nothing written under data/private (set EVAL_WRITE_PRIVATE=1 to write the offline copies and the review queue).",
        `${run1.reviewQueue.length} soft assertion(s) pending human review${WRITE_PRIVATE ? "" : " (review queue not written; npm run eval:review-queue writes it under data/private/eval-review)"}. Verdicts are read only from ${VERDICTS}.`,
        "Fixed-date holidays only (1 Jan, 26 Jan, 15 Aug, 2 Oct, 25 Dec); movable festivals are not checked.",
      ],
      extras: first.loops.extras(run1.results),
    };
    const { dir, reviewPath } = writeReports({ reportDir: join("evals", "reports"), privateDir: WRITE_PRIVATE ? join("data", "private", "eval-review") : null, meta, summary: s1, results: run1.results, reviewQueue: run1.reviewQueue });

    const line = (k: string, v: unknown) => console.log(`${k.padEnd(28)} ${v}`);
    console.log("\n================ EVALUATION SUMMARY ================");
    line("Run ID", runId);
    line("Assertions", s1.total);
    line("By status", JSON.stringify(s1.byStatus));
    for (const sev of ["critical", "high", "low"] as const) line(`  ${sev}`, JSON.stringify(s1.bySeverity[sev]));
    for (const [k, v] of Object.entries(s1.bySuite)) line(`  suite ${k} (${v.kind})`, `${JSON.stringify(v.byStatus)} pass-rate ${s1.passRate[k] === null ? "—" : (s1.passRate[k]! * 100).toFixed(1) + "%"}`);
    line("Determinism", meta.determinism.matches ? `identical (${s1.resultsHash})` : `DIFFERENT ${s1.resultsHash} vs ${s2.resultsHash}`);
    line("Kill criteria", s1.kill.fired ? `FIRED: ${s1.kill.testIds.join(", ")}` : "none fired");
    line("Documented failures", s1.documentedFailures.map((f) => f.testId).join(", ") || "none");
    line("Report", join(dir, "report.md"));
    if (reviewPath) line("Human review queue", `${reviewPath} (private)`);
    console.log("====================================================\n");

    expect(meta.determinism.matches, "same inputs must give the same results").toBe(true);
    expect(s1.kill.testIds, "kill criteria: critical failures in gating/calibration suites").toEqual([]);
  }, 120_000);
});
