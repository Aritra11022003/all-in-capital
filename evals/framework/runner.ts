// Runs suites deterministically and computes the severity / kill-criteria summary.
import { createHash } from "node:crypto";
import type { AssertionResult, EvalCase, HumanVerdict, Severity, Status, Suite } from "./types";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface ReviewItem {
  testId: string;
  reviewHash: string;
  rubric: string;
  material: string;
}

export interface RunOutput {
  results: AssertionResult[];
  reviewQueue: ReviewItem[];
}

export async function runSuites(suites: Suite[], verdicts: HumanVerdict[] = []): Promise<RunOutput> {
  const results: AssertionResult[] = [];
  const reviewQueue: ReviewItem[] = [];
  const seen = new Set<string>();
  for (const suite of suites) {
    for (const c of suite.cases as EvalCase<unknown>[]) {
      if (seen.has(c.id)) throw new Error(`Duplicate eval case ID: ${c.id}`);
      seen.add(c.id);
      const base = {
        caseId: c.id,
        suite: suite.id,
        suiteKind: suite.kind,
        category: c.category,
        caseTitle: c.title,
        caseVersion: c.version,
        input: c.input,
        expected: c.expected,
        knownIssue: c.knownIssue,
      };
      if (suite.unavailable) {
        for (const a of c.assertions) results.push({ ...base, testId: `${c.id}/${a.id}`, assertion: a.description, kind: a.kind, judge: a.judge, severity: a.severity, status: "skipped", actual: suite.unavailable });
        continue;
      }
      let output: unknown;
      let runError: string | null = null;
      try {
        output = await c.run();
      } catch (e) {
        runError = e instanceof Error ? e.message : String(e);
      }
      for (const a of c.assertions) {
        const testId = `${c.id}/${a.id}`;
        const row = { ...base, testId, assertion: a.description, kind: a.kind, judge: a.judge, severity: a.severity };
        if (runError !== null) {
          results.push({ ...row, status: "error", actual: `Case failed to run: ${runError}` });
          continue;
        }
        if (a.kind === "hard") {
          if (!a.check) throw new Error(`${testId}: hard assertion without a check`);
          try {
            const r = a.check(output as never);
            results.push({ ...row, status: r.pass ? "pass" : "fail", actual: r.actual });
          } catch (e) {
            results.push({ ...row, status: "error", actual: `Check threw: ${e instanceof Error ? e.message : String(e)}` });
          }
        } else {
          const material = a.reviewMaterial ? a.reviewMaterial(output as never) : "";
          const reviewHash = sha256(`${testId}\n${a.rubric ?? ""}\n${material}`).slice(0, 16);
          const v = verdicts.find((x) => x.testId === testId && x.reviewHash === reviewHash);
          if (v) results.push({ ...row, status: v.verdict, actual: `${a.judge} verdict by ${v.reviewer}${v.note ? `: ${v.note}` : ""}`, reviewHash, reviewer: v.reviewer });
          else {
            results.push({ ...row, status: "needs_review", actual: `Awaiting ${a.judge} judgement (no automated verdict).`, reviewHash });
            reviewQueue.push({ testId, reviewHash, rubric: a.rubric ?? "", material });
          }
        }
      }
    }
  }
  return { results, reviewQueue };
}

const SEVERITIES: Severity[] = ["critical", "high", "low"];
const STATUSES: Status[] = ["pass", "fail", "needs_review", "skipped", "error"];
const tally = () => Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;

export interface Summary {
  total: number;
  byStatus: Record<Status, number>;
  bySeverity: Record<Severity, Record<Status, number>>;
  bySuite: Record<string, { kind: string; byStatus: Record<Status, number> }>;
  byCategory: Record<string, Record<Status, number>>;
  byJudge: Record<string, Record<Status, number>>;
  /** Pass rate over decided (pass+fail+error) assertions, per suite. */
  passRate: Record<string, number | null>;
  kill: { fired: boolean; testIds: string[] };
  unverifiedCritical: string[];
  documentedFailures: { testId: string; severity: Severity; knownIssue: string }[];
  resultsHash: string;
}

export function summarise(results: AssertionResult[]): Summary {
  const byStatus = tally();
  const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, tally()])) as Summary["bySeverity"];
  const bySuite: Summary["bySuite"] = {};
  const byCategory: Summary["byCategory"] = {};
  const byJudge: Summary["byJudge"] = {};
  for (const r of results) {
    byStatus[r.status]++;
    bySeverity[r.severity][r.status]++;
    (bySuite[r.suite] ??= { kind: r.suiteKind, byStatus: tally() }).byStatus[r.status]++;
    (byCategory[`${r.suite} · ${r.category}`] ??= tally())[r.status]++;
    (byJudge[r.judge] ??= tally())[r.status]++;
  }
  const passRate: Summary["passRate"] = {};
  for (const [k, v] of Object.entries(bySuite)) {
    const decided = v.byStatus.pass + v.byStatus.fail + v.byStatus.error;
    passRate[k] = decided ? v.byStatus.pass / decided : null;
  }
  // Kill criteria: any critical failure (or error) in a gating or calibration suite, whatever the pass rate.
  const killing = results.filter((r) => r.suiteKind !== "measurement" && r.severity === "critical" && (r.status === "fail" || r.status === "error"));
  const unverifiedCritical = results.filter((r) => r.suiteKind !== "measurement" && r.severity === "critical" && r.status === "needs_review").map((r) => r.testId);
  const documentedFailures = results.filter((r) => r.knownIssue && (r.status === "fail" || r.status === "error")).map((r) => ({ testId: r.testId, severity: r.severity, knownIssue: r.knownIssue! }));
  // Deterministic fingerprint of verdicts: same inputs → same hash.
  const resultsHash = sha256(JSON.stringify([...results].sort((a, b) => a.testId.localeCompare(b.testId)).map((r) => [r.testId, r.caseVersion, r.status, r.actual]))).slice(0, 16);
  return { total: results.length, byStatus, bySeverity, bySuite, byCategory, byJudge, passRate, kill: { fired: killing.length > 0, testIds: killing.map((r) => r.testId) }, unverifiedCritical, documentedFailures, resultsHash };
}
