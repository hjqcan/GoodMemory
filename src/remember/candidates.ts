import type { SessionMessage } from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type {
  AppendClaimProjectionInput,
  ClaimProjectionWritePort,
  DurableOptOutDisposition,
  DurableOptOutTargetSelector,
  DurableTargetIdentity,
  MemoryCandidateClaimMetadata,
  MemoryCandidate,
  MemoryCandidateAnnotationTrace,
  MemoryCandidateExplicitness,
  MemoryCandidateKindHint,
  MemoryCandidateMetadata,
  MemoryClaimModality,
  MemoryClaimPolarity,
  MemoryExtractionStrategy,
  MessageAnnotationRememberMode,
  ProfileField,
} from "../domain/memoryCandidate";

export type {
  AppendClaimProjectionInput,
  ClaimProjectionWritePort,
  DurableOptOutDisposition,
  DurableOptOutTargetSelector,
  DurableTargetIdentity,
  MemoryCandidateClaimMetadata,
  MemoryCandidate,
  MemoryCandidateAnnotationTrace,
  MemoryCandidateExplicitness,
  MemoryCandidateKindHint,
  MemoryCandidateMetadata,
  MemoryClaimModality,
  MemoryClaimPolarity,
  MemoryExtractionStrategy,
  MessageAnnotationRememberMode,
  ProfileField,
};

export interface MessageAnnotation {
  messageIndex: number;
  remember?: MessageAnnotationRememberMode;
  kindHint?: Exclude<MemoryCandidateKindHint, "episode" | "noise">;
  metadataPatch?: MemoryCandidateMetadata;
  confirmed?: boolean;
  verified?: boolean;
  reason?: string;
}

export interface MemoryExtractionInput {
  scope: MemoryScope;
  messages: SessionMessage[];
  annotations?: MessageAnnotation[];
  extractionStrategy?: MemoryExtractionStrategy;
  locale?: string;
  timezone?: string;
}

export interface MemoryExtractionContext {
  knownUserName?: string;
}

export interface MemoryExtractionResult {
  candidates: MemoryCandidate[];
  ignoredMessageCount: number;
}

export interface MemoryExtractor {
  extract(
    input: MemoryExtractionInput,
    context?: MemoryExtractionContext,
  ): Promise<MemoryExtractionResult>;
}
