// Framework-free workspace model. All mutations go through these functions, which enforce permissions
// and write audit events. The zustand store (src/lib/store.ts) wraps them; tests call them directly.
import type {
  Application,
  ApplicationCycle,
  AuditEvent,
  AvailabilityRule,
  Claim,
  Company,
  Conflict,
  CorrectionCategory,
  CriteriaVersion,
  CriterionAssessment,
  CriterionId,
  DocumentRec,
  Evaluation,
  EvidenceClass,
  EvidenceSource,
  EvidenceState,
  Confidence,
  ExtractedField,
  FeedbackCorrection,
  Founder,
  Job,
  LearningRule,
  MeetingSlot,
  OverlapCheck,
  PartnerDecision,
  PartnerDecisionType,
  PassReason,
  PortfolioCompany,
  PortfolioDataset,
  ResearchStatus,
  ResearchTask,
  Role,
  SourceType,
  ThesisVersion,
} from "@/lib/shared/types";
import { assertCan, canViewDocuments, hasDocumentGrant, ROLE_INFO } from "./permissions";
import { screenDocuments, spanLocation, type ScreenedSpan } from "@/lib/engine/safety/untrusted";
import { DECISION_TO_STATUS } from "@/lib/shared/labels";
import { attendeesFor, DEFAULT_AVAILABILITY, proposeSlots } from "./scheduling";
import { CRITERIA_V1, THESIS_V1 } from "@/config/thesis";
import { PORTFOLIO_V1 } from "@/config/portfolio";
import { uid } from "@/lib/engine/pipeline";
import type { ProcessResult } from "@/lib/engine/process";
import { checkOverlap } from "@/lib/engine/overlap/overlap";

export const WORKSPACE_VERSION = 3;

export interface WorkspaceData {
  version: number;
  createdAt: string;
  applications: (Application & { viewedBy: Role[]; comments: { id: string; by: Role; at: string; text: string; criterion?: CriterionId }[] })[];
  companies: Company[];
  founders: Founder[];
  cycles: ApplicationCycle[];
  documents: DocumentRec[];
  fields: ExtractedField[];
  claims: Claim[];
  evidence: EvidenceSource[];
  conflicts: Conflict[];
  research: ResearchTask[];
  evaluations: Evaluation[];
  corrections: FeedbackCorrection[];
  learningRules: LearningRule[];
  thesisVersions: ThesisVersion[];
  criteriaVersions: CriteriaVersion[];
  portfolioDatasets: PortfolioDataset[];
  overlapChecks: OverlapCheck[];
  decisions: PartnerDecision[];
  availability: AvailabilityRule[];
  slots: MeetingSlot[];
  audit: AuditEvent[];
  jobs: Job[];
  /** P2 C8: reviewer decisions to restore screened (set-aside) founder text. Optional for older workspaces. */
  screeningRestorations?: ScreeningRestoration[];
}

export interface ScreeningRestoration {
  applicationId: string;
  spanId: string;
  restoredBy: Role;
  at: string;
  note: string;
  revokedBy?: Role;
  revokedAt?: string;
}

export type AppRec = WorkspaceData["applications"][number];

export function emptyWorkspace(now = new Date().toISOString()): WorkspaceData {
  return {
    version: WORKSPACE_VERSION,
    createdAt: now,
    applications: [],
    companies: [],
    founders: [],
    cycles: [],
    documents: [],
    fields: [],
    claims: [],
    evidence: [],
    conflicts: [],
    research: [],
    evaluations: [],
    corrections: [],
    learningRules: [],
    thesisVersions: [THESIS_V1],
    criteriaVersions: [CRITERIA_V1],
    portfolioDatasets: [PORTFOLIO_V1],
    overlapChecks: [],
    decisions: [],
    availability: DEFAULT_AVAILABILITY,
    slots: [],
    audit: [],
    jobs: [],
  };
}

// ---------------------------------------------------------------- helpers
export const nowIso = () => new Date().toISOString();

export function audit(d: WorkspaceData, actor: Role | "system", action: string, entity: string, entityId: string, detail: string, applicationId?: string, at = nowIso()) {
  d.audit.unshift({ id: uid("aud"), at, actor, action, entity, entityId, applicationId, detail });
}

export function getApp(d: WorkspaceData, id: string): AppRec {
  const a = d.applications.find((x) => x.id === id);
  if (!a) throw new Error(`Application ${id} not found.`);
  return a;
}

export const activeCriteria = (d: WorkspaceData): CriteriaVersion =>
  [...d.criteriaVersions].reverse().find((c) => c.status === "approved") ?? d.criteriaVersions[0];
export const activeThesis = (d: WorkspaceData): ThesisVersion =>
  [...d.thesisVersions].reverse().find((t) => t.status === "approved") ?? d.thesisVersions[0];
export const activePortfolio = (d: WorkspaceData): PortfolioDataset => d.portfolioDatasets[d.portfolioDatasets.length - 1];

export function latestEvaluation(d: WorkspaceData, appId: string): Evaluation | undefined {
  const app = d.applications.find((a) => a.id === appId);
  const evs = d.evaluations.filter((e) => e.applicationId === appId);
  return evs.filter((e) => e.cycleId === app?.currentCycleId).pop() ?? evs[evs.length - 1];
}

