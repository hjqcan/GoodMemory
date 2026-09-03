import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import type { ExportMemoryResult } from "../../src/api/contracts";
import type { C3InstalledArmRuntime } from "./c3-runtime";
import type { C4LeakageSurface } from "./c4-leakage";
import {
  C5_LIVE_LEAKAGE_SURFACE_IDS,
} from "./c5-live-leakage";
import {
  evaluateC5LongitudinalCanary,
} from "./c5-longitudinal-canary";
import {
  C5_PRIOR_EXPORT_LINEAGE_REASON,
  resolveC5PriorMemoryLineage,
} from "./c5-memory-protocol";
import type {
  C5LongitudinalCanary,
} from "./c5-longitudinal-canary";
import {
  auditAndSanitizeCodexTranscript,
  findCodexTranscriptByThreadId,
} from "./codex-transcript";
import type { CodexRunResult } from "./codex-runner";
import {
  buildNativeCanarySessionDigest,
} from "./native-canary-contracts";
import {
  parseNativeCanaryCursorState,
  parseNativeCanaryInjectionState,
  parseNativeCanaryWritebackInspection,
} from "./native-canary-state";
import { runBoundaryProcess } from "./process";
import type {
  BoundaryProcessRequest,
  BoundaryProcessResult,
} from "./process";

const DEFAULT_TIMEOUT_MS = 60_000;
const SCOPE_FIELDS = [
  "userId",
  "tenantId",
  "workspaceId",
  "agentId",
  "sessionId",
] as const;
type C5Durable = ExportMemoryResult["durable"];
type C5DurableRecord<K extends keyof C5Durable> =
  NonNullable<C5Durable[K]> extends readonly (infer Record)[]
    ? Record
    : NonNullable<C5Durable[K]>;
type C5DurableFieldSpecs = {
  [K in keyof C5Durable]: {
    metadata: readonly Extract<keyof C5DurableRecord<K>, string>[];
    semantic: readonly Extract<keyof C5DurableRecord<K>, string>[];
  };
};
const C5_DURABLE_FIELD_SPECS = {
  notes: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "confidence",
      "source",
      "supersededBy",
      "lifecycle",
      "format",
      "observedAt",
      "createdAt",
      "updatedAt",
    ],
    semantic: ["title", "body", "subject", "tags", "attributes"],
  },
  profile: {
    metadata: ["userId", "version", "updatedAt", "createdAt"],
    semantic: ["activeContext", "expertise", "identity"],
  },
  preferences: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "confidence",
      "source",
      "evidenceCount",
      "isPinned",
      "supersededBy",
      "lifecycle",
      "updatedAt",
    ],
    semantic: ["category", "value", "tags", "attributes"],
  },
  references: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "confidence",
      "source",
      "supersededBy",
      "lifecycle",
      "createdAt",
      "updatedAt",
    ],
    semantic: [
      "description",
      "pointer",
      "referenceKind",
      "subject",
      "title",
      "tags",
      "attributes",
    ],
  },
  facts: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "confidence",
      "importance",
      "source",
      "verificationPressureCount",
      "lastVerificationHintAt",
      "validFrom",
      "validUntil",
      "expiresAt",
      "demotedAt",
      "demotionReason",
      "supersededBy",
      "lifecycle",
      "isActive",
      "embeddingId",
      "createdAt",
      "updatedAt",
    ],
    semantic: [
      "category",
      "content",
      "factKind",
      "subject",
      "scopeKind",
      "tags",
      "attributes",
    ],
  },
  feedback: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "confidence",
      "source",
      "supersededBy",
      "lifecycle",
      "updatedAt",
    ],
    semantic: ["appliesTo", "evidence", "kind", "rule", "why", "tags", "attributes"],
  },
  episodes: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "importance",
      "confidence",
      "locale",
      "embeddingId",
      "createdAt",
      "archivedAt",
    ],
    semantic: [
      "entities",
      "keyDecisions",
      "summary",
      "topics",
      "unresolvedItems",
      "emotionalTone",
    ],
  },
  archives: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "sourceSessionIds",
      "scopeLineage",
      "locale",
      "createdAt",
      "archivedAt",
    ],
    semantic: [
      "keyDecisions",
      "normalizedTranscript",
      "referencedArtifacts",
      "summary",
      "unresolvedItems",
    ],
  },
  evidence: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "source",
      "sourceUri",
      "sourceMessageIds",
      "sourceRecordIds",
      "linkedMemoryIds",
      "linkedArchiveIds",
      "createdAt",
    ],
    semantic: ["excerpt", "kind", "attributes"],
  },
  sourceMessages: {
    metadata: [
      "id",
      "schemaVersion",
      ...SCOPE_FIELDS,
      "sourceMessageId",
      "role",
      "observedAt",
      "ingestedAt",
      "contentSha256",
    ],
    semantic: ["content"],
  },
  experiences: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "kind",
      "traceId",
      "sourceTraceIds",
      "trigger",
      "modelInfluence",
      "outcome",
      "metrics",
      "linkedMemoryIds",
      "linkedArchiveIds",
      "linkedEvidenceIds",
      "linkedProposalIds",
      "createdAt",
    ],
    semantic: ["policyApplied", "summary", "metadata"],
  },
  proposals: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "proposalType",
      "status",
      "traceId",
      "sourceExperienceIds",
      "linkedMemoryIds",
      "linkedArchiveIds",
      "linkedEvidenceIds",
      "modelInfluence",
      "createdAt",
      "updatedAt",
    ],
    semantic: ["rationale", "summary"],
  },
  promotions: {
    metadata: [
      "id",
      ...SCOPE_FIELDS,
      "proposalId",
      "traceId",
      "decision",
      "sourceExperienceIds",
      "linkedMemoryIds",
      "linkedArchiveIds",
      "linkedEvidenceIds",
      "policyOutcome",
      "verificationOutcome",
      "evalOutcome",
      "createdAt",
      "decidedAt",
    ],
    semantic: ["rationale", "summary"],
  },
} as const satisfies C5DurableFieldSpecs;
const injectionSessionsSchema = z.object({
  sessions: z.record(z.string(), z.object({
    contentHashes: z.array(z.string()),
    injectedRecordIds: z.array(z.string()),
    updatedAt: z.string(),
  }).passthrough()),
  version: z.literal(1),
}).passthrough();

