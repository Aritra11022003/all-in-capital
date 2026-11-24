// Domain types. These mirror the Supabase tables in supabase/migrations (see docs/data-dictionary).

export type Role = "kushal" | "aditya" | "riya";

export type ProcessingStatus =
  | "received"
  | "extracting"
  | "research_queued"
  | "research_in_progress"
  | "evaluation_queued"
  | "evaluation_in_progress"
  | "ready_for_review"
  | "failed"
  | "needs_attention";

export type DecisionStatus =
  | "not_reviewed"
  | "awaiting_partner_review"
  | "information_requested"
  | "on_hold"
  | "call_approved"
  | "passed_by_partner"
  | "reopened";

export type DocKind = "deck" | "form" | "other";

export type ExtractionMethod = "pdf-text" | "pptx-xml" | "docx-xml" | "xlsx-xml" | "csv" | "txt" | "pasted";

export interface DocPage {
  index: number; // 1-based page / slide / section number
  text: string;
}

export interface DocumentRec {
  id: string;
  applicationId: string;
  cycleId: string;
  kind: DocKind;
  filename: string;
  ext: string;
  size: number;
  sha256: string;
  uploadedBy: Role;
  uploadedAt: string;
  method: ExtractionMethod | null;
  pages: DocPage[];
  status: "extracted" | "failed" | "needs_attention";
  error?: string;
  warnings: string[];
}

export type FieldValidation = "parsed" | "missing" | "human_confirmed" | "human_edited";

export interface ExtractedField {
  id: string;
  applicationId: string;
  documentId: string;
  field: string; // canonical key, e.g. company_name
  label: string; // label as printed in the document
  value: string | null;
  originalText: string;
  page: number | null;
  method: "form-label" | "deck-pattern" | "derived";
  validation: FieldValidation;
  confidence: number; // 0..1
  extractedAt: string;
  editedBy?: Role;
  /** When the current value was last set by a reviewer (P3: the time a correction is recorded with). */
  editedAt?: string;
  originalValue?: string | null;
}

export type EvidenceClass =
  | "applicant_provided"
  | "independent"
  | "corroborated"
  | "conflicting"
  | "unverified"
  | "inaccessible";

export type CriterionId =
  | "founder_quality"
  | "founder_market_fit"
  | "market"
  | "traction"
  | "business_model"
  | "product_tech"
  | "path_to_market"
  | "capital_fit"
  | "thesis_fit";

export type MetricPeriod = "point" | "monthly" | "cumulative" | "annual" | "unknown";

export interface Claim {
  id: string;
  applicationId: string;
  cycleId: string;
  text: string; // human-readable statement
  metric?: string; // normalised metric key (mrr, cac, count:firms|paying ...)
  value?: number | null;
  bound?: "eq" | "lte" | "gte";
  unit?: string;
  period?: MetricPeriod;
  sourceDocId: string;
  sourceKind: DocKind;
  sourceLabel: string; // e.g. "Deck p5"
  page: number | null;
  excerpt: string;
  classification: EvidenceClass;
  criteria: CriterionId[];
  // ---- P3 (all optional: older stored workspaces load unchanged) ----
  /** Missing = "applicant". Human corrections are separate claims; founder claims are never modified. */
  origin?: ClaimOrigin;
  /** Human correction: the applicant claim(s) it corrects, who corrected and when. Not verification. */
  correctsClaimIds?: string[];
  correctedBy?: Role;
  correctedAt?: string;
  /** Earlier correction(s) of the same field that this correction replaces. Those records are kept unchanged. */
  supersedesCorrectionIds?: string[];
  /** The extracted field this claim was derived from (form answers). */
  fieldId?: string;
  /** Non-numeric fact (company name, founder, role, dates, stage, location, team size). metric = "fact:<key>". */
  fact?: { key: FactKey; value: string; normalized: string };
  /** Explicit "as of" date stated in the text (YYYY-MM). */
  asOf?: string;
  /** Came from a P2 passage a reviewer restored. Still applicant-provided and unverified. */
  restored?: boolean;
  /** No longer produced by the documents (e.g. a passage set aside again). Kept for history; ignored by checks. */
  withdrawn?: boolean;
}