export function latestOverlap(d: WorkspaceData, appId: string): OverlapCheck | undefined {
  return d.overlapChecks.filter((o) => o.applicationId === appId).pop();
}

/** Score after human corrections. The AI's original assessment is never modified. */
export function effectiveAssessment(d: WorkspaceData, ev: Evaluation, criterion: CriterionId): CriterionAssessment & { corrected?: FeedbackCorrection } {
  const base = ev.assessments.find((a) => a.criterion === criterion)!;
  const corr = d.corrections.filter((c) => c.evaluationId === ev.id && c.criterion === criterion).pop();
  if (!corr) return base;
  return { ...base, score: corr.revised.score, evidenceState: corr.revised.evidenceState, confidence: corr.revised.confidence, corrected: corr };
}

export function effectiveOverall(d: WorkspaceData, ev: Evaluation): number | null {
  const crit = d.criteriaVersions.find((c) => c.id === ev.criteriaVersionId) ?? activeCriteria(d);
  const xs = ev.assessments.map((a) => ({ a: effectiveAssessment(d, ev, a.criterion), w: crit.criteria.find((c) => c.id === a.criterion)?.weight ?? 1 }));
  const scored = xs.filter((x) => x.a.score !== null);
  if (!scored.length) return null;
  const w = scored.reduce((n, x) => n + x.w, 0);
  return Math.round((scored.reduce((n, x) => n + x.a.score! * x.w, 0) / w) * 100) / 100;
}

// ---------------------------------------------------------------- intake
export interface IntakeFailure {
  filename: string;
  size: number;
  error: string;
  code: string;
}

export function createApplication(
  d: WorkspaceData,
  role: Role,
  opts: { label: string; batchId: string; failures: IntakeFailure[]; hasDocs: boolean; now?: string; isSeed?: boolean },
): { appId: string; jobId: string | null } {
  assertCan(role, "application.create");
  const now = opts.now ?? nowIso();
  const appId = uid("app");
  const cycleId = uid("cyc");
  const companyId = uid("co");
  d.companies.push({ id: companyId, name: opts.label, legalName: null, website: null, location: null, incorporated: null });
  d.cycles.push({ id: cycleId, applicationId: appId, number: 1, openedAt: now, openedBy: role, reason: "Initial application" });
  const errors = opts.failures.map((f) => `${f.filename}: ${f.error}`);
  d.applications.push({
    id: appId,
    companyId,
    name: opts.label,
    oneLiner: null,
    sectorSelected: null,
    sectorKey: "unknown",
    tags: [],
    stage: null,
    raiseInr: null,
    valuationInr: null,
    source: null,
    batchId: opts.batchId,
    processingStatus: opts.hasDocs ? "received" : "failed",
    decisionStatus: "not_reviewed",
    currentCycleId: cycleId,
    createdAt: now,
    createdBy: role,
    errors,
    warnings: [],
    isSeed: opts.isSeed,
    viewedBy: [],
    comments: [],
  });
  for (const f of opts.failures) {
    d.documents.push({
      id: uid("doc"),
      applicationId: appId,
      cycleId,
      kind: "other",
      filename: f.filename,
      ext: f.filename.split(".").pop()?.toLowerCase() ?? "",
      size: f.size,
      sha256: "",
      uploadedBy: role,
      uploadedAt: now,
      method: null,
      pages: [],
      status: "failed",
      error: f.error,
      warnings: [],
    });
  }
  audit(d, role, "application.created", "application", appId, `Application "${opts.label}" received${opts.failures.length ? ` with ${opts.failures.length} unreadable file(s)` : ""}.`, appId, now);
  let jobId: string | null = null;
  if (opts.hasDocs) {
    jobId = uid("job");
    d.jobs.push({ id: jobId, applicationId: appId, type: "process_application", status: "queued", step: "queued", attempts: 0, createdAt: now });
  } else {
    audit(d, "system", "processing.failed", "application", appId, "No readable documents. Processing failed; decision status unchanged (Not reviewed).", appId, now);
  }
  return { appId, jobId };
}

export function setJobStep(d: WorkspaceData, jobId: string, step: string) {
  const j = d.jobs.find((x) => x.id === jobId);
  if (!j) return;
  if (j.status === "queued") {
    j.status = "running";
    j.startedAt = nowIso();
    j.attempts += 1;
  }
  j.step = step;
  const app = d.applications.find((a) => a.id === j.applicationId);
  if (app && ["extracting", "research_queued", "research_in_progress", "evaluation_queued", "evaluation_in_progress"].includes(step)) app.processingStatus = step as Application["processingStatus"];
}

/** A technical failure NEVER touches decisionStatus. */
export function failJob(d: WorkspaceData, jobId: string, error: string) {
  const j = d.jobs.find((x) => x.id === jobId);
  if (!j) return;
  j.status = "failed";
  j.error = error;
  j.finishedAt = nowIso();
  if (j.startedAt) j.durationMs = Date.parse(j.finishedAt) - Date.parse(j.startedAt);
  const app = d.applications.find((a) => a.id === j.applicationId);
  if (app) {
    app.processingStatus = "failed";
    app.errors.push(error);
    audit(d, "system", "processing.failed", "job", jobId, `Processing failed: ${error}. Decision status left as "${app.decisionStatus}".`, app.id);
  }
}