export interface C5InstalledHostCanaryResult {
  canary: C5LongitudinalCanary;
  evidenceSha256: string;
  liveSurfaces: C4LeakageSurface[];
  sanitizedTranscriptSha256: string | null;
  sessionDigest: string;
  transcriptSourceSha256: string | null;
}

const C5_CANARY_SOURCE_NAMES = [
  "codex-transcript",
  "injection-state",
  "stop-cursor",
  "writeback-inspection",
] as const;
type C5CanarySourceName = typeof C5_CANARY_SOURCE_NAMES[number];
interface C5CanaryCollectionFailure {
  errorSha256: string;
  source: C5CanarySourceName;
}

export async function collectC5InstalledHostCanary(input: {
  codex: CodexRunResult;
  effectivePrompt: string;
  evidenceDirectory: string;
  expectedPriorMemoryIds: readonly string[];
  memoryExportBeforeStage: string;
  memoryExpectation: "irrelevant-control" | "none" | "required";
  runProcess?: (
    request: BoundaryProcessRequest,
  ) => Promise<BoundaryProcessResult>;
  runtime: C3InstalledArmRuntime;
  timeoutMs?: number;
  writebackRequired: boolean;
}): Promise<C5InstalledHostCanaryResult> {
  await mkdir(input.evidenceDirectory, { recursive: true });
  const threadId = input.codex.normalized?.threadId;
  if (input.codex.status !== "completed" || threadId === null || threadId === undefined) {
    throw new Error("C5 host canary requires one completed Codex thread");
  }
  const sessionDigest = buildNativeCanarySessionDigest(threadId);
  const failures: string[] = [];
  const collectionFailures: C5CanaryCollectionFailure[] = [];
  let rawTranscript = "";
  let sanitizedTranscriptSha256: string | null = null;
  let transcriptSourceSha256: string | null = null;
  let sanitizedTranscript = "";
  try {
    const transcriptPath = await findCodexTranscriptByThreadId({
      sessionsRoot: join(input.runtime.plan.paths.codexHome, "sessions"),
      threadId,
    });
    rawTranscript = await readFile(transcriptPath, "utf8");
    transcriptSourceSha256 = sha256(rawTranscript);
    const sanitized = auditAndSanitizeCodexTranscript({
      codexVersion: input.runtime.codex.version,
      raw: rawTranscript,
      threadId,
    });
    if (sanitized.audit.sourceSha256 !== transcriptSourceSha256) {
      throw new Error("C5 transcript sanitizer source commitment drifted");
    }
    sanitizedTranscript = sanitized.sanitizedJsonl;
  } catch (error) {
    rawTranscript = "";
    const failure = collectionFailure("codex-transcript", error);
    collectionFailures.push(failure);
    failures.push(collectionFailureReason(failure.source));
    sanitizedTranscript = `${JSON.stringify({
      payload: {
        errorSha256: failure.errorSha256,
        sessionDigest,
        source: failure.source,
      },
      type: "source_failure",
    })}\n`;
  }
  sanitizedTranscriptSha256 = sha256(sanitizedTranscript);
  await writeFile(
    join(input.evidenceDirectory, "codex-rollout.sanitized.jsonl"),
    sanitizedTranscript,
    { encoding: "utf8", flag: "wx" },
  );

  let injectionEvents = parseNativeCanaryInjectionState('{"events":[],"version":1}');
  let injectionSessionContentHashes: string[] = [];
  let injectionSessionRecordIds: string[] = [];
  let injectionSourceSha256: string | null = null;
  try {
    const raw = await readFile(
      join(
        input.runtime.plan.paths.home,
        ".goodmemory",
        "codex-injection-state.json",
      ),
      "utf8",
    );
    injectionSourceSha256 = sha256(raw);
    injectionEvents = parseNativeCanaryInjectionState(raw);
    const sessionReceipt = parseInjectionSessionReceipt(
      raw,
      sessionDigest,
    );
    injectionSessionContentHashes = sessionReceipt.contentHashes;
    injectionSessionRecordIds = sessionReceipt.injectedRecordIds;
  } catch (error) {
    const failure = collectionFailure("injection-state", error);
    collectionFailures.push(failure);
    failures.push(collectionFailureReason(failure.source));
  }

  let cursorSessionDigests: string[] = [];
  let cursorSourceSha256: string | null = null;
  try {
    const raw = await readFile(
      join(
        input.runtime.plan.paths.home,
        ".goodmemory",
        "codex-transcript-cursors.json",
      ),
      "utf8",
    );
    cursorSourceSha256 = sha256(raw);
    cursorSessionDigests = parseNativeCanaryCursorState(raw);
  } catch (error) {
    const failure = collectionFailure("stop-cursor", error);
    collectionFailures.push(failure);
    failures.push(collectionFailureReason(failure.source));
  }

  const run = input.runProcess ?? runBoundaryProcess;
  let writebackEvents = parseNativeCanaryWritebackInspection(
    '{"events":[],"host":"codex"}',
  );
  let writebackSourceSha256: string | null = null;
  try {
    const inspection = await run({
      args: [
        "codex",
        "writeback",
        "inspect",
        "--workspace-root",
        input.runtime.plan.paths.workspace,
        "--limit",
        "50",
        "--json",
      ],
      cwd: input.runtime.plan.paths.workspace,
      env: input.runtime.env,
      executable: input.runtime.goodmemoryExecutable,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    });
    assertProcessSucceeded(inspection, "public writeback inspection");
    writebackSourceSha256 = sha256(inspection.stdout);
    writebackEvents = parseNativeCanaryWritebackInspection(inspection.stdout);
  } catch (error) {
    const failure = collectionFailure("writeback-inspection", error);
    collectionFailures.push(failure);
    failures.push(collectionFailureReason(failure.source));
  }

  const memoryExport = input.memoryExportBeforeStage;
  const memoryExportSha256 = sha256(memoryExport);
  const memorySemanticContents = extractC5MemorySemanticContents(memoryExport);
  const memoryRecordIds = extractC5MemoryRecordIds(memoryExport);
  const lineage = resolveC5PriorMemoryLineage({
    exportedMemoryIds: memoryRecordIds,
    injectedMemoryIds: injectionSessionRecordIds,
    priorWritebackMemoryIds: input.expectedPriorMemoryIds,
  });

  const evaluated = evaluateC5LongitudinalCanary({
    cursorSessionDigests,
    expectedPriorMemoryIds: lineage.expectedPriorMemoryIds,
    injectionEvents,
    injectionSessionContentHashes,
    memoryExpectation: input.memoryExpectation,
    rawTranscript,
    rawTranscriptPersisted: false,
    sessionDigest,
    writebackEvents,
    writebackRequired: input.writebackRequired,
  });
  const reasons = [...new Set([
    ...failures,
    ...(!lineage.containsPriorWritebackLineage
      ? [C5_PRIOR_EXPORT_LINEAGE_REASON]
      : []),
    ...evaluated.reasons,
  ])];
  const canary: C5LongitudinalCanary = {
    ...evaluated,
    memoryChannelStatus: reasons.length === 0 ? "passed" : "failed",
    passed: reasons.length === 0,
    reasons,
  };
  const hookContext = canary.hookContexts.map((context) => context.content).join("\n\n");
  const effectiveCodexInput = hookContext.length === 0
    ? input.effectivePrompt
    : `${input.effectivePrompt}\n\n${hookContext}`;
  const liveSurfaces: C4LeakageSurface[] = [
    {
      content: effectiveCodexInput,
      id: C5_LIVE_LEAKAGE_SURFACE_IDS[0],
    },
    { content: "", id: C5_LIVE_LEAKAGE_SURFACE_IDS[1] },
    {
      content: memoryExport,
      hiddenValueContents: memorySemanticContents,
      id: C5_LIVE_LEAKAGE_SURFACE_IDS[2],
    },
    {
      content: hookContext,
      hiddenValueContents: canary.hookContexts.map((context) => context.content),
      id: C5_LIVE_LEAKAGE_SURFACE_IDS[3],
    },
  ];
  const injectionReceiptEvents = injectionEvents
    .filter((event) => event.sessionDigest === sessionDigest)
    .map((event) => ({
      command: event.command,
      decision: event.decision,
      recordIds: uniqueSorted(event.recordIds),
    }))
    .sort(compareJson);
  const writebackReceiptEvents = writebackEvents
    .filter((event) => event.sessionDigest === sessionDigest)
    .map((event) => ({
      command: event.command,
      linkedRecordIds: event.linkedRecordIds
        .map(({ id, type }) => ({ id, type }))
        .sort(compareJson),
      status: event.status,
    }))
    .sort(compareJson);
  const hookContextReceipts = canary.hookContexts.map(({
    contentByteLength,
    contentHash,
    contentSha256,
  }) => ({
    contentByteLength,
    contentHash,
    contentSha256,
  }));
  const effectiveInputComposition = {
    hookContextReceiptSha256: sha256(JSON.stringify(hookContextReceipts)),
    promptSha256: sha256(input.effectivePrompt),
    semanticSurfaceCommitmentSha256: sha256(JSON.stringify([
      effectiveCodexInput,
    ])),
    separatorPolicy: "prompt-then-double-lf-hook-context-v1" as const,
    surfaceSha256: sha256(effectiveCodexInput),
  };
  const evidenceBytes = `${JSON.stringify({
    canary: {
      ...canary,
      hookContexts: hookContextReceipts,
    },
    liveSurfaceSha256: Object.fromEntries(liveSurfaces.map((surface) => [
      surface.id,
      sha256(surface.content),
    ])),
    collectionFailures,
    schemaVersion: 3,
    sessionDigest,
    sourceReceipts: {
      cursor: {
        sessionDigest,
        sessionDigests: uniqueSorted(cursorSessionDigests),
        sourceSha256: cursorSourceSha256,
      },
      effectiveInput: {
        ...effectiveInputComposition,
        compositionSha256: sha256(JSON.stringify(effectiveInputComposition)),
      },
      injection: {
        contentHashes: uniqueSorted(injectionSessionContentHashes),
        events: injectionReceiptEvents,
        hookContextSegments: canary.hookContexts.map((context) => ({
          contentByteLength: context.contentByteLength,
          contentSha256: context.contentSha256,
        })),
        hookContextSurfaceCommitmentSha256: sha256(JSON.stringify(
          canary.hookContexts.map((context) => context.content),
        )),
        injectedRecordIds: uniqueSorted(injectionSessionRecordIds),
        sessionDigest,
        sourceSha256: injectionSourceSha256,
      },
      memoryExport: {
        recordIds: memoryRecordIds,
        semanticDocumentSha256: memorySemanticContents
          .map((content) => sha256(content))
          .sort(),
        semanticSurfaceCommitmentSha256: sha256(JSON.stringify(
          memorySemanticContents,
        )),
        sourceSha256: memoryExportSha256,
        utf8Bytes: Buffer.byteLength(memoryExport, "utf8"),
      },
      writeback: {
        events: writebackReceiptEvents,
        sessionDigest,
        sourceSha256: writebackSourceSha256,
      },
    },
    sources: {
      cursorSourceSha256,
      injectionSourceSha256,
      memoryExportSha256,
      sanitizedTranscriptSha256,
      transcriptSourceSha256,
      writebackSourceSha256,
    },
  }, null, 2)}\n`;
  await writeFile(
    join(input.evidenceDirectory, "host-canary.sanitized.json"),
    evidenceBytes,
    { encoding: "utf8", flag: "wx" },
  );
  return {
    canary,
    evidenceSha256: sha256(evidenceBytes),
    liveSurfaces,
    sanitizedTranscriptSha256,
    sessionDigest,
    transcriptSourceSha256,
  };
}

