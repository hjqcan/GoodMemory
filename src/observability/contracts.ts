export type GoodMemoryTraceSpanName =
  | "memory.remember"
  | "memory.recall"
  | "memory.build_context"
  | "memory.revise"
  | "memory.feedback"
  | "memory.forget"
  | "memory.export"
  | "memory.import"
  | "governance.file_mirror"
  | "memory.delete_all"
  | "memory.policy.block"
  | "runtime.session.start"
  | "runtime.session.end"
  | "writeback.job.enqueue"
  | "writeback.job.commit"
  | "maintenance.run";

export type GoodMemoryTraceSpanStatus =
  | "started"
  | "succeeded"
  | "failed"
  | "blocked";

export type GoodMemoryTraceAttributeValue = string | number | boolean;

export interface GoodMemoryScopeDigest {
  userIdHash: string;
  tenantIdHash?: string;
  workspaceIdHash?: string;
  agentIdHash?: string;
  sessionIdHash?: string;
}

export interface GoodMemoryTraceLink {
  type: "memory" | "evidence" | "proposal" | "promotion" | "job";
  id: string;
}

export interface GoodMemoryTraceRedaction {
  containsRawUserText: false;
  previewChars?: number;
}

export interface GoodMemoryTraceSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: GoodMemoryTraceSpanName;
  status: GoodMemoryTraceSpanStatus;
  scopeDigest: GoodMemoryScopeDigest;
  attributes?: Record<string, GoodMemoryTraceAttributeValue>;
  links?: GoodMemoryTraceLink[];
  redaction: GoodMemoryTraceRedaction;
  occurredAt: string;
}

export interface GoodMemoryTraceSink {
  emit(span: GoodMemoryTraceSpan): void | Promise<void>;
}

export interface GoodMemoryObservabilityConfig {
  /**
   * Optional stable secret for scope digests. If omitted, GoodMemory uses a
   * private per-instance secret so low-entropy scope ids cannot be guessed
   * offline by trace receivers.
   */
  scopeDigestSecret?: string;
  modelUsageSink?: ModelUsageSink;
  traceSink?: GoodMemoryTraceSink;
}
import type { ModelUsageSink } from "../provider/model-usage";
