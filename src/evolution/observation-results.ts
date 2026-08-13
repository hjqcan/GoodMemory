import type { ExperienceModelInfluence } from "./contracts";

export interface RecallObservationVerificationHint {
  evidenceIds?: string[];
  memoryId: string;
}

export interface RecallVerificationObservationResult {
  modelInfluence: ExperienceModelInfluence;
  policyApplied: string[];
  verificationHints: RecallObservationVerificationHint[];
}

export interface FeedbackObservationResult {
  accepted: boolean;
  appliesTo?: string;
  evidenceIds?: string[];
  kind?: string;
  memoryId?: string;
  modelInfluence: ExperienceModelInfluence;
  origin?: "agent_event" | "api";
  outcome?: string;
  signal?: string;
}
