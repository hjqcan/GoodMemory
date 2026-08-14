import { renderEvidenceLedgerContext } from "../answer/evidenceLedgerContext";
import { assertStorageSafeExternalValue } from "../domain/semanticText";
import {
  normalizeScope,
  scopeToKey,
} from "../domain/scope";
import type { MemoryScope } from "../domain/scope";
import { EVIDENCE_COLLECTION } from "../evidence/contracts";
import {
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../evolution/contracts";
import type { GoodMemoryTraceLink } from "../observability/contracts";
import { renderMemoryPacket } from "../recall/contextBuilder";
import { deleteVectorForCollection } from "./governance";
import {
  deleteAllMemoryOperation,
  deleteMemorySupportingState,
  exportMemoryOperation,
  recordMatchesScope,
} from "./memoryAdminOps";
import type {
  ScopeBoundRecord,
} from "./memoryAdminOps";
import { reviseMemory as reviseMemoryThroughService } from "./revision";
import type {
  BuildContextInput,
  BuildContextResult,
  DeleteAllMemoryInput,
  DeleteAllMemoryResult,
  ExportMemoryInput,
  ExportMemoryResult,
  FeedbackInput,
  FeedbackResult,
  ForgetInput,
  ForgetResult,
  GoodMemory,
  GoodMemoryConfig,
  GoodMemoryJobsFacade,
  GoodMemoryRuntimeFacade,
  RecallInput,
  RecallResult,
  RememberInput,
  RememberResult,
  ReviseMemoryInput,
  ReviseMemoryResult,
  RunMaintenanceInput,
  RunMaintenanceResult,
} from "./contracts";
import {
  createGoodMemoryAssembly,
} from "./goodMemoryAssembly";
import type { GoodMemoryAssembly } from "./goodMemoryAssembly";
import {
  attachInternalGoodMemorySupport,
} from "./internalSupport";
import type { InternalGoodMemoryOptions } from "./internalSupport";
import {
  diagnoseRecall as diagnoseRecallThroughOrchestrator,
  orchestrateRecall,
} from "./recallOrchestrator";
import {
  withFeedbackReceipts,
  writeFeedbackSignal,
} from "./feedbackOps";

export type { InternalGoodMemoryOptions } from "./internalSupport";

const FORGETTABLE_COLLECTIONS = [
  "facts",
  "feedback",
  "profiles",
  "preferences",
  "references",
  "episodes",
  SESSION_ARCHIVES_COLLECTION,
  EVIDENCE_COLLECTION,
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
] as const;
function buildRememberTraceLinks(events: RememberResult["events"]): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  for (const event of events) {
    if (event.memoryId && event.memoryType !== "profile") {
      links.push({ type: "memory", id: event.memoryId });
    }
    for (const evidenceId of event.evidenceIds ?? []) {
      links.push({ type: "evidence", id: evidenceId });
    }
  }
  return links;
}

function buildFeedbackTraceLinks(result: FeedbackResult): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  if (result.memoryId) {
    links.push({ type: "memory", id: result.memoryId });
  }
  for (const evidenceId of result.evidenceIds ?? []) {
    links.push({ type: "evidence", id: evidenceId });
  }
  for (const receipt of result.proposalReceipts ?? []) {
    links.push({ type: "proposal", id: receipt.proposalId });
  }
  for (const receipt of result.promotionReceipts ?? []) {
    links.push({ type: "promotion", id: receipt.promotionId });
  }
  return links;
}

function buildRevisionTraceLinks(result: ReviseMemoryResult): GoodMemoryTraceLink[] {
  const links: GoodMemoryTraceLink[] = [];
  if (result.previousMemoryId) {
    links.push({ type: "memory", id: result.previousMemoryId });
  }
  if (result.newMemoryId) {
    links.push({ type: "memory", id: result.newMemoryId });
  }
  for (const evidenceId of result.evidenceIds ?? []) {
    links.push({ type: "evidence", id: evidenceId });
  }

  return links;
}

function resolveRevisionTraceReason(reason: ReviseMemoryInput["reason"]): string {
  if (
    reason === "user_correction" ||
    reason === "manual_review" ||
    reason === "system_repair"
  ) {
    return reason;
  }

  return "custom";
}

