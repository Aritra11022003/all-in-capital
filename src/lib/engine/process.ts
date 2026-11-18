// End-to-end processing of one application: analyse → overlap → research plan → evaluation.
import type { CriteriaVersion, Evaluation, LearningRule, OverlapCheck, PortfolioDataset, ResearchTask, Role, ThesisVersion } from "@/lib/shared/types";
import { analyseDocuments, type Analysis, type DocInput } from "./pipeline";
import { checkOverlap } from "./overlap/overlap";
import { planResearch } from "./research/plan";
import { activeProvider } from "./evaluation/provider";

export interface ProcessResult {
  analysis: Analysis;
  overlap: OverlapCheck;
  research: ResearchTask[];
  evaluation: Evaluation;
}

export async function processApplication(opts: {
  applicationId: string;
  cycleId: string;
  actor: Role;
  docs: DocInput[];
  thesis: ThesisVersion;
  criteria: CriteriaVersion;
  portfolio: PortfolioDataset;
  learningRules: LearningRule[];
  now?: string;
  nameHint?: string;
  onStep?: (step: string) => void;
}): Promise<ProcessResult> {
  const now = opts.now ?? new Date().toISOString();
  if (!opts.docs.length) throw new Error("No documents to process.");
  opts.onStep?.("extracting");
  const analysis = analyseDocuments({ applicationId: opts.applicationId, cycleId: opts.cycleId, actor: opts.actor, now, docs: opts.docs, nameHint: opts.nameHint });
  opts.onStep?.("research_in_progress");
  const overlap = checkOverlap(opts.applicationId, analysis.profile, opts.portfolio, now);
  const research = planResearch(opts.applicationId, analysis.profile, analysis.conflicts);
  opts.onStep?.("evaluation_in_progress");
  const evaluation = await activeProvider().evaluate({
    applicationId: opts.applicationId,
    cycleId: opts.cycleId,
    profile: analysis.profile,
    claims: analysis.claims,
    conflicts: analysis.conflicts,
    thesis: opts.thesis,
    criteria: opts.criteria,
    learningRules: opts.learningRules,
    overlap,
    now,
  });
  return { analysis, overlap, research, evaluation };
}