export function applyProcessResult(d: WorkspaceData, jobId: string, r: ProcessResult) {
  const j = d.jobs.find((x) => x.id === jobId)!;
  const app = getApp(d, j.applicationId);
  const a = r.analysis;
  // one company → many applications: reuse an existing company with the same name
  const existing = d.companies.find((c) => c.id !== app.companyId && c.name.toLowerCase() === a.company.name.toLowerCase());
  const placeholder = d.companies.find((c) => c.id === app.companyId);
  if (existing) {
    d.companies = d.companies.filter((c) => c.id !== app.companyId);
    app.companyId = existing.id;
    Object.assign(existing, { ...a.company, id: existing.id });
    app.warnings.push(`Company "${existing.name}" already has another application; linked to the same company record.`);
  } else if (placeholder) Object.assign(placeholder, { ...a.company, id: placeholder.id });
  for (const f of a.founders) d.founders.push({ ...f, companyId: app.companyId });
  for (const doc of a.documents) d.documents.push({ ...doc, cycleId: app.currentCycleId });
  d.fields.push(...a.fields);
  d.claims.push(...a.claims.map((c) => ({ ...c, cycleId: app.currentCycleId })));
  d.conflicts.push(...a.conflicts);
  // every claim gets an evidence-ledger entry pointing at its stored source page
  for (const c of a.claims) {
    if (c.text.startsWith("Deck slide headline")) continue;
    const doc = a.documents.find((x) => x.id === c.sourceDocId);
    d.evidence.push({
      id: uid("evd"),
      applicationId: app.id,
      claimIds: [c.id],
      sourceType: "applicant_document",
      title: doc?.filename ?? "Applicant document",
      publisher: `${a.company.name} (applicant)`,
      retrievedAt: doc?.uploadedAt ?? nowIso(),
      excerpt: c.excerpt,
      location: c.sourceLabel,
      direction: "context",
      verification: c.classification,
      independent: false,
      criteria: c.criteria,
      addedBy: "system",
    });
  }
  d.research.push(...r.research);
  d.overlapChecks.push(r.overlap);
  d.evaluations.push({ ...r.evaluation, cycleId: app.currentCycleId });
  Object.assign(app, a.appPatch);
  app.warnings.push(...a.warnings);
  const severe = !a.profile.hasDeck && !a.profile.hasForm;
  app.processingStatus = severe || r.evaluation.coverage < 0.5 || app.errors.length ? "needs_attention" : "ready_for_review";
  j.status = "succeeded";
  j.step = "done";
  j.finishedAt = nowIso();
  if (j.startedAt) j.durationMs = Date.parse(j.finishedAt) - Date.parse(j.startedAt);
  audit(d, "system", "evaluation.created", "evaluation", r.evaluation.id, `Evaluated by ${r.evaluation.providerLabel}: overall ${r.evaluation.overall ?? "n/a"}, recommendation "${r.evaluation.recommendation}" (simulated; not a decision).`, app.id);
}

/** Reprocess (new evaluation for the current cycle) — keeps previous evaluations. */
export function applyReevaluation(d: WorkspaceData, appId: string, ev: Evaluation, overlap: OverlapCheck, actor: Role) {
  const app = getApp(d, appId);
  d.overlapChecks.push(overlap);
  d.evaluations.push({ ...ev, cycleId: app.currentCycleId });
  audit(d, actor, "evaluation.rerun", "evaluation", ev.id, `Re-evaluated with ${ev.criteriaVersionId}, ${ev.thesisVersionId}, ${ev.portfolioDatasetVersion}. Previous evaluations retained.`, appId);
}

export function markViewed(d: WorkspaceData, appId: string, role: Role) {
  const app = d.applications.find((a) => a.id === appId);
  if (app && !app.viewedBy.includes(role)) {
    app.viewedBy.push(role);
    audit(d, role, "application.viewed", "application", appId, "Opened application detail.", appId);
  }
}

// ---------------------------------------------------------------- extraction review
export function editField(d: WorkspaceData, role: Role, fieldId: string, value: string | null) {
  assertCan(role, "extraction.edit");
  const f = d.fields.find((x) => x.id === fieldId);
  if (!f) throw new Error("Field not found.");
  if (f.originalValue === undefined) f.originalValue = f.value;
  const before = f.value;
  f.value = value && value.trim() ? value.trim() : null;
  f.validation = f.value === f.originalValue ? "human_confirmed" : "human_edited";
  f.editedBy = role;
  audit(d, role, "extraction.edited", "extracted_field", fieldId, `${f.label}: "${before ?? "—"}" → "${f.value ?? "—"}"`, f.applicationId);
}

export function confirmField(d: WorkspaceData, role: Role, fieldId: string) {
  assertCan(role, "extraction.edit");
  const f = d.fields.find((x) => x.id === fieldId);
  if (!f) return;
  f.validation = "human_confirmed";
  f.editedBy = role;
  audit(d, role, "extraction.confirmed", "extracted_field", fieldId, `${f.label} confirmed as extracted.`, f.applicationId);
}