function withRememberTrace(
  result: RememberResult,
  traceId: string | undefined,
): RememberResult {
  if (!traceId || !result.metadata) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...result.metadata,
      traceId,
    },
  };
}

function withFeedbackTrace(
  result: FeedbackResult,
  traceId: string | undefined,
): FeedbackResult {
  if (!traceId || !result.metadata) {
    return result;
  }

  return {
    ...result,
    metadata: {
      ...result.metadata,
      traceId,
    },
  };
}

class GoodMemoryImpl implements GoodMemory {
  readonly jobs: GoodMemoryJobsFacade;
  readonly runtime: GoodMemoryRuntimeFacade;
  readonly assembly: GoodMemoryAssembly;

  constructor(
    private readonly config: GoodMemoryConfig,
    internal?: InternalGoodMemoryOptions,
  ) {
    this.assembly = createGoodMemoryAssembly({
      callbacks: {
        remember: (input) => this.remember(input),
        rememberWithinScopeMutation: (input) =>
          this.rememberWithinScopeMutation(input),
      },
      config,
      internal,
    });
    this.jobs = this.assembly.jobs;
    this.runtime = this.assembly.runtime;
  }

  recall(input: RecallInput): Promise<RecallResult> {
    return orchestrateRecall(
      { assembly: this.assembly, config: this.config },
      input,
    );
  }

  diagnoseRecall(input: RecallInput): Promise<RecallResult> {
    return diagnoseRecallThroughOrchestrator(
      { assembly: this.assembly, config: this.config },
      input,
    );
  }

