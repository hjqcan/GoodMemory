import type {
  ExportMemoryInput,
  GoodMemory,
} from "../api/contracts";
import type { AgentEventIngestResult } from "../api/integrationSupport";
import type {
  AgentEventHostKind,
  AgentEventIdentity,
  AgentEventKind,
  AgentEventScope,
  AgentEventStructuredValue,
  HostAgentEvent,
} from "../agentEvents";
import type { GoodMemoryPolicyHooks } from "../policy/hooks";
import type { DocumentStore } from "../storage/contracts";
import type { MemoryScope } from "../domain/scope";
import type { MarkdownArtifactFile } from "../governance/markdownArtifacts";
import type { HostActionDecision, HostKind } from "../domain/hostTypes";

export type {
  AgentEventIngestResult,
  AgentEventHostKind,
  AgentEventIdentity,
  AgentEventKind,
  AgentEventScope,
  AgentEventStructuredValue,
  HostAgentEvent,
  HostActionDecision,
  HostKind,
};

export type HostArtifactType =
  | "memory_index"
  | "user_memory"
  | "session_memory"
  | "archive_recap"
  | "playbook"
  | "topic_page";

export type HostAdapterMode = "file-assisted" | "file-authoritative";

export interface HostArtifact extends MarkdownArtifactFile {
  artifactType: HostArtifactType;
  writable: boolean;
}

export interface HostAdapterCapabilities {
  readonly mode: HostAdapterMode;
  readonly readableArtifactTypes: readonly HostArtifactType[];
  readonly writableArtifactTypes: readonly HostArtifactType[];
}

export interface HostReadArtifactsResult {
  artifacts: HostArtifact[];
  exportedAt: string;
  rootPath: string;
  scope: MemoryScope;
}

export interface HostStructuredDelta {
  op: "set";
  target: "appliesTo" | "rule" | "why";
  value?: string;
}

export type HostWriteVerificationOutcome =
  | "blocked"
  | "not_run"
  | "passed"
  | "review_required";

export interface HostRollbackGuidance {
  hint: string;
  mode: "file-assisted";
  performed: boolean;
}

export interface HostWriteDiagnostics {
  adapterId: string;
  artifactType: HostArtifactType;
  canonicalMemoryId?: string;
  failureReasons: string[];
  hostKind: HostKind;
  mode: HostAdapterMode;
  policyApplied: string[];
  provenance: {
    adapterId: string;
    hostKind: HostKind;
    origin: "host_adapter";
    wroteAt: string;
  };
  relativePath: string;
  risky: boolean;
  rollback: HostRollbackGuidance;
  structuredDelta: HostStructuredDelta[];
  verificationOutcome: HostWriteVerificationOutcome;
}

export interface HostWriteArtifactInput {
  artifactType: HostArtifactType;
  content: string;
  relativePath: string;
  scope: MemoryScope;
}

export interface HostWriteVerificationInput {
  artifactType: HostArtifactType;
  canonicalMemoryId?: string;
  currentContent: string;
  nextContent: string;
  relativePath: string;
  risky: boolean;
  scope: MemoryScope;
  structuredDelta: HostStructuredDelta[];
}

export interface HostWriteVerificationResult {
  outcome: Exclude<HostWriteVerificationOutcome, "not_run">;
  reason?: string;
}

export interface HostWriteArtifactResult {
  diagnostics: HostWriteDiagnostics;
  linkedExperienceId?: string;
  status: "applied" | "noop";
  updatedArtifact: HostArtifact;
}

export type HostActionKind = "command" | "file_edit" | "tool_call";

export interface HostCommandAction {
  command: string;
  kind: "command";
  summary?: string;
}

export interface HostToolCallAction {
  kind: "tool_call";
  payload?: AgentEventStructuredValue;
  raw?: string;
  summary?: string;
  toolName: string;
}

export interface HostFileEditAction {
  kind: "file_edit";
  operation: "create" | "delete" | "update";
  relativePath: string;
  summary?: string;
}

export type HostPlannedAction =
  | HostCommandAction
  | HostFileEditAction
  | HostToolCallAction;

export interface HostWarningAction {
  kind: "warning";
  message: string;
}

export type HostRecommendedFirstStep = HostPlannedAction | HostWarningAction;

type HostActionRunBinding =
  | {
      attemptId: string;
      runId?: string;
    }
  | {
      attemptId?: string;
      runId: string;
    };

export type HostActionIntent = HostActionRunBinding & {
  action: HostPlannedAction;
  actionId: string;
  hostKind: HostKind;
  occurredAt: string;
  scope: MemoryScope;
  sequence: number;
  turnId: string;
};

export interface HostActionAssessmentResult {
  actionId: string;
  assessmentExperienceId?: string;
  auditRecorded: boolean;
  decision: HostActionDecision;
  guidance: string[];
  matchedEvidenceIds: string[];
  matchedMemoryIds: string[];
  policyApplied: string[];
  reason: string;
  recommendedFirstStep?: HostRecommendedFirstStep;
  requiredPreconditions: string[];
}

export class HostAdapterWriteError extends Error {
  constructor(
    message: string,
    readonly diagnostics: HostWriteDiagnostics,
  ) {
    super(message);
    this.name = "HostAdapterWriteError";
  }
}

export interface HostAdapter {
  readonly capabilities: HostAdapterCapabilities;
  readonly hostKind: HostKind;
  readonly id: string;
  assessAction(input: HostActionIntent): Promise<HostActionAssessmentResult>;
  readArtifacts(input: ExportMemoryInput): Promise<HostReadArtifactsResult>;
  writeArtifact(input: HostWriteArtifactInput): Promise<HostWriteArtifactResult>;
}

export interface CreateHostAdapterInput {
  createId?: () => string;
  documentStore?: DocumentStore;
  hostKind?: HostKind;
  id: string;
  memory: Pick<GoodMemory, "exportMemory">;
  mode?: HostAdapterMode;
  now?: () => string;
  policy?: Pick<
    GoodMemoryPolicyHooks,
    "redact" | "resolveConflict" | "shouldRemember"
  >;
  readableArtifactTypes?: readonly HostArtifactType[];
  supportedReadableArtifactTypes?: readonly HostArtifactType[];
  verifyWrite?(
    input: HostWriteVerificationInput,
  ): Promise<HostWriteVerificationResult> | HostWriteVerificationResult;
  writableArtifactTypes?: readonly HostArtifactType[];
}