// ---------------------------------------------------------------- evidence & research
export function resolveConflict(d: WorkspaceData, role: Role, id: string, status: Conflict["status"], note: string) {
  assertCan(role, "conflict.resolve");
  if (!note.trim()) throw new Error("A note is required to change a conflict's status.");
  const c = d.conflicts.find((x) => x.id === id);
  if (!c) throw new Error("Conflict not found.");
  c.status = status;
  c.resolutionNote = note.trim();
  c.resolvedBy = role;
  audit(d, role, "conflict.updated", "conflict", id, `${c.label} → ${status}: ${note}`, c.applicationId);
}

export function addEvidence(
  d: WorkspaceData,
  role: Role,
  e: { applicationId: string; claimIds: string[]; sourceType: SourceType; title: string; publisher: string; url?: string; publishedAt?: string; excerpt: string; location: string; direction: EvidenceSource["direction"]; criteria: CriterionId[]; reviewerNotes?: string; researchTaskId?: string },
): string {
  assertCan(role, "evidence.add");
  if (!e.title.trim() || !e.excerpt.trim()) throw new Error("Evidence needs a source title and a relevant excerpt.");
  if (e.url && !/^https?:\/\//i.test(e.url)) throw new Error("Source URL must start with http:// or https://");
  const independent = e.sourceType !== "applicant_document" && e.sourceType !== "directory_aggregator";
  const id = uid("evd");
  const verification: EvidenceClass = e.direction === "contradicts" ? "conflicting" : independent ? "independent" : "unverified";
  d.evidence.push({ ...e, id, retrievedAt: nowIso(), verification, independent, addedBy: role });
  // update claim classifications: two independent supporting sources → corroborated
  for (const cid of e.claimIds) {
    const claim = d.claims.find((c) => c.id === cid);
    if (!claim) continue;
    const ext = d.evidence.filter((x) => x.claimIds.includes(cid) && x.independent);
    if (ext.some((x) => x.direction === "contradicts")) claim.classification = "conflicting";
    else if (ext.filter((x) => x.direction === "supports").length >= 2) claim.classification = "corroborated";
    else if (ext.some((x) => x.direction === "supports")) claim.classification = "independent";
  }
  audit(d, role, "evidence.added", "evidence_source", id, `${e.sourceType}: "${e.title}" (${e.direction}) linked to ${e.claimIds.length} claim(s).`, e.applicationId);
  return id;
}

export function updateResearchTask(d: WorkspaceData, role: Role, id: string, patch: { status?: ResearchStatus; findings?: string; sourcesExamined?: string[]; unanswered?: string[]; conflicts?: string; failureReason?: string; reviewerStatus?: ResearchTask["reviewerStatus"] }) {
  assertCan(role, "research.update");
  const t = d.research.find((x) => x.id === id);
  if (!t) throw new Error("Research task not found.");
  if (patch.status === "answered" && !(patch.findings ?? t.findings).trim()) throw new Error("Record findings before marking a task answered.");
  if (patch.status === "answered" && !(patch.sourcesExamined ?? t.sourcesExamined).length) throw new Error("List at least one source examined. Research cannot be complete without sources.");
  if ((patch.status === "inaccessible" || patch.status === "blocked") && !(patch.failureReason ?? t.failureReason)?.trim()) throw new Error("Record why the research failed (inaccessible / blocked).");
  Object.assign(t, patch);
  t.retrievedAt = nowIso();
  t.providerNote = `Updated manually by ${role}.`;
  audit(d, role, "research.updated", "research_task", id, `${t.workstream}: ${t.status}${patch.failureReason ? ` — ${patch.failureReason}` : ""}`, t.applicationId);
}

// ---------------------------------------------------------------- corrections & learning
export function correctScore(
  d: WorkspaceData,
  role: Role,
  opts: { evaluationId: string; criterion: CriterionId; score: number | null; evidenceState: EvidenceState; confidence: Confidence; reason: string; category: CorrectionCategory; scope: "case_specific" | "reusable"; keywords?: string[] },
): string {
  assertCan(role, "score.correct");
  const reason = opts.reason.trim();
  if (!reason) throw new Error("A one-line reason is required for every correction.");
  if (reason.length > 240) throw new Error("Keep the reason to one line (240 characters).");
  if (opts.score !== null && (opts.score < 1 || opts.score > 5)) throw new Error("Scores must be between 1 and 5, or blank for insufficient evidence.");
  const ev = d.evaluations.find((e) => e.id === opts.evaluationId);
  if (!ev) throw new Error("Evaluation not found.");
  const orig = ev.assessments.find((a) => a.criterion === opts.criterion)!;
  const app = getApp(d, ev.applicationId);
  const id = uid("cor");
  const corr: FeedbackCorrection = {
    id,
    applicationId: ev.applicationId,
    evaluationId: ev.id,
    criterion: opts.criterion,
    original: { score: orig.score, evidenceState: orig.evidenceState, confidence: orig.confidence },
    revised: { score: opts.score, evidenceState: opts.evidenceState, confidence: opts.confidence },
    reviewer: role,
    at: nowIso(),
    reason,
    category: opts.category,
    scope: opts.scope,
    approval: opts.scope === "reusable" ? "pending" : "not_required",
    criteriaVersionId: ev.criteriaVersionId,
    provider: ev.provider,
  };
  if (opts.scope === "reusable") {
    const diff = (opts.score ?? orig.score ?? 3) - (orig.score ?? 3);
    const rule: LearningRule = {
      id: `LR-${d.learningRules.length + 1}`,
      version: 1,
      sourceCorrectionId: id,
      criterion: opts.criterion,
      condition: { sectors: app.sectorKey !== "unknown" ? [app.sectorKey] : [], keywords: (opts.keywords ?? []).map((k) => k.trim()).filter(Boolean) },
      adjustment: Math.max(-1, Math.min(1, Math.round(diff * 2) / 2)),
      note: reason,
      status: "proposed",
      proposedBy: role,
      proposedAt: corr.at,
    };
    d.learningRules.push(rule);
    corr.learningRuleId = rule.id;
  }
  d.corrections.push(corr);
  audit(d, role, "score.corrected", "criterion_assessment", `${ev.id}:${opts.criterion}`, `${opts.criterion}: ${orig.score ?? "—"} → ${opts.score ?? "—"} (${opts.scope}). Reason: ${reason}`, ev.applicationId);
  return id;
}

export function decideLearningRule(d: WorkspaceData, role: Role, ruleId: string, decision: "approved" | "rejected") {
  assertCan(role, "learning.approve");
  const r = d.learningRules.find((x) => x.id === ruleId);
  if (!r) throw new Error("Rule not found.");
  if (r.status !== "proposed") throw new Error(`Rule ${ruleId} is already ${r.status}.`);
  r.status = decision;
  r.decidedBy = role;
  r.decidedAt = nowIso();
  const corr = d.corrections.find((c) => c.id === r.sourceCorrectionId);
  if (corr) corr.approval = decision;
  audit(d, role, `learning_rule.${decision}`, "learning_rule", ruleId, `${ruleId} (${r.criterion} ${r.adjustment > 0 ? "+" : ""}${r.adjustment}) ${decision}. Applies to future evaluations only.`);
}

// ---------------------------------------------------------------- review & decisions
export function comment(d: WorkspaceData, role: Role, appId: string, text: string, criterion?: CriterionId) {
  assertCan(role, "application.comment");
  if (!text.trim()) throw new Error("Comment is empty.");
  const app = getApp(d, appId);
  app.comments.push({ id: uid("cmt"), by: role, at: nowIso(), text: text.trim(), criterion });
  audit(d, role, "comment.added", "application", appId, text.trim().slice(0, 140), appId);
}

export function submitForReview(d: WorkspaceData, role: Role, appId: string, note: string) {
  assertCan(role, "application.submit_for_review");
  const app = getApp(d, appId);
  if (app.processingStatus === "failed") throw new Error("Processing failed — fix the documents before sending to partner review.");
  if (!["not_reviewed", "reopened", "information_requested"].includes(app.decisionStatus)) throw new Error(`Application is already "${app.decisionStatus}".`);
  app.decisionStatus = "awaiting_partner_review";
  if (note.trim()) app.comments.push({ id: uid("cmt"), by: role, at: nowIso(), text: `Prepared for partner review: ${note.trim()}` });
  audit(d, role, "review.submitted", "application", appId, `Sent to partner review.${note ? ` ${note}` : ""}`, appId);
}

export function recordDecision(
  d: WorkspaceData,
  role: Role,
  opts: { applicationId: string; decision: PartnerDecisionType; rationale: string; passReason?: PassReason; now?: Date },
): string {
  // Only a human principal can finalise. There is no code path from an AI provider to this function.
  assertCan(role, "decision.record");
  const app = getApp(d, opts.applicationId);
  if (!app.viewedBy.includes("kushal")) throw new Error("Kushal must open the application before recording an outcome.");
  if (!opts.rationale.trim()) throw new Error("A rationale is required for every decision.");
  if (opts.decision === "pass" && !opts.passReason) throw new Error("Choose a pass reason.");
  const ev = latestEvaluation(d, app.id);
  const id = uid("dec");
  d.decisions.push({
    id,
    applicationId: app.id,
    cycleId: app.currentCycleId,
    decision: opts.decision,
    passReason: opts.decision === "pass" ? opts.passReason : undefined,
    rationale: opts.rationale.trim(),
    decidedBy: role,
    decidedAt: nowIso(),
    recommendationAtTime: ev?.recommendation ?? null,
    evaluationId: ev?.id ?? null,
  });
  app.decisionStatus = DECISION_TO_STATUS[opts.decision];
  audit(d, role, "decision.recorded", "partner_decision", id, `${opts.decision}${opts.passReason ? ` (${opts.passReason})` : ""}: ${opts.rationale.trim()}`, app.id);
  if (opts.decision === "approve_call") {
    const now = opts.now ?? new Date();
    const att = attendeesFor(hasDocumentGrant(app, "aditya"));
    const props = proposeSlots({ now, attendees: att, rules: d.availability, existing: d.slots });
    for (const p of props) d.slots.push({ id: uid("slot"), applicationId: app.id, start: p.start, end: p.end, attendees: att, status: "proposed", calendarSynced: false, notes: "", createdBy: role });
    audit(d, "system", "slots.proposed", "application", app.id, `${props.length} slot(s) proposed for a 30-minute call (not booked in any calendar).`, app.id);
  }
  return id;
}

export function reopen(d: WorkspaceData, role: Role, appId: string, reason: string) {
  assertCan(role, "application.reopen");
  if (!reason.trim()) throw new Error("A reason is required to reopen.");
  const app = getApp(d, appId);
  const prev = d.cycles.find((c) => c.id === app.currentCycleId);
  if (prev) prev.closedAt = nowIso();
  const cycle: ApplicationCycle = { id: uid("cyc"), applicationId: appId, number: (prev?.number ?? 0) + 1, openedAt: nowIso(), openedBy: role, reason: reason.trim() };
  d.cycles.push(cycle);
  app.currentCycleId = cycle.id;
  app.decisionStatus = "reopened";
  audit(d, role, "application.reopened", "application_cycle", cycle.id, `Cycle ${cycle.number} opened: ${reason}. Previous decisions and evaluations retained under cycle ${prev?.number}.`, appId);
}

// ---------------------------------------------------------------- scheduling
export function confirmSlot(d: WorkspaceData, role: Role, slotId: string) {
  assertCan(role, "schedule.confirm");
  const s = d.slots.find((x) => x.id === slotId);
  if (!s) throw new Error("Slot not found.");
  const app = getApp(d, s.applicationId);
  if (app.decisionStatus !== "call_approved") throw new Error("Only applications with an approved call can be scheduled.");
  for (const o of d.slots.filter((x) => x.applicationId === s.applicationId && x.id !== slotId && x.status === "proposed")) o.status = "cancelled";
  s.status = "confirmed_manual";
  s.confirmedBy = role;
  audit(d, role, "slot.confirmed", "meeting_slot", slotId, "Slot confirmed manually (no calendar connected — not a calendar booking).", s.applicationId);
}

export function cancelSlot(d: WorkspaceData, role: Role, slotId: string) {
  assertCan(role, "schedule.confirm");
  const s = d.slots.find((x) => x.id === slotId);
  if (!s) return;
  s.status = "cancelled";
  audit(d, role, "slot.cancelled", "meeting_slot", slotId, "Slot cancelled.", s.applicationId);
}

export function proposeMoreSlots(d: WorkspaceData, role: Role, appId: string, now = new Date()) {
  assertCan(role, "schedule.propose");
  const app = getApp(d, appId);
  if (app.decisionStatus !== "call_approved") throw new Error("Kushal must approve a call before slots are proposed.");
  const att = attendeesFor(hasDocumentGrant(app, "aditya"));
  const props = proposeSlots({ now, attendees: att, rules: d.availability, existing: d.slots });
  if (!props.length) throw new Error("No common availability in the next 4 weeks. Update availability rules.");
  for (const p of props) d.slots.push({ id: uid("slot"), applicationId: appId, start: p.start, end: p.end, attendees: att, status: "proposed", calendarSynced: false, notes: "", createdBy: role });
  audit(d, role, "slots.proposed", "application", appId, `${props.length} more slot(s) proposed.`, appId);
}

export function setSlotNotes(d: WorkspaceData, role: Role, slotId: string, notes: string) {
  assertCan(role, "application.comment");
  const s = d.slots.find((x) => x.id === slotId);
  if (s) s.notes = notes;
}

export function setAvailability(d: WorkspaceData, role: Role, rules: AvailabilityRule[]) {
  assertCan(role, "availability.edit");
  for (const r of rules) if (!/^\d\d:\d\d$/.test(r.start) || !/^\d\d:\d\d$/.test(r.end) || r.start >= r.end) throw new Error(`Invalid window for ${r.person}: ${r.start}–${r.end}`);
  d.availability = rules;
  audit(d, role, "availability.updated", "availability_rules", "all", `${rules.filter((r) => r.active).length} active windows.`);
}

// ---------------------------------------------------------------- thesis & criteria
export function proposeCriteriaVersion(d: WorkspaceData, role: Role, weights: Partial<Record<CriterionId, number>>, note: string): string {
  assertCan(role, "criteria.propose");
  if (!note.trim()) throw new Error("Explain the proposed change.");
  for (const [k, w] of Object.entries(weights)) if (!(typeof w === "number" && w >= 0 && w <= 3)) throw new Error(`Weight for ${k} must be between 0 and 3.`);
  const base = activeCriteria(d);
  const v = Math.max(...d.criteriaVersions.map((c) => c.version)) + 1;
  const id = `criteria-v${v}`;
  d.criteriaVersions.push({
    ...base,
    id,
    version: v,
    status: "proposed",
    createdBy: role,
    createdAt: nowIso(),
    approvedBy: undefined,
    approvedAt: undefined,
    changeNote: note.trim(),
    criteria: base.criteria.map((c) => ({ ...c, weight: weights[c.id] ?? c.weight })),
  });
  audit(d, role, "criteria.proposed", "criteria_version", id, note.trim());
  return id;
}

export function approveCriteriaVersion(d: WorkspaceData, role: Role, id: string) {
  assertCan(role, "criteria.approve");
  const v = d.criteriaVersions.find((c) => c.id === id);
  if (!v) throw new Error("Version not found.");
  for (const c of d.criteriaVersions) if (c.status === "approved") c.status = "superseded";
  v.status = "approved";
  v.approvedBy = role;
  v.approvedAt = nowIso();
  audit(d, role, "criteria.approved", "criteria_version", id, `Criteria ${id} approved. Existing evaluations keep the version they used.`);
}

// ---------------------------------------------------------------- portfolio
export function addPortfolioCompany(d: WorkspaceData, role: Role, c: Omit<PortfolioCompany, "id" | "verified">): string {
  assertCan(role, "portfolio.edit");
  if (!c.name.trim()) throw new Error("Name is required.");
  if (!c.categoryTerms.length) throw new Error("Add at least one category term so overlap checks can match it.");
  const cur = activePortfolio(d);
  if (cur.companies.some((x) => x.name.toLowerCase() === c.name.trim().toLowerCase())) throw new Error(`${c.name} is already in the portfolio dataset.`);
  const n = d.portfolioDatasets.length + 1;
  const version = `portfolio-v${n}`;
  d.portfolioDatasets.push({ ...cur, version, createdAt: nowIso(), verified: false, note: `${cur.note} Added ${c.name}.`, companies: [...cur.companies, { ...c, name: c.name.trim(), id: uid("pf"), verified: false }] });
  audit(d, role, "portfolio.updated", "portfolio_dataset", version, `Added ${c.name}. New dataset version ${version} (unverified).`);
  return version;
}

export function setPortfolioVerified(d: WorkspaceData, role: Role, verified: boolean, attestation: string) {
  assertCan(role, "overlap.review");
  if (verified && !attestation.trim()) throw new Error("Record who verified the full portfolio list and against what source.");
  const cur = activePortfolio(d);
  const version = `portfolio-v${d.portfolioDatasets.length + 1}`;
  d.portfolioDatasets.push({ ...cur, version, createdAt: nowIso(), verified, note: verified ? `Verified complete: ${attestation}` : cur.note });
  audit(d, role, "portfolio.verification", "portfolio_dataset", version, verified ? `Marked complete and verified: ${attestation}` : "Marked unverified.");
}

export function rerunOverlap(d: WorkspaceData, role: Role, appId: string, profile: Parameters<typeof checkOverlap>[1]) {
  assertCan(role, "application.view");
  const o = checkOverlap(appId, profile, activePortfolio(d), nowIso());
  d.overlapChecks.push(o);
  audit(d, role, "overlap.checked", "portfolio_overlap_check", o.id, o.statusText, appId);
}

export function reviewOverlap(d: WorkspaceData, role: Role, checkId: string, decision: OverlapCheck["reviewerDecision"], note: string) {
  assertCan(role, "overlap.review");
  if (!note.trim()) throw new Error("Add a note explaining the overlap decision.");
  const o = d.overlapChecks.find((x) => x.id === checkId);
  if (!o) throw new Error("Overlap check not found.");
  o.reviewerDecision = decision;
  o.reviewedBy = role;
  o.reviewNote = note.trim();
  audit(d, role, "overlap.reviewed", "portfolio_overlap_check", checkId, `${decision}: ${note}`, o.applicationId);
}

// ---------------------------------------------------------------- access helpers
export function visibleDocuments(d: WorkspaceData, role: Role, appId: string): { allowed: boolean; docs: DocumentRec[] } {
  const app = getApp(d, appId);
  if (!canViewDocuments(role, app)) return { allowed: false, docs: [] };
  return { allowed: true, docs: d.documents.filter((x) => x.applicationId === appId) };
}

export function findDuplicate(d: WorkspaceData, sha256: string): { doc: DocumentRec; app: AppRec } | null {
  const doc = d.documents.find((x) => x.sha256 && x.sha256 === sha256);
  if (!doc) return null;
  const app = d.applications.find((a) => a.id === doc.applicationId);
  return app ? { doc, app } : null;
}

export function qualityIndicators(d: WorkspaceData) {
  const apps = d.applications;
  const evs = apps.map((a) => latestEvaluation(d, a.id)).filter(Boolean) as Evaluation[];
  const signals = evs.flatMap((e) => e.assessments.flatMap((a) => [...a.supporting, ...a.opposing]));
  const coreFields = d.fields.filter((f) => ["company_name", "one_liner", "sector", "stage", "raise", "customers", "revenue", "acquisition", "use_of_funds"].includes(f.field));
  const appClaims = d.claims.filter((c) => !c.text.startsWith("Deck slide headline"));
  const verified = appClaims.filter((c) => ["independent", "corroborated"].includes(c.classification)).length;
  const jobs = d.jobs.filter((j) => j.status === "succeeded" || j.status === "failed");
  const decided = d.decisions.filter((x) => x.recommendationAtTime);
  const agree = decided.filter((x) => (x.decision === "approve_call" && x.recommendationAtTime === "take_call") || (x.decision === "request_info" && x.recommendationAtTime === "request_info") || (x.decision === "pass" && x.recommendationAtTime === "pass_for_consideration")).length;
  const assessments = evs.reduce((n, e) => n + e.assessments.length, 0);
  return {
    extractionCoverage: coreFields.length ? coreFields.filter((f) => f.value).length / coreFields.length : null,
    evidenceTraceability: signals.length ? signals.filter((s) => s.ref).length / signals.length : null,
    sourceVerificationRate: appClaims.length ? verified / appClaims.length : null,
    conflictsDetected: d.conflicts.length,
    conflictsOpen: d.conflicts.filter((c) => c.status === "open").length,
    criticalUnknowns: evs.reduce((n, e) => n + e.criticalUnknowns.length, 0),
    humanCorrectionRate: assessments ? d.corrections.length / assessments : null,
    recommendationAgreement: decided.length ? agree / decided.length : null,
    decisionsRecorded: decided.length,
    avgProcessingMs: jobs.length ? jobs.reduce((n, j) => n + (j.durationMs ?? 0), 0) / jobs.length : null,
    failureRate: jobs.length ? jobs.filter((j) => j.status === "failed").length / jobs.length : null,
  };
}

// ---------------------------------------------------------------- P2 review controls (C8) and access grants (P-C)

/** Span IDs a reviewer has restored and not since revoked, for one application. */
export function activeRestorationIds(d: WorkspaceData, appId: string): string[] {
  return (d.screeningRestorations ?? []).filter((r) => r.applicationId === appId && !r.revokedAt).map((r) => r.spanId);
}

/** Current screening of an application's stored documents (recomputed deterministically; originals untouched). */
export function screeningFor(d: WorkspaceData, appId: string): ScreenedSpan[] {
  const docs = d.documents.filter((x) => x.applicationId === appId && x.status === "extracted");
  return screenDocuments(docs.map((x) => ({ id: x.id, kind: x.kind, pages: x.pages })), activeRestorationIds(d, appId)).spans;
}

/**
 * Explicit reviewer action: include a set-aside passage in scoring. Requires permission and a reason, and is audited.
 * The restored text is treated as an ordinary, UNVERIFIED founder claim — restoring never verifies anything.
 * The caller re-evaluates afterwards (re-evaluation applies the same screening with this span restored).
 */
export function restoreScreenedSpan(d: WorkspaceData, role: Role, opts: { applicationId: string; spanId: string; note: string }): void {
  assertCan(role, "screening.restore");
  const note = opts.note.trim();
  if (!note) throw new Error("Give a reason for restoring this passage (it is recorded in the audit trail).");
  const span = screeningFor(d, opts.applicationId).find((s) => s.id === opts.spanId);
  if (!span) throw new Error("Passage not found for this application.");
  if (span.restored) throw new Error("This passage is already restored.");
  (d.screeningRestorations ??= []).push({ applicationId: opts.applicationId, spanId: span.id, restoredBy: role, at: nowIso(), note });
  audit(d, role, "screening.restored", "screened_span", span.id, `Restored ${span.kind.replace("_", " ")} passage [${span.id}] on ${spanLocation(span)} for scoring as an unverified founder claim. Reason: ${note}`, opts.applicationId);
}

export function revokeScreenedSpanRestoration(d: WorkspaceData, role: Role, opts: { applicationId: string; spanId: string; note: string }): void {
  assertCan(role, "screening.restore");
  const note = opts.note.trim();
  if (!note) throw new Error("Give a reason for setting this passage aside again.");
  const r = (d.screeningRestorations ?? []).find((x) => x.applicationId === opts.applicationId && x.spanId === opts.spanId && !x.revokedAt);
  if (!r) throw new Error("This passage is not currently restored.");
  r.revokedBy = role;
  r.revokedAt = nowIso();
  audit(d, role, "screening.restoration_revoked", "screened_span", opts.spanId, `Passage [${opts.spanId}] set aside again. Reason: ${note}`, opts.applicationId);
}

/** P-C: only an authenticated partner action can widen access; founder text, sector and tags never do. */
export function grantDocumentAccess(d: WorkspaceData, role: Role, opts: { applicationId: string; grantee: Role; note: string }): void {
  assertCan(role, "access.grant");
  const note = opts.note.trim();
  if (!note) throw new Error("Record why access is being shared.");
  if (opts.grantee !== "aditya") throw new Error(`${ROLE_INFO[opts.grantee].name} already has document access by role.`);
  const app = getApp(d, opts.applicationId);
  if ((app.accessGrants ?? []).some((g) => g.role === opts.grantee)) return;
  app.accessGrants = [...(app.accessGrants ?? []), { role: opts.grantee, grantedBy: role, at: nowIso(), note }];
  audit(d, role, "access.granted", "application", app.id, `Document access shared with ${ROLE_INFO[opts.grantee].name}. Reason: ${note}`, app.id);
}

export function revokeDocumentAccess(d: WorkspaceData, role: Role, opts: { applicationId: string; grantee: Role; note: string }): void {
  assertCan(role, "access.grant");
  const app = getApp(d, opts.applicationId);
  if (!(app.accessGrants ?? []).some((g) => g.role === opts.grantee)) return;
  app.accessGrants = (app.accessGrants ?? []).filter((g) => g.role !== opts.grantee);
  audit(d, role, "access.revoked", "application", app.id, `Document access withdrawn from ${ROLE_INFO[opts.grantee].name}.${opts.note.trim() ? ` Reason: ${opts.note.trim()}` : ""}`, app.id);
}
