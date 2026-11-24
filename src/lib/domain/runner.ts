// Job execution shared by the UI store and tests. `mutate` applies a change to the workspace
// (in the UI it triggers a re-render, so every processing step is visible).
import type { DocInput } from "@/lib/engine/pipeline";
import { processApplication } from "@/lib/engine/process";
import { activeProvider } from "@/lib/engine/evaluation/provider";
import { checkOverlap } from "@/lib/engine/overlap/overlap";
import type { Role } from "@/lib/shared/types";
import type { IntakeGroup } from "./intake";
import { profileFromStore } from "./profile";
import { SCREENING_WARNING_RE, screeningWarnings } from "@/lib/engine/pipeline";
import {
  activeCriteria,
  activePortfolio,
  activeThesis,
  applyProcessResult,
  applyReevaluation,
  createApplication,
  failJob,
  getApp,
  nowIso,
  setJobStep,
  type WorkspaceData,
} from "./workspace";

type Mutate = (fn: (d: WorkspaceData) => void) => void;
type Read = () => WorkspaceData;

export function enqueueGroups(mutate: Mutate, role: Role, groups: IntakeGroup[], batchId: string, pending: Map<string, DocInput[]>, isSeed = false): string[] {
  const ids: string[] = [];
  for (const g of groups) {
    if (!g.docs.length && !g.failures.length) continue; // only duplicates — nothing new to create
    mutate((d) => {
      const { appId, jobId } = createApplication(d, role, { label: g.label, batchId, failures: g.failures, hasDocs: g.docs.length > 0, isSeed });
      ids.push(appId);
      if (jobId) pending.set(jobId, g.docs);
    });
  }
  return ids;
}

export async function runJob(mutate: Mutate, read: Read, jobId: string, docs: DocInput[], role: Role, opts: { simulateFailure?: boolean } = {}) {
  const d0 = read();
  const job = d0.jobs.find((j) => j.id === jobId);
  if (!job) return;
  const app = getApp(d0, job.applicationId);
  try {
    mutate((d) => setJobStep(d, jobId, "extracting"));
    if (opts.simulateFailure) throw new Error("AI provider unavailable (simulated outage)");
    const cur = read();
    const result = await processApplication({
      applicationId: app.id,
      cycleId: app.currentCycleId,
      actor: role,
      docs,
      thesis: activeThesis(cur),
      criteria: activeCriteria(cur),
      portfolio: activePortfolio(cur),
      learningRules: cur.learningRules,
      nameHint: app.name,
      onStep: (step) => mutate((d) => setJobStep(d, jobId, step)),
    });
    mutate((d) => applyProcessResult(d, jobId, result));
  } catch (e) {
    mutate((d) => failJob(d, jobId, e instanceof Error ? e.message : String(e)));
  }
}

export async function drain(mutate: Mutate, read: Read, pending: Map<string, DocInput[]>, role: Role) {
  // Concurrency 1 by default (resource constraints). Jobs whose documents are gone (page reload) fail visibly.
  for (;;) {
    const next = read().jobs.find((j) => j.status === "queued");
    if (!next) break;
    const docs = pending.get(next.id);
    if (!docs) {
      mutate((d) => failJob(d, next.id, "Documents are no longer in memory (page was reloaded during processing). Re-upload to retry."));
      continue;
    }
    await runJob(mutate, read, next.id, docs, role);
    pending.delete(next.id);
  }
}

export async function reevaluate(mutate: Mutate, read: Read, appId: string, role: Role) {
  const d = read();
  const app = getApp(d, appId);
  if (app.processingStatus === "failed") throw new Error("Cannot re-evaluate: processing failed. Re-upload documents.");
  const profile = profileFromStore(d, appId);
  const now = nowIso();
  const overlap = checkOverlap(appId, profile, activePortfolio(d), now);
  const ev = await activeProvider().evaluate({
    applicationId: appId,
    cycleId: app.currentCycleId,
    profile,
    claims: d.claims.filter((c) => c.applicationId === appId),
    conflicts: d.conflicts.filter((c) => c.applicationId === appId),
    thesis: activeThesis(d),
    criteria: activeCriteria(d),
    learningRules: d.learningRules,
    overlap,
    now,
  });
  mutate((w) => {
    applyReevaluation(w, appId, ev, overlap, role);
    // Keep the reviewer-facing screening warning in step with restorations (P2 C8).
    const a = w.applications.find((x) => x.id === appId);
    if (a && profile.screening) a.warnings = [...a.warnings.filter((x) => !SCREENING_WARNING_RE.test(x)), ...screeningWarnings(profile.screening)];
  });
}
