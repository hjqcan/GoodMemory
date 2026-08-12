// The memory-candidate / extraction contract. These types live in domain/ (a
// dependency leaf) so language packs and policy hooks can reference the
// candidate shape without importing remember/ — keeping language ↛ remember and
// policy ↛ remember acyclic. The remember pipeline re-exports them from
// remember/candidates for backward compatibility. See
// architecture.boundaries.test.ts.
import type {
  FactKind,
  FeedbackKind,
  MemoryAttributeValue,
  MemoryCategory,
  MemoryScopeKind,
  ReferenceKind,
} from "./records";
import type { MemoryScope } from "./scope";
import type { TemporalExpression } from "./temporal";

export type ProfileField =
  | "name"
  | "role"
  | "organization"
  | "location"
  | "timezone"
  | "languagePreference"
  | "currentProject";

export type MemoryCandidateKindHint =
  | "profile"
  | "preference"
  | "reference"
  | "fact"
  | "feedback"
  | "episode"
  | "noise";

export type MemoryCandidateExplicitness = "explicit" | "inferred";
export type MemoryExtractionStrategy = "rules-only" | "llm-assisted" | "auto";
export type MessageAnnotationRememberMode = "always" | "never" | "auto";

export type MemoryClaimPolarity = "positive" | "negative";
export type MemoryClaimModality =
  | "asserted"
  | "planned"
  | "attempted"
  | "completed"
  | "unknown";

export interface MemoryCandidateClaimMetadata {
  predicateKey: string;
  objectText: string;
  objectEntity?: string;
  polarity?: MemoryClaimPolarity;
  modality?: MemoryClaimModality;
  validFrom?: string;
  validUntil?: string;
  confidence?: number;
}

export interface AppendClaimProjectionInput extends MemoryScope {
  sourceMemoryId: string;
  subject: string;
  claim: MemoryCandidateClaimMetadata;
  contextualDescriptor?: string;
  observedAt: string;
  ingestedAt: string;
  evidenceIds: string[];
  sourceMessageIds: string[];
  extractorVersion: string;
}

export interface ClaimProjectionWritePort {
  appendClaim(input: AppendClaimProjectionInput): Promise<void>;
}

export interface MemoryCandidateMetadata {
  category?: MemoryCategory;
  factKind?: FactKind;
  scopeKind?: MemoryScopeKind;
  subject?: string;
  tags?: string[];
  attributes?: Record<string, MemoryAttributeValue>;
  feedbackKind?: FeedbackKind;
  optOutTarget?: string;
  appliesTo?: string;
  profileField?: ProfileField;
  preferenceCategory?: string;
  preferenceValue?: string;
  referenceKind?: ReferenceKind;
  referenceTitle?: string;
  referencePointer?: string;
  supersedesPointer?: string;
  claim?: MemoryCandidateClaimMetadata;
  contextualDescriptor?: string;
  occurrenceExpression?: TemporalExpression;
}

export interface MemoryCandidateAnnotationTrace {
  confirmed?: boolean;
  kindHint?: Exclude<MemoryCandidateKindHint, "episode" | "noise">;
  metadataPatched?: boolean;
  reason?: string;
  remember: MessageAnnotationRememberMode;
  verified?: boolean;
}

export interface MemoryCandidate {
  id: string;
  kindHint: MemoryCandidateKindHint;
  explicitness: MemoryCandidateExplicitness;
  annotation?: MemoryCandidateAnnotationTrace;
  extractionSources?: MemoryExtractionStrategy[];
  extractorIds?: string[];
  profileId?: string;
  presetId?: string;
  ruleIds?: string[];
  content: string;
  sourceMessageIndex: number;
  sourceMessageIndexes?: number[];
  sourceRole: string;
  metadata?: MemoryCandidateMetadata;
}
