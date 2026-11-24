// Provider-independent AI interface. MockAIProvider is the default and the only active provider.
import type { Claim, Conflict, CriteriaVersion, CriterionId, Evaluation, LearningRule, OverlapCheck, Role, SourceType, ThesisVersion } from "@/lib/shared/types";
import type { Profile } from "../pipeline";
import { mockEvaluate } from "./mock";

export interface EvaluationInput {
  applicationId: string;
  cycleId: string;
  profile: Profile;
  claims: Claim[];
  conflicts: Conflict[];
  thesis: ThesisVersion;
  criteria: CriteriaVersion;
  learningRules: LearningRule[]; // only approved rules are applied
  overlap: OverlapCheck | null;
  now: string;
  /** P-B: evidence a permitted person logged through the review workflow. Never derived from founder documents. */
  reviewedEvidence?: ReviewedEvidence[];
}

/** One evidence record logged by a person (source, reviewer, time, criteria, linked claims). */
export interface ReviewedEvidence {
  id: string;
  sourceType: SourceType;
  title: string;
  publisher: string;
  direction: "supports" | "contradicts" | "context";
  independent: boolean;
  addedBy: Role;
  loggedAt: string;
  criteria: CriterionId[];
  claimIds: string[];
}

/**
 * P-B (strict): evidence that can support a thesis exception. It must be independent (not the applicant's own
 * documents or a directory listing), support a claim, and name at least one claim and one criterion. Repeating an
 * applicant claim in the form and the deck never qualifies: both are the applicant's own documents.
 */
export const qualifiesForThesisException = (e: ReviewedEvidence) => e.independent && e.direction === "supports" && e.claimIds.length > 0 && e.criteria.length > 0;

export interface ProviderStatus {
  id: string;
  label: string;
  state: "active" | "not_configured" | "disabled";
  simulated: boolean;
  detail: string;
}

export interface AIProvider {
  id: string;
  label: string;
  simulated: boolean;
  status(): ProviderStatus;
  evaluate(input: EvaluationInput): Promise<Evaluation>;
}

export const MockAIProvider: AIProvider = {
  id: "mock-v1",
  label: "MockAIProvider v1 (rule-based, simulated)",
  simulated: true,
  status: () => ({
    id: "mock-v1",
    label: "MockAIProvider v1",
    state: "active",
    simulated: true,
    detail: "Deterministic rule-based evaluator. Reads only the submitted documents. Performs no external research and verifies nothing.",
  }),
  evaluate: async (input) => mockEvaluate(input, "mock-v1", "MockAIProvider v1 (rule-based, simulated)"),
};

/** Adapter stub for a hosted LLM. Never sends documents unless configured server-side AND enabled by an admin. */
export const ExternalLLMProvider: AIProvider = {
  id: "external-llm",
  label: "External LLM adapter",
  simulated: false,
  status: () => ({
    id: "external-llm",
    label: "External LLM adapter",
    state: "not_configured",
    simulated: false,
    detail: "Not configured. Requires AI_PROVIDER_API_KEY on the server, an admin opt-in and a privacy review before any applicant document is sent externally.",
  }),
  evaluate: async () => {
    throw new Error("External LLM provider is not configured.");
  },
};

export const LocalAIProvider: AIProvider = {
  id: "local-ai",
  label: "Local model adapter",
  simulated: false,
  status: () => ({
    id: "local-ai",
    label: "Local model adapter",
    state: "disabled",
    simulated: false,
    detail: "Disabled. The app never downloads or runs local models (resource constraints, Part G).",
  }),
  evaluate: async () => {
    throw new Error("Local AI provider is disabled.");
  },
};

export const PROVIDERS = [MockAIProvider, ExternalLLMProvider, LocalAIProvider];
export const activeProvider = (): AIProvider => MockAIProvider;
