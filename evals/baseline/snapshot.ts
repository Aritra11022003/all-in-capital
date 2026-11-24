// Semantic snapshot of the 10 seed applications and of the scoring constants, used as the regression baseline
// (REG-01, REG-05, REG-06). Baselines are versioned and frozen; a new version never overwrites an old one.
//   v1  seed-baseline.json     captured at aec236a, BEFORE P2. Kept unchanged as the reference for lineage (REG-06)
//                              and for the pre-P3 comparison (DI-16).
//   v2  seed-baseline.v2.json  captured after P3 with explicit approval: v1 plus the two approved flag-only seed
//                              conflicts (EarnWise, Yatrika) and the approved P-C flag wording. Current baseline.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { processApplication } from "@/lib/engine/process";
import { THESIS_V1, CRITERIA_V1 } from "@/config/thesis";
import { PORTFOLIO_V1 } from "@/config/portfolio";
import { SEED, seedDocs } from "../../tests/helpers";

/** v1: frozen pre-P2 baseline. Never rewritten. */
export const BASELINE_V1_FILE = join("evals", "baseline", "seed-baseline.json");
/** Current baseline used by REG-01 and REG-05. */
export const BASELINE_FILE = join("evals", "baseline", "seed-baseline.v2.json");

/**
 * Declarative record of each baseline version after v1. Capture (npm run eval:baseline) writes the LAST release,
 * so a future version is a new entry here (new file name, its predecessor, its approved changes) — the capture
 * script itself holds no version-specific text. Existing releases are frozen.
 */
export interface BaselineRelease {
  version: number;
  file: string;
  supersedes: { version: number; file: string; description: string };
  approvedChanges: string[];
  note: string;
}
export const BASELINE_RELEASES: BaselineRelease[] = [
  {
    version: 2,
    file: BASELINE_FILE,
    supersedes: { version: 1, file: BASELINE_V1_FILE, description: "v1, captured at aec236a before P2; kept unchanged" },
    approvedChanges: [
      'EarnWise: new flag-only conflict "fact|fact:team_size|Team size may be counted differently: 5 vs 12"',
      'Yatrika: new flag-only conflict "coverage|raise|Amount raising stated only in the form"',
      'Pumpwise: approved P-C flag wording ("info:Deeptech: Kushal may share this application with Aditya for technical review (Meeting 3). Access is granted explicitly, never from document content.")',
    ],
    note: "v2: captured after P3 data-integrity remediation, with explicit approval of the two new flag-only seed findings. Scores and recommendations identical to v1. Frozen: never overwritten.",
  },
];
export const CURRENT_RELEASE = BASELINE_RELEASES[BASELINE_RELEASES.length - 1];
export const BASELINE_VERSION = CURRENT_RELEASE.version;

/** The only differences v2 may have from v1 (checked by REG-06). Approved by the user after P3 review. */
export const APPROVED_V2_CONFLICT_ADDITIONS: Record<string, string[]> = {
  EarnWise: ["fact|fact:team_size|Team size may be counted differently: 5 vs 12"],
  Yatrika: ["coverage|raise|Amount raising stated only in the form"],
};
const FIXED_NOW = "2026-11-24T10:00:00.000Z";

export interface AppSnapshot {
  name: string;
  recommendation: string;
  overall: number | null;
  coverage: number;
  criteria: Record<string, { score: number | null; state: string; confidence: string; effects: string[] }>;
  conflicts: string[];
  overlap: { status: string; results: string[] };
  tags: string[];
  sectorKey: string;
  stage: string | null;
  raiseInr: number | null;
  fields: Record<string, string | null>;
  warnings: string[];
  flags: string[];
  reasons: string[];
}

export async function seedSnapshot(): Promise<Record<string, AppSnapshot>> {
  const out: Record<string, AppSnapshot> = {};
  for (const s of SEED) {
    const r = await processApplication({ applicationId: "snap", cycleId: "snap", actor: "riya", docs: seedDocs(s.key), thesis: THESIS_V1, criteria: CRITERIA_V1, portfolio: PORTFOLIO_V1, learningRules: [], now: FIXED_NOW, nameHint: s.key });
    out[s.key] = {
      name: r.analysis.company.name,
      recommendation: r.evaluation.recommendation,
      overall: r.evaluation.overall,
      coverage: r.evaluation.coverage,
      criteria: Object.fromEntries(
        r.evaluation.assessments.map((a) => [a.criterion, { score: a.score, state: a.evidenceState, confidence: a.confidence, effects: [...a.supporting, ...a.opposing, ...a.notes].map((x) => `${x.kind}:${x.effect}`).sort() }]),
      ),
      conflicts: r.analysis.conflicts.map((c) => `${c.type}|${c.metric}|${c.label}`).sort(),
      overlap: { status: r.overlap.status, results: r.overlap.results.map((x) => `${x.portfolioName}:${x.relationship}`).sort() },
      tags: [...r.analysis.profile.tags].sort(),
      sectorKey: r.analysis.profile.sectorKey,
      stage: r.analysis.profile.stage,
      raiseInr: r.analysis.profile.raiseInr,
      fields: Object.fromEntries(r.analysis.fields.map((f) => [f.field, f.value])),
      warnings: [...r.analysis.warnings].sort(),
      flags: r.evaluation.flags.map((f) => `${f.level}:${f.text}`).sort(),
      reasons: r.evaluation.recommendationReasons,
    };
  }
  return out;
}

