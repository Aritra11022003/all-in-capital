// Evaluation framework types (L7 "Evals" pattern): a fixed scenario, a stated standard, and a checklist
// of assertions. Each assertion is a test row with its own ID, kind (hard/soft), judge and severity.

export const SUITE_VERSION = "1.3.0";

export type Severity = "critical" | "high" | "low";
export type AssertionKind = "hard" | "soft";
/** Who decides the verdict: code (automated), or a human / LLM judge (never automated here: no model calls). */
export type Judge = "code" | "human" | "llm";
export type Status = "pass" | "fail" | "needs_review" | "skipped" | "error";

/**
 * gating — a ship gate for THIS application: any critical failure is a kill criterion.
 * measurement — measures something external (e.g. the legacy system in the B6 exports); reported, never gates.
 * calibration — checks the harness itself against known-good or known-bad material; critical failures gate
 *               because they mean the instrument is broken.
 */
export type SuiteKind = "gating" | "measurement" | "calibration";

export interface CheckResult {
  pass: boolean;
  /** Privacy-safe, deterministic description of what was observed (no founder names or raw text). */
  actual: string;
}

export interface AssertionDef<O> {
  /** Unique within the case; the full test ID is `${case.id}/${id}`. */
  id: string;
  description: string;
  kind: AssertionKind;
  judge: Judge;
  severity: Severity;
  /** Hard assertions only. Soft assertions carry a rubric for the human/LLM judge instead. */
  check?: (output: O) => CheckResult;
  /** Soft assertions only: what the judge must confirm. */
  rubric?: string;
  /** Soft assertions only: privacy-safe material the judge reviews (kept out of committed files). */
  reviewMaterial?: (output: O) => string;
}

export interface EvalCase<O = unknown> {
  id: string;
  version: number;
  suite: string;
  category: string;
  title: string;
  /** Privacy-safe description of the fixed input. */
  input: string;
  expected: string;
  /** Known, documented gap: the case still runs and still counts; this note explains an expected failure. */
  knownIssue?: string;
  run: () => Promise<O> | O;
  assertions: AssertionDef<O>[];
}

export interface Suite {
  id: string;
  title: string;
  kind: SuiteKind;
  description: string;
  /** When set, the suite could not run (e.g. private dataset absent); its cases are reported as skipped. */
  unavailable?: string;
  cases: EvalCase<never>[] | EvalCase<unknown>[];
}

export interface AssertionResult {
  testId: string;
  caseId: string;
  suite: string;
  suiteKind: SuiteKind;
  category: string;
  caseTitle: string;
  caseVersion: number;
  input: string;
  expected: string;
  assertion: string;
  kind: AssertionKind;
  judge: Judge;
  severity: Severity;
  status: Status;
  actual: string;
  knownIssue?: string;
  /** For soft assertions: hash of the reviewed material, so a stored human verdict only applies to identical output. */
  reviewHash?: string;
  reviewer?: string;
}

export interface HumanVerdict {
  testId: string;
  reviewHash: string;
  verdict: "pass" | "fail";
  reviewer: string;
  note?: string;
}
