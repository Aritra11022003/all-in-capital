// Brings the existing Vitest unit/integration tests (tests/**) into the evaluation report with a severity
// and category for each, WITHOUT modifying the tests. `npm run eval` runs them first with the JSON reporter;
// this suite reads that result file.
import { existsSync, readFileSync, statSync } from "node:fs";
import type { EvalCase, Severity, Suite } from "../framework/types";

export const UNIT_RESULTS = "evals/reports/.cache/unit-results.json";

/** First match wins. Severity is decided by what a failure would mean for Kushal, not by current results. */
const REGISTRY: { match: RegExp; severity: Severity; category: string }[] = [
  { match: /Test 1[123] —/, severity: "critical", category: "permissions-and-decisions" },
  { match: /Test 15 —/, severity: "critical", category: "job-integrity" },
  { match: /Test 14 —/, severity: "critical", category: "labelling" },
  { match: /Test 20 —/, severity: "critical", category: "human-approval" },
  { match: /Test 17 — .*records failed files/, severity: "critical", category: "unreadable-documents" },
  { match: /never invents values/, severity: "critical", category: "missing-information" },
  { match: /learning rules need partner approval/, severity: "critical", category: "permissions-and-decisions" },
  { match: /Test 17 —/, severity: "high", category: "unreadable-documents" },
  { match: /Test 10 —|historical memos|agreement is reported honestly/, severity: "high", category: "backtesting" },
  { match: /Test 9 —|Test 19 —|learning rules apply only after approval/, severity: "high", category: "corrections-and-history" },
  { match: /Test 16 —/, severity: "high", category: "duplicates" },
  { match: /Test 18 —/, severity: "high", category: "traceability" },
  { match: /Test [1-8] —|Tests 7 & 8 —|recommendations on the supplied batch/, severity: "high", category: "evaluation-logic" },
  { match: /extraction on the 10 supplied applications/, severity: "high", category: "extraction" },
  { match: /end-to-end/, severity: "high", category: "workflow" },
  { match: /file formats/, severity: "low", category: "file-formats" },
];

export function classify(fullName: string) {
  return REGISTRY.find((r) => r.match.test(fullName)) ?? { severity: "high" as Severity, category: "unclassified" };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 70);

interface VitestJson {
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  testResults: { name: string; assertionResults: { fullName: string; status: string; failureMessages?: string[] }[] }[];
}

export function existingTestsSuite(): { suite: Suite; summary: string } {
  if (!existsSync(UNIT_RESULTS)) {
    return { suite: { id: "existing-tests", title: "Existing unit & integration tests", kind: "gating", description: "", unavailable: "Unit results not found. Run `npm run eval` (it runs the existing tests first).", cases: [] }, summary: "not run in this invocation" };
  }
  const j = JSON.parse(readFileSync(UNIT_RESULTS, "utf8")) as VitestJson;
  const cases: EvalCase<{ status: string; msg: string }>[] = [];
  const seen = new Map<string, number>();
  for (const file of j.testResults) {
    const fileKey = file.name.split("/tests/")[1]?.replace(/\.test\.ts$/, "") ?? file.name;
    for (const t of file.assertionResults) {
      const c = classify(t.fullName);
      let id = `UT-${slug(t.fullName)}`;
      const n = (seen.get(id) ?? 0) + 1;
      seen.set(id, n);
      if (n > 1) id = `${id}-${n}`;
      cases.push({
        id,
        version: 1,
        suite: "existing-tests",
        category: c.category,
        title: t.fullName,
        input: `tests/${fileKey}.test.ts (fixed fixtures; see the test source)`,
        expected: "Test passes.",
        run: () => ({ status: t.status, msg: (t.failureMessages?.[0] ?? "").split("\n")[0].slice(0, 160) }),
        assertions: [{ id: "passes", description: t.fullName, kind: "hard", judge: "code", severity: c.severity, check: (o) => ({ pass: o.status === "passed", actual: o.status === "passed" ? "passed" : `${o.status}: ${o.msg}` }) }],
      });
    }
  }
  const age = Math.round((Date.now() - statSync(UNIT_RESULTS).mtimeMs) / 1000);
  return {
    suite: { id: "existing-tests", title: "Existing unit & integration tests", kind: "gating", description: "The original 60 Vitest tests, unchanged, with severities assigned in evals/suites/existing.ts.", cases: cases as unknown as EvalCase<unknown>[] },
    summary: `${j.numPassedTests}/${j.numTotalTests} passed (Vitest JSON written ${age}s before this report)`,
  };
}