/** Numeric literals inside the recommendation-rule block of the evaluator (thresholds must never change). */
export function recommendationThresholds(): number[] {
  const src = readFileSync(join("src", "lib", "engine", "evaluation", "mock.ts"), "utf8");
  const start = src.indexOf("// ---------------- Recommendation");
  const end = src.indexOf('if (rec === "take_call" && overlap', start);
  const block = src.slice(start, end).replace(/`[^`]*`/g, "``").replace(/"[^"]*"/g, '""'); // ignore numbers inside reason strings
  return (block.match(/(?<![\w.])\d+(?:\.\d+)?(?![\w.])/g) ?? []).map(Number);
}

export function scoringConfigHash(): string {
  const cfg = { criteria: CRITERIA_V1.criteria.map((c) => ({ id: c.id, weight: c.weight, policy: c.missingMetricPolicy })), thesis: THESIS_V1 };
  return createHash("sha256").update(JSON.stringify(cfg)).digest("hex").slice(0, 16);
}

/**
 * Where a baseline was captured from. An uncommitted tree is never presented as a commit: `headCommit` is the
 * commit the tree was based on, `workingTreeClean` says whether it had changes, and `diffSha256` pins those changes.
 */
export interface SourceProvenance {
  headCommit: string;
  workingTreeClean: boolean;
  /** sha256 over `git diff --binary HEAD` + "path\0sha256(content)\n" per untracked file (sorted), within diffScope. */
  diffSha256?: string;
  diffScope?: string;
  trackedChanged?: number;
  untracked?: number;
  note?: string;
}

/** Provenance of the current working tree, excluding the given paths (e.g. the baseline file being written). */
export function workingTreeProvenance(exclude: string[]): SourceProvenance {
  const spec = [".", ...exclude.map((p) => `:(exclude)${p}`)];
  const git = (...a: string[]) => execFileSync("git", a, { maxBuffer: 1 << 28 });
  const h = createHash("sha256");
  h.update(git("diff", "--binary", "HEAD", "--", ...spec));
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z", "--", ...spec).toString().split("\0").filter(Boolean).sort();
  for (const f of untracked) h.update(`${f}\0${createHash("sha256").update(readFileSync(f)).digest("hex")}\n`);
  const changed = git("diff", "--name-only", "HEAD", "--", ...spec).toString().split("\n").filter(Boolean);
  const clean = changed.length + untracked.length === 0;
  return {
    headCommit: git("rev-parse", "--short", "HEAD").toString().trim(),
    workingTreeClean: clean,
    ...(clean ? {} : { diffSha256: h.digest("hex"), diffScope: `git diff --binary HEAD plus untracked files, excluding: ${exclude.join(", ") || "nothing"}`, trackedChanged: changed.length, untracked: untracked.length }),
  };
}

export interface Baseline {
  version?: number;
  supersedes?: string;
  /** SHA-256 of the superseded baseline file's exact bytes: the version chain is verified before any comparison. */
  supersedesSha256?: string;
  approvedChanges?: string[];
  capturedAt: string;
  /** v1 only (legacy field): the commit the v1 snapshot was captured at. Later versions use `source`. */
  gitCommit?: string;
  source?: SourceProvenance;
  note: string;
  thresholds: number[];
  scoringConfigHash: string;
  apps: Record<string, AppSnapshot>;
}

export function loadBaseline(file = BASELINE_FILE): Baseline {
  return JSON.parse(readFileSync(file, "utf8"));
}

export const sha256File = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");

/** Verifies a baseline file against a recorded checksum. Never throws; says clearly why it fails. */
export function checkBaselineFile(file: string, expectedSha256: string | undefined): { ok: boolean; reason: string } {
  if (!expectedSha256) return { ok: false, reason: `no checksum recorded for ${file}` };
  if (!existsSync(file)) return { ok: false, reason: `${file} is missing` };
  const actual = sha256File(file);
  return actual === expectedSha256 ? { ok: true, reason: `${file} matches sha256 ${actual.slice(0, 12)}…` } : { ok: false, reason: `${file} has been modified (sha256 ${actual.slice(0, 12)}…, expected ${expectedSha256.slice(0, 12)}…)` };
}

/** v1, verified against the checksum recorded in the current baseline. Throws a clear error if missing or modified. */
export function loadBaselineV1(): Baseline {
  const chk = checkBaselineFile(BASELINE_V1_FILE, loadBaseline().supersedesSha256);
  if (!chk.ok) throw new Error(`Baseline v1 integrity check failed: ${chk.reason}`);
  return loadBaseline(BASELINE_V1_FILE);
}

/** Version metadata for a release; the predecessor must exist and is pinned by its checksum. */
export function releaseMetadata(r: BaselineRelease): Pick<Baseline, "version" | "supersedes" | "supersedesSha256" | "approvedChanges" | "note"> {
  if (r.file === r.supersedes.file || BASELINE_RELEASES.some((x) => x !== r && x.file === r.file) || r.file === BASELINE_V1_FILE) throw new Error(`Release v${r.version} must use a new file name (${r.file} is already a baseline).`);
  if (!existsSync(r.supersedes.file)) throw new Error(`Cannot capture v${r.version}: predecessor ${r.supersedes.file} is missing.`);
  return { version: r.version, supersedes: `${r.supersedes.file} (${r.supersedes.description})`, supersedesSha256: sha256File(r.supersedes.file), approvedChanges: r.approvedChanges, note: r.note };
}

/**
 * Creates a new baseline file atomically: the exclusive-create flag ("wx", O_CREAT|O_EXCL) makes the operating
 * system refuse if the file already exists, so an existing version can never be overwritten or truncated.
 */
export function writeNewBaseline(file: string, b: Baseline): void {
  try {
    writeFileSync(file, JSON.stringify(b, null, 2) + "\n", { flag: "wx" });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${file} already exists and is frozen; refusing to overwrite it. Add a new release with a new file name to capture another version.`);
    throw e;
  }
}
