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

export interface DurableTargetIdentity {
  slot: string;
  value: string;
}

export interface DurableOptOutTargetSelector {
  /** @deprecated Use identities for compound durable targets. */
  identity?: DurableTargetIdentity;
  identities?: readonly DurableTargetIdentity[];
  match: "exact";
  text: string;
}

export interface DurableOptOutDisposition {
  kind: "durable_opt_out";
  target: DurableOptOutTargetSelector;
}

export function createDurableOptOutDisposition(
  text: string,
  identities: DurableTargetIdentity | readonly DurableTargetIdentity[] = [],
): DurableOptOutDisposition {
  const normalizedIdentities = Array.isArray(identities)
    ? identities
    : [identities];
  return {
    kind: "durable_opt_out",
    target: {
      identities: normalizedIdentities,
      match: "exact",
      text,
    },
  };
}

export function createDurableTargetIdentity(
  slot: string,
  value: string,
): DurableTargetIdentity {
  return { slot, value };
}

function normalizeDurableTargetSlot(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/gu, " ")
    .trim();
}

export function normalizeDurableTargetValue(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export function durableTargetIdentityKey(
  identity: DurableTargetIdentity,
): string {
  const slot = normalizeDurableTargetSlot(identity.slot);
  const value = normalizeDurableTargetValue(identity.value);
  return [
    slot,
    slot.startsWith("assignment:") ? value : value.toLowerCase(),
  ].join("\u0000");
}

export function durableOptOutTargetIdentities(
  selector: DurableOptOutTargetSelector,
): DurableTargetIdentity[] {
  return [...new Map(
    [
      ...(selector.identities ?? []),
      ...(selector.identity ? [selector.identity] : []),
    ].map((identity) => [durableTargetIdentityKey(identity), identity]),
  ).values()];
}

export function sameDurableTargetIdentity(
  left: DurableTargetIdentity,
  right: DurableTargetIdentity,
): boolean {
  return durableTargetIdentityKey(left) === durableTargetIdentityKey(right);
}

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
  /** Re-derived by the owning LanguagePack before admission. */
  durableTarget?: DurableTargetIdentity;
  /** Only LanguagePack-derived dispositions are authoritative. */
  disposition?: DurableOptOutDisposition;
  sourceMessageIndex: number;
  sourceMessageIndexes?: number[];
  sourceRole: string;
  metadata?: MemoryCandidateMetadata;
}