  async buildContext(input: BuildContextInput): Promise<BuildContextResult> {
    const output = input.output ?? "json";
    const trace = await this.assembly.tracer.start({
      name: "memory.build_context",
      scopeDigest: input.recall.metadata.traceScopeDigest,
      attributes: {
        maxTokens: input.maxTokens ?? 0,
        output,
        retrievalProfile: input.recall.metadata.routingDecision.retrievalProfile,
      },
    });

    try {
      const packet = input.evidenceLedgerFormat && input.recall.evidenceLedger
        ? {
            ...input.recall.packet,
            evidenceSummary: renderEvidenceLedgerContext(
              input.recall.evidenceLedger,
              input.evidenceLedgerFormat,
              input.recall.metadata.locale,
              this.assembly.language,
            ),
          }
        : input.recall.packet;
      const rendered = renderMemoryPacket(
        packet,
        output,
        input.maxTokens,
        input.recall.metadata.routingDecision.retrievalProfile,
        { suppressDuplicateEvidence: input.suppressDuplicateEvidence === true },
      );
      await trace.succeeded({
        attributes: {
          estimatedTokens: rendered.estimatedTokens,
          omittedSectionCount: rendered.omittedSections.length,
        },
      });

      return {
        output,
        content: rendered.content,
        estimatedTokens: rendered.estimatedTokens,
        omittedSections: rendered.omittedSections,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async remember(input: RememberInput): Promise<RememberResult> {
    return this.runScopeMutation(input.scope, () =>
      this.rememberWithinScopeMutation(input)
    );
  }

  private async rememberWithinScopeMutation(
    input: RememberInput,
  ): Promise<RememberResult> {
    const trace = await this.assembly.tracer.start({
      name: "memory.remember",
      scope: input.scope,
      attributes: {
        annotationCount: input.annotations?.length ?? 0,
        extractionStrategy: input.extractionStrategy ?? "auto",
        messageCount: input.messages.length,
      },
    });

    try {
      const result = await this.assembly.rememberEngine.remember(input);
      const traced = withRememberTrace(result, trace.traceId);
      if (result.outcome === "failed") {
        await trace.failed({
          error: new Error("Memory extraction remains retryable."),
          attributes: {
            accepted: result.accepted,
            eventCount: result.events.length,
            rejected: result.rejected,
          },
          links: buildRememberTraceLinks(result.events),
        });
        return traced;
      }
      await trace.succeeded({
        attributes: {
          accepted: result.accepted,
          eventCount: result.events.length,
          rejected: result.rejected,
        },
        links: buildRememberTraceLinks(result.events),
      });

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async reviseMemory(input: ReviseMemoryInput): Promise<ReviseMemoryResult> {
    return this.runScopeMutation(input.scope, () =>
      this.reviseMemoryWithinScopeMutation(input)
    );
  }

  private async reviseMemoryWithinScopeMutation(
    input: ReviseMemoryInput,
  ): Promise<ReviseMemoryResult> {
    const trace = await this.assembly.tracer.start({
      name: "memory.revise",
      scope: input.scope,
      attributes: {
        hasEvidence: Boolean(input.evidence),
        reason: resolveRevisionTraceReason(input.reason),
        target: "memory_id",
      },
    });

    try {
      const result = await reviseMemoryThroughService({
        config: {
          documentStore: this.assembly.documentStore,
          embedding: this.assembly.embeddingAdapter,
          language: this.assembly.language,
          now: this.assembly.now,
          policy: this.config.policy,
          vectorIndex: this.assembly.revisionVectorIndex,
        },
        input,
      });
      const traced: ReviseMemoryResult = {
        ...result,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
      const completion = {
        attributes: {
          accepted: result.accepted,
          memoryType: result.memoryType ?? "unknown",
          outcome: result.outcome,
          policyAppliedCount: result.policyApplied.length,
          warningCount: result.warnings?.length ?? 0,
        },
        links: buildRevisionTraceLinks(result),
      };

      if (result.outcome === "blocked") {
        await trace.blocked(completion);
      } else {
        await trace.succeeded(completion);
      }

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async forget(input: ForgetInput): Promise<ForgetResult> {
    assertStorageSafeExternalValue(input, "input");
    return this.runScopeMutation(input.scope, () =>
      this.forgetWithinScopeMutation(input)
    );
  }

  private async forgetWithinScopeMutation(
    input: ForgetInput,
  ): Promise<ForgetResult> {
    const trace = await this.assembly.tracer.start({
      name: "memory.forget",
      scope: input.scope,
      attributes: {
        hasMemoryId: Boolean(input.memoryId),
      },
    });

    try {
      if (!input.memoryId) {
        await trace.succeeded({
          attributes: {
            forgotten: false,
          },
        });
        return {
          forgotten: false,
          ...(trace.traceId ? { traceId: trace.traceId } : {}),
        };
      }

      for (const collection of FORGETTABLE_COLLECTIONS) {
        const existing = await this.assembly.documentStore.get(collection, input.memoryId);

        if (existing && recordMatchesScope(existing as ScopeBoundRecord, input.scope)) {
          await deleteVectorForCollection(
            this.assembly.governanceVectors,
            collection,
            input.memoryId,
          );
          await deleteMemorySupportingState(
            { documentStore: this.assembly.documentStore },
            {
              collection,
              memoryId: input.memoryId,
              scope: input.scope,
            },
          );
          await this.assembly.documentStore.delete(collection, input.memoryId);
          await trace.succeeded({
            attributes: {
              collection,
              forgotten: true,
            },
            links: [{ type: "memory", id: input.memoryId }],
          });
          return {
            forgotten: true,
            ...(trace.traceId ? { traceId: trace.traceId } : {}),
          };
        }
      }

      await trace.succeeded({
        attributes: {
          forgotten: false,
        },
      });
      return {
        forgotten: false,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async exportMemory(input: ExportMemoryInput): Promise<ExportMemoryResult> {
    assertStorageSafeExternalValue(input, "input");
    return exportMemoryOperation(
      {
        tracer: this.assembly.tracer,
        governanceRepositories: this.assembly.governanceRepositories,
        governanceVectors: this.assembly.governanceVectors,
        language: this.assembly.language,
        sessionStore: this.assembly.sessionStore,
        documentStore: this.assembly.documentStore,
      },
      input,
    );
  }

  async deleteAllMemory(input: DeleteAllMemoryInput): Promise<DeleteAllMemoryResult> {
    assertStorageSafeExternalValue(input, "input");
    if (!this.assembly.scopeDeletion) {
      throw new Error(
        "deleteAllMemory requires a projection-capable document store with atomic conditional batches.",
      );
    }
    if (!this.assembly.terminalDeletionReady) {
      throw new Error(
        "deleteAllMemory requires custom storage adapters to provide documentStore, sessionStore, and vectorStore on shared coordinated backends and declare shared-coordinated-backends-v1 terminal deletion semantics.",
      );
    }
    const operation = () => deleteAllMemoryOperation(
      {
        tracer: this.assembly.tracer,
        governanceRepositories: this.assembly.governanceRepositories,
        governanceVectors: this.assembly.governanceVectors,
        sessionStore: this.assembly.sessionStore,
        documentStore: this.assembly.documentStore,
      },
      input,
    );
    return this.assembly.scopeDeletion.runExclusive(
      input.scope,
      operation,
      {
        operationKey: JSON.stringify({
          contract: "delete-all-memory-v1",
          includeRuntime: input.includeRuntime !== false,
          scope: scopeToKey(normalizeScope(input.scope)),
        }),
        ...(input.resumeInterrupted
          ? { resumeInterrupted: input.resumeInterrupted }
          : {}),
      },
    );
  }

  async feedback(input: FeedbackInput): Promise<FeedbackResult> {
    return this.runScopeMutation(input.scope, () =>
      this.feedbackWithinScopeMutation(input)
    );
  }

  private async feedbackWithinScopeMutation(
    input: FeedbackInput,
  ): Promise<FeedbackResult> {
    const { signal: _signal, ...feedbackContext } = input;
    assertStorageSafeExternalValue(feedbackContext, "input");
    const trace = await this.assembly.tracer.start({
      name: "memory.feedback",
      scope: input.scope,
      attributes: {
        signalLength: input.signal.length,
      },
    });

    try {
      const { receipts, result } = await writeFeedbackSignal({
        evolutionRuntime: this.assembly.evolutionRuntime,
        feedbackRepository: this.assembly.governanceRepositories.feedback,
        language: this.assembly.language,
        locale: input.locale,
        scope: input.scope,
        signal: input.signal,
      });
      const withReceipts = withFeedbackReceipts(result, receipts);
      const traced = withFeedbackTrace(withReceipts, trace.traceId);
      await trace.succeeded({
        attributes: {
          accepted: withReceipts.accepted,
          kind: withReceipts.kind ?? "unknown",
          outcome: withReceipts.outcome ?? "none",
          proposalReceiptCount: withReceipts.proposalReceipts?.length ?? 0,
        },
        links: buildFeedbackTraceLinks(withReceipts),
      });

      return traced;
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  async runMaintenance(input: RunMaintenanceInput): Promise<RunMaintenanceResult> {
    assertStorageSafeExternalValue(input, "input");
    return this.runScopeMutation(input.scope, () =>
      this.runMaintenanceWithinScopeMutation(input)
    );
  }

  private async runMaintenanceWithinScopeMutation(
    input: RunMaintenanceInput,
  ): Promise<RunMaintenanceResult> {
    const trace = await this.assembly.tracer.start({
      name: "maintenance.run",
      scope: input.scope,
      attributes: {
        jobCount: input.jobs?.length ?? 0,
      },
    });

    try {
      const result = await this.assembly.evolutionRuntime.runMaintenance(input);
      await trace.succeeded({
        attributes: {
          compiledCount: result.compiledCount,
          proposalCount: result.proposalCount,
          ran: result.ran,
          reason: result.reason,
        },
      });

      return {
        ...result,
        ...(trace.traceId ? { traceId: trace.traceId } : {}),
      };
    } catch (error) {
      await trace.failed({ error });
      throw error;
    }
  }

  private runScopeMutation<T>(
    scope: MemoryScope,
    operation: () => Promise<T>,
  ): Promise<T> {
    assertStorageSafeExternalValue(scope, "scope");
    return this.assembly.scopeDeletion
      ? this.assembly.scopeDeletion.runMutation(scope, operation)
      : operation();
  }
}


export function createGoodMemory(config: GoodMemoryConfig): GoodMemory {
  return createInternalGoodMemory(config);
}

export function createInternalGoodMemory(
  config: GoodMemoryConfig,
  internal?: InternalGoodMemoryOptions,
): GoodMemory {
  const impl = new GoodMemoryImpl(config, internal);
  return attachInternalGoodMemorySupport({
    assembly: impl.assembly,
    config,
    impl,
    internal,
  });
}