function collectionFailure(
  source: C5CanarySourceName,
  error: unknown,
): C5CanaryCollectionFailure {
  return {
    errorSha256: sha256(errorMessage(error)),
    source,
  };
}

function collectionFailureReason(source: C5CanarySourceName): string {
  return `source-collection-failed:${source}`;
}

export function extractC5MemorySemanticContents(raw: string): string[] {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("C5 memory export is not valid JSON");
  }
  if (!isRecord(value) || !isRecord(value.durable)) {
    throw new Error("C5 memory export has no durable record");
  }
  // `pages` (v0.8 interchange) renders the same durable records as files; the
  // raw export surface already carries that text, so it needs no separate
  // semantic documents.
  assertKnownFields(
    value,
    ["artifacts", "durable", "exportedAt", "pages", "scope", "traceId"],
    "root",
  );
  const durable = value.durable;
  assertKnownFields(
    durable,
    Object.keys(C5_DURABLE_FIELD_SPECS),
    "durable",
  );
  const documents: string[] = [];
  if (durable.profile !== null && durable.profile !== undefined) {
    documents.push(semanticDocument(
      durable.profile,
      C5_DURABLE_FIELD_SPECS.profile,
      "profile",
    ));
  }
  const collectionNames = Object.keys(C5_DURABLE_FIELD_SPECS).filter(
    (name) => name !== "profile",
  ) as Exclude<keyof C5Durable, "profile">[];
  for (const name of collectionNames) {
    // Optional durable collections (notes since v0.8) may be absent from
    // older exports; an absent collection audits as empty.
    const records = durable[name] ?? [];
    if (!Array.isArray(records)) {
      throw new Error(`C5 memory export durable.${name} is not an array`);
    }
    for (const [index, record] of records.entries()) {
      documents.push(semanticDocument(
        record,
        C5_DURABLE_FIELD_SPECS[name],
        `${name}[${index}]`,
      ));
    }
  }
  return documents;
}