export type ClaimOrigin = "applicant" | "human_correction";
export type FactKey = "company_name" | "founder" | "founder_role" | "founded" | "incorporated" | "stage" | "location" | "team_size";

export type SourceType =
  | "applicant_document"
  | "government_regulatory"
  | "official_company_record"
  | "named_customer_partner"
  | "company_website"
  | "independent_media"
  | "professional_profile"
  | "directory_aggregator"
  | "internal_record";

export interface EvidenceSource {
  id: string;
  applicationId: string;
  claimIds: string[];
  sourceType: SourceType;
  title: string;
  publisher: string;
  url?: string;
  publishedAt?: string;
  retrievedAt: string;
  excerpt: string;
  location: string;
  direction: "supports" | "contradicts" | "context";
  verification: EvidenceClass;
  independent: boolean;
  criteria: CriterionId[];
  reviewerNotes?: string;
  addedBy: Role | "system";
  researchTaskId?: string;
}

export interface ConflictSide {
  claimId: string;
  display: string;
  sourceLabel: string;
  excerpt: string;
  // P3 (optional)
  page?: number | null;
  docId?: string;
  asOf?: string;
  origin?: ClaimOrigin;
  restored?: boolean;
}

/** P3: what kind of disagreement this is. */
export type ConflictRelation = "contradiction" | "different_period" | "different_definition" | "possibly_updated" | "one_sided" | "possible_match";

export interface Conflict {
  id: string;
  applicationId: string;
  type: "numeric" | "definition" | "credential" | "qualitative" | "arithmetic" | "magnitude" | "identity" | "fact" | "period" | "update" | "coverage"; // last five: P3, always flag-only
  metric: string;
  label: string;
  a: ConflictSide;
  b: ConflictSide;
  note: string;
  criteria: CriterionId[];
  severity: "high" | "medium" | "low";
  status: "open" | "explained" | "confirmed" | "superseded";
  resolutionNote?: string;
  resolvedBy?: Role;
  // ---- P3 (all optional) ----
  relation?: ConflictRelation;
  /** Every disagreeing value, including several within one document (a/b kept for compatibility). */
  values?: ConflictSide[];
  /** Stable identity: type|metric|relation. With the value signature it forms the id, so resolutions carry over safely. */
  key?: string;
  valueSig?: string;
  /** "flag_only" conflicts are shown and audited but never affect scores or recommendations. Missing = "scored". */
  scoring?: "scored" | "flag_only";
  supersededReason?: string;
  supersededAt?: string;
  /** Status the conflict had before it was superseded, restored if the same evidence reappears. */
  supersededFrom?: "open" | "explained" | "confirmed";
  cycleId?: string;
}

export type Workstream =
  | "company_verification"
  | "founder_background"
  | "product_technology"
  | "customers_traction"
  | "market"
  | "competition"
  | "regulatory"
  | "business_model"
  | "distribution"
  | "portfolio_overlap";

export type ResearchStatus = "not_started" | "in_progress" | "answered" | "blocked" | "inaccessible";

export interface ResearchTask {
  id: string;
  applicationId: string;
  workstream: Workstream;
  question: string;
  priority: "high" | "medium" | "low";
  status: ResearchStatus;
  suggestedSources: { tier: number; name: string; note: string }[];
  sourcesExamined: string[];
  findings: string;
  unanswered: string[];
  conflicts: string;
  retrievedAt?: string;
  reviewerStatus: "pending" | "reviewed";
  providerNote: string;
  failureReason?: string;
  linkedClaimIds: string[];
}

export type EvidenceState = "strong" | "mixed" | "weak" | "insufficient" | "conflicting";
export type Confidence = "high" | "medium" | "low";

export interface Signal {
  text: string;
  effect: number; // score delta, 0 for notes
  kind: "support" | "oppose" | "note" | "unknown";
  claimId?: string;
  ref?: string; // citation such as "Form p1" or "Memo 6"
  /** The exact source sentence that triggered this signal (P2 C4); always taken from the cited page. */
  excerpt?: string;
}

