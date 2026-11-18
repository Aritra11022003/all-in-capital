import type {
  CorrectionCategory,
  CriterionId,
  DecisionStatus,
  EvidenceClass,
  EvidenceState,
  OverlapRelationship,
  PartnerDecisionType,
  PassReason,
  ProcessingStatus,
  Recommendation,
  SectorKey,
  SourceType,
} from "./types";

export const PROCESSING_LABEL: Record<ProcessingStatus, string> = {
  received: "Received",
  extracting: "Extracting",
  research_queued: "Research queued",
  research_in_progress: "Research in progress",
  evaluation_queued: "Evaluation queued",
  evaluation_in_progress: "Evaluation in progress",
  ready_for_review: "Ready for review",
  failed: "Failed",
  needs_attention: "Needs attention",
};

export const DECISION_LABEL: Record<DecisionStatus, string> = {
  not_reviewed: "Not reviewed",
  awaiting_partner_review: "Awaiting partner review",
  information_requested: "Information requested",
  on_hold: "On hold",
  call_approved: "Call approved",
  passed_by_partner: "Passed by partner",
  reopened: "Reopened",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  take_call: "Take a call",
  request_info: "Request further information",
  pass_for_consideration: "Pass — for partner consideration",
};

export const DECISION_TYPE_LABEL: Record<PartnerDecisionType, string> = {
  approve_call: "Approve call",
  request_info: "Request information",
  hold: "Hold",
  pass: "Pass",
};

export const DECISION_TO_STATUS: Record<PartnerDecisionType, DecisionStatus> = {
  approve_call: "call_approved",
  request_info: "information_requested",
  hold: "on_hold",
  pass: "passed_by_partner",
};

export const PASS_REASON_LABEL: Record<PassReason, string> = {
  thesis_mismatch: "Thesis / category mismatch",
  founder_concern: "Founder concern",
  business_model: "Business model / unit economics",
  capital_mismatch: "Capital / cheque mismatch",
  regulatory_market_risk: "Regulatory or market risk",
  insufficient_evidence: "Insufficient evidence",
  other: "Other",
};

export const CRITERION_SHORT: Record<CriterionId, string> = {
  founder_quality: "Founder quality",
  founder_market_fit: "Founder-market fit",
  market: "Market",
  traction: "Traction",
  business_model: "Business model",
  product_tech: "Product & tech",
  path_to_market: "Path to market",
  capital_fit: "Capital fit",
  thesis_fit: "Thesis fit",
};

export const EVIDENCE_STATE_LABEL: Record<EvidenceState, string> = {
  strong: "Strong",
  mixed: "Mixed",
  weak: "Weak",
  insufficient: "Insufficient evidence",
  conflicting: "Conflicting evidence",
};

export const EVIDENCE_CLASS_LABEL: Record<EvidenceClass, string> = {
  applicant_provided: "Applicant-provided",
  independent: "Independent source",
  corroborated: "Corroborated",
  conflicting: "Conflicting",
  unverified: "Unverified",
  inaccessible: "Inaccessible",
};

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = {
  applicant_document: "Applicant document",
  government_regulatory: "Government / regulatory (tier 1)",
  official_company_record: "Official company record (tier 2)",
  named_customer_partner: "Named customer / partner (tier 3)",
  company_website: "Company website / docs (tier 4)",
  independent_media: "Independent media (tier 5)",
  professional_profile: "Professional profile (tier 6)",
  directory_aggregator: "Directory / aggregator (tier 7, lead only)",
  internal_record: "Internal record",
};

export const SECTOR_LABEL: Record<SectorKey, string> = {
  fintech: "Fintech",
  deeptech: "Deeptech",
  consumer_tech: "Consumer tech",
  consumer_brand: "Consumer brand",
  healthcare: "Healthcare",
  web3: "Web3 / crypto",
  other: "Other",
  unknown: "Unknown",
};

export const RELATIONSHIP_LABEL: Record<OverlapRelationship, string> = {
  direct_competitor: "Possible direct competitor",
  adjacent_competitor: "Possible adjacent competitor",
  shared_customers: "Shared customers",
  shared_channels: "Shared channels",
  strategic_conflict: "Strategic conflict",
};

export const CORRECTION_CATEGORY_LABEL: Record<CorrectionCategory, string> = {
  evidence_misread: "Evidence misread",
  missing_context: "Missing context",
  overweighted_credentials: "Over-weighted credentials",
  missing_metric_policy: "Missing-metric policy",
  thesis_interpretation: "Thesis interpretation",
  extraction_error: "Extraction error",
  other: "Other",
};