export function extractC5MemoryRecordIds(raw: string): string[] {
  extractC5MemorySemanticContents(raw);
  const value = JSON.parse(raw) as { durable: Record<string, unknown> };
  const ids: string[] = [];
  for (const name of Object.keys(C5_DURABLE_FIELD_SPECS)) {
    if (name === "profile") continue;
    const records = value.durable[name] ?? [];
    if (!Array.isArray(records)) {
      throw new Error(`C5 memory export durable.${name} is not an array`);
    }
    for (const [index, record] of records.entries()) {
      if (!isRecord(record) || typeof record.id !== "string" || record.id.length === 0) {
        throw new Error(`C5 memory export ${name}[${index}] has no record id`);
      }
      ids.push(record.id);
    }
  }
  return uniqueSorted(ids);
}

function semanticDocument(
  value: unknown,
  fields: { metadata: readonly string[]; semantic: readonly string[] },
  label: string,
): string {
  if (!isRecord(value)) {
    throw new Error(`C5 memory export ${label} is not a record`);
  }
  assertKnownFields(value, [...fields.semantic, ...fields.metadata], label);
  return JSON.stringify(Object.fromEntries(
    fields.semantic.flatMap((key) =>
      value[key] === undefined ? [] : [[key, value[key]]]
    ),
  ));
}