export interface CriterionAssessment {
  criterion: CriterionId;
  score: number | null; // 1..5, null = insufficient evidence
  evidenceState: EvidenceState;
  confidence: Confidence;
  supporting: Signal[];
  opposing: Signal[];
  notes: Signal[];
  unknowns: string[];
  rationale: string;
  appliedRules: string[];
  reviewerComments: { by: Role; at: string; text: string }[];
}

export type Recommendation = "take_call" | "request_info" | "pass_for_consideration";

export interface RevealedCheck {
  patternId: string;
  result: "consistent" | "concern" | "not_applicable" | "unknown";
  detail: string;
}

export interface Flag {
  level: "critical" | "warning" | "info";
  text: string;
}

export interface Evaluation {
  id: string;
  applicationId: string;
  cycleId: string;
  thesisVersionId: string;
  criteriaVersionId: string;
  portfolioDatasetVersion: string;
  provider: string;
  providerLabel: string;
  simulated: boolean;
  createdAt: string;
  assessments: CriterionAssessment[];
  overall: number | null;
  coverage: number; // 0..1 share of criteria with a score
  recommendation: Recommendation;
  recommendationReasons: string[];
  flags: Flag[];
  statedThesis: { fit: "in_scope" | "out_of_scope" | "anti_thesis" | "unknown"; detail: string };
  revealedThesis: RevealedCheck[];
  appliedLearningRules: string[];
  criticalUnknowns: string[];
}

export type PartnerDecisionType = "approve_call" | "request_info" | "hold" | "pass";
export type PassReason =
  | "thesis_mismatch"
  | "founder_concern"
  | "business_model"
  | "capital_mismatch"
  | "regulatory_market_risk"
  | "insufficient_evidence"
  | "other";

export interface PartnerDecision {
  id: string;
  applicationId: string;
  cycleId: string;
  decision: PartnerDecisionType;
  passReason?: PassReason;
  rationale: string;
  decidedBy: Role;
  decidedAt: string;
  recommendationAtTime: Recommendation | null;
  evaluationId: string | null;
}

export interface ApplicationCycle {
  id: string;
  applicationId: string;
  number: number;
  openedAt: string;
  openedBy: Role;
  reason: string;
  closedAt?: string;
}

export interface Founder {
  id: string;
  companyId: string;
  name: string;
  role: string;
  background: string;
  profileUrl?: string;
  sourceLabel: string;
}

export interface Company {
  id: string;
  name: string;
  legalName: string | null;
  website: string | null;
  location: string | null;
  incorporated: string | null;
}

export type SectorKey =
  | "fintech"
  | "deeptech"
  | "consumer_tech"
  | "consumer_brand"
  | "healthcare"
  | "web3"
  | "other"
  | "unknown";

/** Explicit, human-granted access to one application's documents (P-C). Never derived from founder text. */
export interface AccessGrant {
  role: Role;
  grantedBy: Role;
  at: string;
  note: string;
}

export interface Application {
  id: string;
  companyId: string;
  name: string;
  oneLiner: string | null;
  sectorSelected: string | null;
  sectorKey: SectorKey;
  tags: string[]; // lending, deeptech, regulated, b2b ...
  stage: string | null;
  raiseInr: number | null;
  valuationInr: number | null;
  source: string | null;
  batchId: string;
  processingStatus: ProcessingStatus;
  decisionStatus: DecisionStatus;
  currentCycleId: string;
  createdAt: string;
  createdBy: Role;
  errors: string[];
  warnings: string[];
  isSeed?: boolean;
  /** P-C: explicit document-access grants (e.g. Kushal shares a deeptech file with Aditya). */
  accessGrants?: AccessGrant[];
}

