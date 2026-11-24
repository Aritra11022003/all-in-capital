// Writes the run report: JSON (machine), Markdown (human) and a private review queue for soft assertions.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ReviewItem, Summary } from "./runner";
import type { AssertionResult, Severity, Status } from "./types";

export interface RunMeta {
  runId: string;
  startedAt: string;
  finishedAt: string;
  suiteVersion: string;
  gitCommit: string;
  gitDirty: boolean;
  node: string;
  /** SHA-256 of each private input file (content never copied into the report). */
  datasetFingerprints: Record<string, string>;
  determinism: { secondRunHash: string | null; matches: boolean | null };
  existingTests: string;
  notes: string[];
  /** Extra computed tables (privacy-safe aggregates) appended to the Markdown report. */
  extras?: { title: string; markdown: string }[];
}

const STATUSES: Status[] = ["pass", "fail", "error", "needs_review", "skipped"];
const SEVS: Severity[] = ["critical", "high", "low"];
const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const pct = (x: number | null) => (x === null ? "—" : `${(x * 100).toFixed(1)}%`);

export function toMarkdown(meta: RunMeta, s: Summary, results: AssertionResult[]): string {
  const L: string[] = [];
  L.push(`# Evaluation report — ${meta.runId}`, "");
  L.push(s.kill.fired ? `> **KILL CRITERIA FIRED — ${s.kill.testIds.length} critical failure(s) in gating/calibration suites. The aggregate pass rate does not override this.**` : "> **No kill criterion fired** (no critical failure in a gating or calibration suite).", "");
  if (s.unverifiedCritical.length) L.push(`> ${s.unverifiedCritical.length} critical soft assertion(s) await human judgement and are **not** counted as passed.`, "");
  L.push("| Run | Value |", "|---|---|");
  L.push(`| Started / finished | ${meta.startedAt} / ${meta.finishedAt} |`, `| Suite version | ${meta.suiteVersion} |`, `| Git commit | ${meta.gitCommit}${meta.gitDirty ? " (uncommitted changes present)" : ""} |`, `| Node | ${meta.node} |`, `| Results hash | \`${s.resultsHash}\` |`);
  L.push(`| Determinism (second in-process run) | ${meta.determinism.matches === null ? "not checked" : meta.determinism.matches ? `identical (\`${meta.determinism.secondRunHash}\`)` : `**DIFFERENT** (\`${meta.determinism.secondRunHash}\`)`} |`);
  L.push(`| Existing unit tests | ${meta.existingTests} |`);
  for (const [k, v] of Object.entries(meta.datasetFingerprints)) L.push(`| Dataset fingerprint: ${k} | \`${v.slice(0, 16)}\` |`);
  L.push("");
  if (meta.notes.length) L.push("**Notes**", "", ...meta.notes.map((n) => `- ${n}`), "");

  L.push("## By severity", "", `| Severity | ${STATUSES.join(" | ")} |`, `|---|${STATUSES.map(() => "---").join("|")}|`);
  for (const sev of SEVS) L.push(`| ${sev} | ${STATUSES.map((st) => s.bySeverity[sev][st]).join(" | ")} |`);
  L.push(`| **all** | ${STATUSES.map((st) => s.byStatus[st]).join(" | ")} |`, "");

  L.push("## By suite", "", `| Suite | Kind | Pass rate (decided) | ${STATUSES.join(" | ")} |`, `|---|---|---|${STATUSES.map(() => "---").join("|")}|`);
  for (const [k, v] of Object.entries(s.bySuite)) L.push(`| ${k} | ${v.kind} | ${pct(s.passRate[k])} | ${STATUSES.map((st) => v.byStatus[st]).join(" | ")} |`);
  L.push("", "Kinds: **gating** = ship gate for this app (critical failure = kill) · **calibration** = checks the instrument itself (critical failure = kill) · **measurement** = measures external/legacy output, never gates.", "");

  L.push("## By judge (automated vs human/LLM)", "", `| Judge | ${STATUSES.join(" | ")} |`, `|---|${STATUSES.map(() => "---").join("|")}|`);
  for (const [k, v] of Object.entries(s.byJudge)) L.push(`| ${k === "code" ? "code (automated hard assertion)" : `${k} (soft, judged)`} | ${STATUSES.map((st) => v[st]).join(" | ")} |`);
  L.push("");

  if (s.kill.fired) {
    L.push("## Kill-criteria failures", "", "| Test ID | Actual |", "|---|---|");
    for (const id of s.kill.testIds) {
      const r = results.find((x) => x.testId === id)!;
      L.push(`| \`${id}\` | ${esc(r.actual)} |`);
    }
    L.push("");
  }
  if (s.documentedFailures.length) {
    L.push("## Documented (known) failures", "", "| Test ID | Severity | Why |", "|---|---|---|");
    for (const f of s.documentedFailures) L.push(`| \`${f.testId}\` | ${f.severity} | ${esc(f.knownIssue)} |`);
    L.push("");
  }

  L.push("## By category", "", `| Suite · category | ${STATUSES.join(" | ")} |`, `|---|${STATUSES.map(() => "---").join("|")}|`);
  for (const [k, v] of Object.entries(s.byCategory)) L.push(`| ${esc(k)} | ${STATUSES.map((st) => v[st]).join(" | ")} |`);
  L.push("");

  for (const ex of meta.extras ?? []) L.push(`## ${ex.title}`, "", ex.markdown, "");

  L.push("## All results", "");
  const suites = [...new Set(results.map((r) => r.suite))];
  for (const su of suites) {
    L.push(`### ${su}`, "", "| Test ID | Severity | Kind / judge | Status | Assertion | Actual |", "|---|---|---|---|---|---|");
    for (const r of results.filter((x) => x.suite === su)) {
      const mark = r.status === "pass" ? "✅ pass" : r.status === "fail" ? "❌ fail" : r.status === "error" ? "💥 error" : r.status === "needs_review" ? "👀 review" : "⏭ skipped";
      L.push(`| \`${r.testId}\` | ${r.severity} | ${r.kind} / ${r.judge} | ${mark}${r.knownIssue && r.status === "fail" ? " (known)" : ""} | ${esc(r.assertion)} | ${esc(r.actual).slice(0, 220)} |`);
    }
    L.push("");
  }
  return L.join("\n");
}

const csv = (v: string) => `"${v.replace(/"/g, '""')}"`;

export function writeReports(opts: { reportDir: string; privateDir: string | null; meta: RunMeta; summary: Summary; results: AssertionResult[]; reviewQueue: ReviewItem[] }) {
  const dir = join(opts.reportDir, opts.meta.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "report.json"), JSON.stringify({ meta: opts.meta, summary: opts.summary, results: opts.results }, null, 2));
  const md = toMarkdown(opts.meta, opts.summary, opts.results);
  writeFileSync(join(dir, "report.md"), md);
  writeFileSync(join(opts.reportDir, "LATEST.md"), md);
  let reviewPath: string | null = null;
  if (opts.reviewQueue.length && opts.privateDir) {
    // Review material can contain founder text, so it is written only under the git-ignored private folder.
    mkdirSync(opts.privateDir, { recursive: true });
    reviewPath = join(opts.privateDir, `${opts.meta.runId}-review-queue.csv`);
    writeFileSync(reviewPath, ["testId,reviewHash,rubric,material,verdict(pass|fail),reviewer,note", ...opts.reviewQueue.map((q) => [q.testId, q.reviewHash, q.rubric, q.material, "", "", ""].map(csv).join(","))].join("\n"));
  }
  return { dir, reviewPath };
}
