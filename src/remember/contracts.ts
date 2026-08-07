import type { MemorySourceMethod } from "../domain/provenance";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type {
  MemoryEmbeddingWrite,
  PreparedMemoryEmbeddingRecord,
} from "../embedding/vectorWrites";
import type { SourceMessageRecord } from "../evidence/contracts";
import type { LanguageService, ResolvedLanguageContext } from "../language";
import type { GoodMemoryPolicyHooks, PolicyContext } from "../policy/hooks";
import type {
  ConditionalDocumentWriteBatch,
  DocumentStore,
} from "../storage/contracts";
import type {
  RememberRepositoryPort,
  RememberVectorPort,
} from "../storage/ports";
import type {
  AppendClaimProjectionInput,
  ClaimProjectionWritePort,
  MemoryCandidate,
  MemoryCandidateAnnotationTrace,
  MemoryCandidateKindHint,
  MemoryExtractionInput,
  MemoryExtractionStrategy,
  MemoryExtractor,
} from "./candidates";
import type { RememberConfig } from "./profiles";
import type { PreferenceCategoryFence } from "./writeOwnership";

export type ScopedIdentity = {
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
};

export interface ClassifiedCandidate extends MemoryCandidate {
  memoryType: Exclude<MemoryCandidateKindHint, "episode" | "noise"> | "reject";
  decision: "write" | "reject";
  score: number;
  reason?: string;
}

export interface RememberEvent {
  candidateId: string;
  outcome: "written" | "merged" | "superseded" | "rejected";
  memoryType:
    | "profile"
    | "preference"
    | "reference"
    | "fact"
    | "feedback"
    | "episode";
  memoryId?: string;
  reason?: string;
  sourceMethod?: MemorySourceMethod;
  annotation?: MemoryCandidateAnnotationTrace;
  extractionSources?: MemoryExtractionStrategy[];
  extractorIds?: string[];
  profileId?: string;
  presetId?: string;
  ruleIds?: string[];
  evidenceIds?: string[];
}

export type ExtractionOutcome =
  | "committed"
  | "no_admissible_candidate"
  | "failed";

export interface RememberResult {
  accepted: number;
  rejected: number;
  events: RememberEvent[];
  // Optional on the exported compatibility shape. The built-in engine always
  // sets it; older typed adapters may omit it and are treated as retryable.
  outcome?: ExtractionOutcome;
  // Non-fatal degradation codes (present only when non-empty), mirroring the
  // ReviseMemoryResult.warnings convention. Codes: "no_durable_facts_extracted"
  // (a batch produced zero durable memories — extraction may be misconfigured)
  // and "assisted_extraction_failed" (the LLM extractor threw and the run
  // silently fell back to rules-only).
  warnings?: string[];
  metadata?: {
    locale: string;
    localeSource: "explicit" | "detected" | "default";
    languagePackId: string;
    languagePackVersion?: string;
    analysisMode: "rules-only";
    requestedExtractionStrategy: MemoryExtractionStrategy;
    resolvedExtractionStrategy: MemoryExtractionStrategy;
  };
}

export interface RememberEngineConfig {
  assistedExtractor?: MemoryExtractor;
  claimProjection?: ClaimProjectionWritePort;
  documentStore: DocumentStore;
  embedding?: EmbeddingAdapter;
  extractor?: MemoryExtractor;
  language?: LanguageService;
  remember?: RememberConfig;
  repositories: RememberRepositoryPort & { vectorIndex?: RememberVectorPort | null };
  vectorIndex?: RememberVectorPort | null;
  shouldWrite?: (candidate: ClassifiedCandidate) => boolean;
  createId?: () => string;
  now?: () => string;
  policy?: Pick<
    GoodMemoryPolicyHooks,
    "shouldRemember" | "redact" | "resolveConflict"
  >;
}

export type RollbackAction = () => Promise<void>;

export interface PendingVectorDelete {
  id: string;
  memoryType: PreparedMemoryEmbeddingRecord["memoryType"];
  restoreRecord: PreparedMemoryEmbeddingRecord | null;
}

export interface RememberWriteState {
  accepted: number;
  rejected: number;
  events: RememberEvent[];
  pendingEmbeddingWrites: MemoryEmbeddingWrite[];
  pendingClaimProjections: AppendClaimProjectionInput[];
  pendingVectorDeletes: PendingVectorDelete[];
}

export interface PreparedRememberDocumentBatch<TResult> {
  batch: ConditionalDocumentWriteBatch;
  result: TResult;
}

export interface RememberWriteContext {
  input: MemoryExtractionInput;
  candidateLanguage: ResolvedLanguageContext;
  language: LanguageService;
  storedLanguageContexts: Map<string, ResolvedLanguageContext>;
  policyContext: PolicyContext;
  repositories: RememberRepositoryPort;
  vectorIndex: RememberVectorPort | null;
  createId: () => string;
  now: () => string;
  policy?: Pick<GoodMemoryPolicyHooks, "redact" | "resolveConflict">;
  sourceMessagesByIndex: ReadonlyMap<number, SourceMessageRecord>;
  setDocumentWithRollback: <TDocument extends object>(
    collection: string,
    id: string,
    document: TDocument,
  ) => Promise<void>;
  deleteDocumentWithRollback: (
    collection: string,
    id: string,
  ) => Promise<void>;
  writeDocumentBatchWithRollback: <TResult>(
    fence: PreferenceCategoryFence,
    prepare: () => Promise<PreparedRememberDocumentBatch<TResult>>,
  ) => Promise<TResult>;
}
