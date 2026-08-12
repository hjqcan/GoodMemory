import type { EvidenceLedgerFormat } from "../answer/evidenceLedgerContext";
import type {
  BuildContextResult,
  GoodMemory,
  RecallInput,
  RememberResult,
} from "../api/contracts";
import type { MemoryScope } from "../domain/scope";
import type { GoodMemoryScopeDigest } from "../observability/contracts";
import type {
  HostActionAssessmentResult,
  HostActionIntent,
  HostAdapter,
} from "../host/contracts";
import type { HostActionExecutionPlan } from "../host/actionExecution";
import type {
  GoodMemoryRecordRef,
  ProgressiveRecallService,
} from "../progressive/recall";

export type RuntimeKitContextMode = "fragment" | "progressive";

export type RuntimeKitWritebackMode = "off" | "observe" | "selective";

export type RuntimeKitWritebackAnnotation =
  | "durable_candidate"
  | "session_only"
  | "remember_never";

export type RuntimeKitWritebackPolicy = "allow" | "deny";

export type RuntimeKitLifecyclePhase =
  | "sessionStart"
  | "beforeModelCall"
  | "afterModelCall"
  | "sessionEnd"
  | "preAction"
  | "observeToolResult";

export type RuntimeKitEventStatus = "applied" | "skipped" | "succeeded";

export interface RuntimeKitEvent {
  contextMode?: RuntimeKitContextMode;
  fallbackReason?: "progressive_unavailable";
  phase: RuntimeKitLifecyclePhase;
  reason?: string;
  scopeDigest: GoodMemoryScopeDigest;
  status: RuntimeKitEventStatus;
  traceId?: string;
}

export interface RuntimeKitMessage {
  content: string;
  id?: string;
  observedAt?: string;
  role: "assistant" | "system" | "tool" | "user" | (string & {});
  timezone?: string;
}

export interface RuntimeKitMemoryContext {
  content: string;
  estimatedTokens: number;
  mode: RuntimeKitContextMode;
  omittedSections: string[];
  recordRefs?: GoodMemoryRecordRef[];
}

export interface RuntimeKitBeforeModelCallInput {
  contextMode?: RuntimeKitContextMode;
  ignoreMemory?: boolean;
  includeRuntime?: boolean;
  locale?: string;
  maxMemoryTokens?: number;
  maxProgressiveRecords?: number;
  messages?: RuntimeKitMessage[];
  query?: string;
  referenceTime?: RecallInput["referenceTime"];
  retrievalProfile?: RecallInput["retrievalProfile"];
  scope: MemoryScope;
  timezone?: RecallInput["timezone"];
}

export interface RuntimeKitBeforeModelCallResult {
  context: RuntimeKitMemoryContext;
  events: RuntimeKitEvent[];
  referenceTime: NonNullable<RecallInput["referenceTime"]>;
  recall?: Awaited<ReturnType<GoodMemory["recall"]>>;
  timezone?: RecallInput["timezone"];
}

export interface RuntimeKitWritebackInput {
  annotation?: RuntimeKitWritebackAnnotation;
  mode?: RuntimeKitWritebackMode;
  policy?: RuntimeKitWritebackPolicy;
}

export interface RuntimeKitWritebackCandidate {
  kind: "remember_candidate";
  preview: string;
  rawTranscriptPersisted: false;
  reason: "observe" | "selective_not_allowed";
}

export interface RuntimeKitBoundedJob {
  jobId: string;
  operation: "remember";
  payloadPreview: string;
  rawTranscriptPersisted: false;
  reason: "after_model_call";
  status: "candidate";
}

export interface RuntimeKitTraceSummary {
  candidateCount: number;
  rawTranscriptPersisted: false;
  rememberCalled: boolean;
}

export interface RuntimeKitAfterModelCallInput {
  assistantObservedAt?: string;
  assistantText?: string;
  assistantTimezone?: string;
  locale?: string;
  messages: RuntimeKitMessage[];
  referenceTime?: RecallInput["referenceTime"];
  scope: MemoryScope;
  timezone?: RecallInput["timezone"];
  writeback?: RuntimeKitWritebackInput;
}

export interface RuntimeKitAfterModelCallResult {
  boundedJobs: RuntimeKitBoundedJob[];
  candidates: RuntimeKitWritebackCandidate[];
  events: RuntimeKitEvent[];
  rememberResult?: RememberResult;
  trace: RuntimeKitTraceSummary;
}

export interface RuntimeKitSessionStartInput {
  scope: MemoryScope;
}

export interface RuntimeKitSessionResult {
  events: RuntimeKitEvent[];
  state: Awaited<ReturnType<GoodMemory["runtime"]["startSession"]>>["state"];
  traceId?: string;
}

export interface RuntimeKitSessionEndInput {
  archive?: Parameters<GoodMemory["runtime"]["endSession"]>[0]["archive"];
  scope: MemoryScope;
}

export interface RuntimeKitPreActionInput {
  intent: HostActionIntent;
}

export interface RuntimeKitPreActionResult {
  assessment: HostActionAssessmentResult;
  events: RuntimeKitEvent[];
  executionPlan: HostActionExecutionPlan;
}

export interface RuntimeKitObserveToolResultInput {
  scope: MemoryScope;
  summary: string;
  toolName: string;
}

export interface RuntimeKitObserveToolResultResult {
  events: RuntimeKitEvent[];
  journal: Awaited<
    ReturnType<GoodMemory["runtime"]["updateSessionJournal"]>
  >["journal"];
}

export interface CreateGoodMemoryRuntimeKitInput {
  defaultContextMode?: RuntimeKitContextMode;
  defaultMaxMemoryTokens?: number;
  evidenceLedgerFormat?: EvidenceLedgerFormat;
  hostAdapter?: Pick<HostAdapter, "assessAction">;
  memory: GoodMemory;
  onRuntimeEvent?(event: RuntimeKitEvent): Promise<void> | void;
  scopeDigestSecret?: string;
  progressive?: {
    maxDetailPreviewChars?: number;
    scopeDigestSecret: string;
  };
  progressiveRecall?: ProgressiveRecallService;
}

export interface GoodMemoryRuntimeKit {
  afterModelCall(
    input: RuntimeKitAfterModelCallInput,
  ): Promise<RuntimeKitAfterModelCallResult>;
  beforeModelCall(
    input: RuntimeKitBeforeModelCallInput,
  ): Promise<RuntimeKitBeforeModelCallResult>;
  observeToolResult(
    input: RuntimeKitObserveToolResultInput,
  ): Promise<RuntimeKitObserveToolResultResult>;
  preAction(input: RuntimeKitPreActionInput): Promise<RuntimeKitPreActionResult>;
  sessionEnd(input: RuntimeKitSessionEndInput): Promise<RuntimeKitSessionResult>;
  sessionStart(input: RuntimeKitSessionStartInput): Promise<RuntimeKitSessionResult>;
}

export type RuntimeKitFragmentContextResult = BuildContextResult;
