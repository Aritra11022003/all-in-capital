// Semantic snapshot of the 10 seed applications and of the scoring constants, used as the P2 regression
// baseline (REG-01, REG-05). Captured BEFORE the P2 changes with `npm run eval:baseline`, then frozen.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { processApplication } from "@/lib/engine/process";
import { THESIS_V1, CRITERIA_V1 } from "@/config/thesis";
import { PORTFOLIO_V1 } from "@/config/portfolio";
import { SEED, seedDocs } from "../../tests/helpers";

export const BASELINE_FILE = join("evals", "baseline", "seed-baseline.json");
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

export interface Baseline {
  capturedAt: string;
  gitCommit: string;
  note: string;
  thresholds: number[];
  scoringConfigHash: string;
  apps: Record<string, AppSnapshot>;
}

export function loadBaseline(): Baseline {
  return JSON.parse(readFileSync(BASELINE_FILE, "utf8"));
}
