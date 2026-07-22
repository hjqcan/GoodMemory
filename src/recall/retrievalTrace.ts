import type {
  IterativeRecallStep,
  IterativeRecallStopReason,
} from "./iterativeRecall";
import type { RecallPlan } from "./recallPlan";

export type RecallRetrievalChannel =
  | "dense"
  | "entity"
  | "lexical"
  | "relation"
  | "temporal";
export type RecallRetrievalSourceCollection =
  | "episodes"
  | "facts"
  | "feedback"
  | "preferences"
  | "profiles"
  | "references"
  | "session_archives";

export interface RecallRetrievalChannelTrace {
  evidenceDocumentIds: string[];
  rank: number;
  rawScore: number;
  rrfScore: number;
}

export interface RecallFusionCandidateTrace {
  channels: Partial<Record<RecallRetrievalChannel, RecallRetrievalChannelTrace>>;
  eliminationReason?: "not_selected";
  evidenceTypes: RecallRetrievalChannel[];
  evidenceStrength: number;
  fusionScore: number;
  selected: boolean;
  sourceCollection: RecallRetrievalSourceCollection;
  sourceMemoryId: string;
}

export interface RecallFusionRunTrace {
  budget: number;
  candidateCount: number;
  candidates: RecallFusionCandidateTrace[];
  fallbackReason?:
    | "projection_error"
    | "projection_incomplete"
    | "projection_unavailable";
  projectionCoverage?: "complete" | "partial";
  hop?: number;
  query?: string;
  queryRole?: "primary" | "subquery";
  subQueryIndex?: number;
  status: "applied" | "fallback";
}

export interface RecallRerankerScoreTrace {
  evidenceType: "reranker";
  memoryId: string;
  rankAfter: number;
  rankBefore: number;
  score: number;
  sourceCollection?: RecallRetrievalSourceCollection;
}

export interface RecallRerankerTrace {
  adapter: "custom" | "provider";
  candidateLimit?: number;
  candidateCount: number;
  fallbackReason?:
    | "adapter_error"
    | "disabled"
    | "insufficient_candidates"
    | "provider_error";
  gateway?: string;
  latencyMs: number;
  model?: string;
  provider?: string;
  role: "reranker";
  scores: RecallRerankerScoreTrace[];
  status: "applied" | "fallback" | "skipped";
  strategy?: "listwise" | "pointwise";
}

interface RecallRetrievalTraceBase {
  fusionRuns?: RecallFusionRunTrace[];
  reranker?: RecallRerankerTrace;
}

export interface RecallRetrievalTraceV1 extends RecallRetrievalTraceBase {
  schemaVersion: 1;
}

export interface RecallQueryExecutionTrace {
  hops: IterativeRecallStep[];
  plan?: RecallPlan;
  query: string;
  role: "primary" | "subquery";
  stopReason: IterativeRecallStopReason | "single_pass_complete";
  subQueryIndex?: number;
}

export type RecallExecutionStopReason =
  | "decomposition_complete"
  | "multi_hop_complete"
  | "single_pass_complete";

export interface RecallRetrievalTraceV2 extends RecallRetrievalTraceBase {
  plan: RecallPlan;
  queryExecutions: RecallQueryExecutionTrace[];
  schemaVersion: 2;
  stopReason: RecallExecutionStopReason;
  subQueries: string[];
}

export type RecallRetrievalTrace =
  | RecallRetrievalTraceV1
  | RecallRetrievalTraceV2;