function assertKnownFields(
  value: Record<string, unknown>,
  knownFields: readonly string[],
  label: string,
): void {
  const known = new Set(knownFields);
  const unknown = Object.keys(value).find((field) => !known.has(field));
  if (unknown !== undefined) {
    throw new Error(`C5 memory export ${label} has unknown field ${unknown}`);
  }
}

export function parseInjectionSessionContentHashes(
  raw: string,
  sessionDigest: string,
): string[] {
  return parseInjectionSessionReceipt(raw, sessionDigest).contentHashes;
}

function parseInjectionSessionReceipt(
  raw: string,
  sessionDigest: string,
): { contentHashes: string[]; injectedRecordIds: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("C5 injection state is not valid JSON");
  }
  const parsed = injectionSessionsSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error("C5 injection state has no valid sessions map");
  }
  const session = parsed.data.sessions[sessionDigest];
  return {
    contentHashes: uniqueSorted(session?.contentHashes ?? []),
    injectedRecordIds: uniqueSorted(session?.injectedRecordIds ?? []),
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function compareJson(first: unknown, second: unknown): number {
  return JSON.stringify(first).localeCompare(JSON.stringify(second));
}

function assertProcessSucceeded(
  result: BoundaryProcessResult,
  label: string,
): void {
  if (result.spawnError !== undefined) {
    throw new Error(`${label} failed to start: ${result.spawnError}`);
  }
  if (result.timedOut) {
    throw new Error(`${label} timed out`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${label} exited with code ${String(result.exitCode)}`);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