export interface FeedbackCorrection {
  id: string;
  applicationId: string;
  evaluationId: string;
  criterion: CriterionId;
  original: { score: number | null; evidenceState: EvidenceState; confidence: Confidence };
  revised: { score: number | null; evidenceState: EvidenceState; confidence: Confidence };
  reviewer: Role;
  at: string;
  reason: string;
  category: CorrectionCategory;
  scope: "case_specific" | "reusable";
  approval: "not_required" | "pending" | "approved" | "rejected";
  criteriaVersionId: string;
  provider: string;
  learningRuleId?: string;
}

export type CorrectionCategory =
  | "evidence_misread"
  | "missing_context"
  | "overweighted_credentials"
  | "missing_metric_policy"
  | "thesis_interpretation"
  | "extraction_error"
  | "other";

export interface LearningRule {
  id: string;
  version: number;
  sourceCorrectionId: string;
  criterion: CriterionId;
  condition: { sectors: SectorKey[]; keywords: string[] };
  adjustment: number; // -1..+1
  note: string;
  status: "proposed" | "approved" | "rejected";
  proposedBy: Role;
  proposedAt: string;
  decidedBy?: Role;
  decidedAt?: string;
}

export interface PortfolioCompany {
  id: string;
  name: string;
  sector: string;
  description: string;
  categoryTerms: string[];
  customerTerms: string[];
  channelTerms: string[];
  source: string;
  verified: boolean;
}

export interface PortfolioDataset {
  version: string;
  createdAt: string;
  verified: boolean;
  note: string;
  companies: PortfolioCompany[];
}

export type OverlapRelationship =
  | "direct_competitor"
  | "adjacent_competitor"
  | "shared_customers"
  | "shared_channels"
  | "strategic_conflict";

export interface OverlapResult {
  portfolioId: string;
  portfolioName: string;
  relationship: OverlapRelationship;
  matchedTerms: string[];
  evidence: string;
  confidence: Confidence;
}

export interface OverlapCheck {
  id: string;
  applicationId: string;
  datasetVersion: string;
  datasetVerified: boolean;
  comparedCount: number;
  comparedNames: string[];
  results: OverlapResult[];
  status: "possible_conflicts" | "no_match_incomplete" | "no_match_verified";
  statusText: string;
  reviewerDecision: "pending" | "confirmed_conflict" | "false_alarm";
  reviewedBy?: Role;
  reviewNote?: string;
  checkedAt: string;
}

export interface AvailabilityRule {
  id: string;
  person: Role;
  weekday: number; // 0=Sun … 6=Sat
  start: string; // HH:MM IST
  end: string;
  active: boolean;
}

export interface MeetingSlot {
  id: string;
  applicationId: string;
  start: string; // ISO UTC
  end: string;
  attendees: Role[];
  status: "proposed" | "confirmed_manual" | "cancelled";
  calendarSynced: false;
  notes: string;
  createdBy: Role;
  confirmedBy?: Role;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: Role | "system";
  action: string;
  entity: string;
  entityId: string;
  applicationId?: string;
  detail: string;
}

export interface Job {
  id: string;
  applicationId: string;
  type: "process_application" | "reevaluate";
  status: "queued" | "running" | "succeeded" | "failed";
  step: string;
  attempts: number;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  durationMs?: number;
}

export interface CriterionDef {
  id: CriterionId;
  name: string;
  definition: string;
  weight: number;
  missingMetricPolicy: { sector: SectorKey; metric: string; penalty: number; citation: string }[];
}

export interface CriteriaVersion {
  id: string;
  version: number;
  status: "proposed" | "approved" | "superseded";
  createdBy: Role | "system";
  createdAt: string;
  approvedBy?: Role;
  approvedAt?: string;
  changeNote: string;
  criteria: CriterionDef[];
}

export interface RevealedPattern {
  id: string;
  title: string;
  description: string;
  citations: string[];
  status: "observed" | "contested";
}

export interface ThesisVersion {
  id: string;
  version: number;
  status: "proposed" | "approved" | "superseded";
  createdBy: Role | "system";
  createdAt: string;
  approvedBy?: Role;
  stated: { text: string; sectors: SectorKey[]; stage: string; source: string };
  revealed: RevealedPattern[];
  changeNote: string;
}
