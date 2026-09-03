import { z } from "zod";

import type {
  ExperienceRecord,
  LearningProposal,
  PromotionRecord,
  SessionArchive,
} from "../domain/evolutionRecords";
import type { MemorySource } from "../domain/provenance";
import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  NoteMemory,
  PreferenceMemory,
  ReferenceMemory,
  UserProfile,
} from "../domain/records";
import type { TemporalInterval } from "../domain/temporal";
import type { EvidenceRecord, SourceMessageRecord } from "../evidence/contracts";

// Runtime shape of the durable half of an export envelope. The envelope
// crosses external boundaries (HTTP bridge, files on disk), so every record
// is checked against its real contract before an import writes anything.
// Each schema is declared as `z.ZodType<RecordType>`: adding a required field
// to a record type without adding it here fails to compile. Validation does
// not transform: unknown extra fields (a newer release's additions) pass
// through untouched, and the caller writes the original record.

const timestamp = z
  .string()
  .refine((value) => Number.isFinite(Date.parse(value)), "must be a parseable timestamp");
const optionalTimestamp = timestamp.optional();
const optionalString = z.string().optional();
const stringList = z.array(z.string());
const optionalStringList = stringList.optional();
const attributeValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const attributes = z.record(z.string(), attributeValue).optional();
const lifecycle = z.enum(["active", "superseded", "inactive"]);
const supersededBy = z.string().nullable().optional();
const gateOutcome = z.enum(["passed", "blocked", "review_required", "not_run"]);
const modelInfluence = z.enum(["none", "rules-only", "llm-assisted", "mixed"]);

const scoped = {
  id: z.string().min(1),
  userId: z.string().min(1),
  tenantId: optionalString,
  workspaceId: optionalString,
  agentId: optionalString,
  sessionId: optionalString,
};

const memorySource: z.ZodType<MemorySource> = z.object({
  method: z.enum(["explicit", "inferred", "import", "confirmed"]),
  extractedAt: timestamp,
  sessionId: optionalString,
  locale: optionalString,
  localeSource: z.enum(["explicit", "detected", "default"]).optional(),
  languagePackId: optionalString,
  languagePackVersion: optionalString,
});

const temporalInterval: z.ZodType<TemporalInterval> = z.object({
  start: z.string(),
  endExclusive: z.string(),
  precision: z.enum(["instant", "day", "week", "month", "quarter", "year"]),
  timezone: z.string(),
});

export const userProfileSchema: z.ZodType<UserProfile> = z.object({
  userId: z.string().min(1),
  identity: z.object({
    name: optionalString,
    role: optionalString,
    organization: optionalString,
    location: optionalString,
    timezone: optionalString,
    languagePreference: optionalString,
  }),
  expertise: z.object({
    primarySkills: stringList,
    domains: stringList,
    level: z.enum(["beginner", "intermediate", "senior", "expert"]).optional(),
  }),
  activeContext: z.object({
    goals: stringList,
    currentProjects: stringList,
  }),
  version: z.number(),
  updatedAt: timestamp,
  createdAt: timestamp,
});

export const preferenceSchema: z.ZodType<PreferenceMemory> = z.object({
  ...scoped,
  category: z.string(),
  value: z.unknown(),
  tags: optionalStringList,
  attributes,
  confidence: z.number(),
  source: memorySource,
  evidenceCount: z.number(),
  isPinned: z.boolean().optional(),
  supersededBy,
  lifecycle: lifecycle.optional(),
  updatedAt: timestamp,
});

export const factSchema: z.ZodType<FactMemory> = z.object({
  ...scoped,
  category: z.string(),
  content: z.string(),
  tags: optionalStringList,
  attributes,
  confidence: z.number(),
  importance: z.number(),
  source: memorySource,
  factKind: z
    .enum(["blocker", "open_loop", "role_update", "focus_update", "project_state", "generic_project"])
    .optional(),
  scopeKind: z.enum(["identity", "project", "runtime", "reference", "preference"]).optional(),
  subject: optionalString,
  verificationPressureCount: z.number().optional(),
  lastVerificationHintAt: optionalTimestamp,
  observedAt: optionalTimestamp,
  occurrence: temporalInterval.optional(),
  validFrom: optionalTimestamp,
  validUntil: optionalTimestamp,
  expiresAt: optionalTimestamp,
  demotedAt: optionalTimestamp,
  demotionReason: optionalString,
  supersededBy,
  lifecycle,
  isActive: z.boolean(),
  embeddingId: optionalString,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const referenceSchema: z.ZodType<ReferenceMemory> = z.object({
  ...scoped,
  title: z.string(),
  pointer: z.string(),
  description: optionalString,
  confidence: z.number(),
  source: memorySource,
  referenceKind: z.enum(["source_of_truth", "runbook", "doc", "dashboard", "tracker"]).optional(),
  subject: optionalString,
  tags: optionalStringList,
  attributes,
  supersededBy,
  lifecycle: lifecycle.optional(),
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const noteSchema: z.ZodType<NoteMemory> = z.object({
  ...scoped,
  title: z.string(),
  body: z.string(),
  format: z.enum(["markdown", "plain"]),
  subject: optionalString,
  tags: optionalStringList,
  attributes,
  confidence: z.number(),
  source: memorySource,
  supersededBy,
  lifecycle,
  observedAt: optionalTimestamp,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const episodeSchema: z.ZodType<EpisodeMemory> = z.object({
  ...scoped,
  summary: z.string(),
  keyDecisions: stringList,
  unresolvedItems: stringList,
  topics: stringList,
  entities: optionalStringList,
  emotionalTone: optionalString,
  importance: z.number(),
  confidence: z.number(),
  locale: optionalString,
  embeddingId: optionalString,
  observedAt: optionalTimestamp,
  sourceMessageIds: optionalStringList,
  createdAt: timestamp,
  archivedAt: optionalTimestamp,
});

export const feedbackSchema: z.ZodType<FeedbackMemory> = z.object({
  ...scoped,
  rule: z.string(),
  kind: z.enum(["do", "dont", "prefer", "validated_pattern"]),
  appliesTo: optionalString,
  why: optionalString,
  evidence: optionalStringList,
  tags: optionalStringList,
  attributes,
  confidence: z.number(),
  source: memorySource,
  supersededBy,
  lifecycle,
  updatedAt: timestamp,
});

export const sessionArchiveSchema: z.ZodType<SessionArchive> = z.object({
  ...scoped,
  sessionId: z.string().min(1),
  sourceSessionIds: stringList,
  summary: z.string(),
  normalizedTranscript: optionalString,
  keyDecisions: stringList,
  unresolvedItems: stringList,
  referencedArtifacts: stringList,
  scopeLineage: stringList,
  locale: optionalString,
  createdAt: timestamp,
  archivedAt: timestamp,
});

export const evidenceSchema: z.ZodType<EvidenceRecord> = z.object({
  ...scoped,
  kind: z.enum([
    "conversation_excerpt",
    "tool_result_excerpt",
    "document_excerpt",
    "verification_result",
    "correction_context",
  ]),
  excerpt: z.string(),
  source: memorySource,
  sourceUri: optionalString,
  sourceMessageIds: stringList,
  sourceRecordIds: optionalStringList,
  attributes,
  linkedMemoryIds: stringList,
  linkedArchiveIds: stringList,
  createdAt: timestamp,
});

export const sourceMessageSchema: z.ZodType<SourceMessageRecord> = z.object({
  ...scoped,
  schemaVersion: z.literal(1),
  sourceMessageId: optionalString,
  role: z.string(),
  content: z.string(),
  observedAt: optionalTimestamp,
  timezone: optionalString,
  ingestedAt: timestamp,
  contentSha256: z.string(),
});

export const experienceSchema: z.ZodType<ExperienceRecord> = z.object({
  ...scoped,
  kind: z.enum(["remember", "recall", "feedback", "verify", "maintenance", "tool_outcome", "session_end"]),
  traceId: z.string(),
  sourceTraceIds: stringList,
  trigger: z.enum(["api", "background", "maintenance", "governance"]),
  modelInfluence,
  summary: z.string(),
  outcome: z.enum(["success", "failure", "mixed", "skipped"]),
  policyApplied: stringList,
  metrics: z.object({
    accepted: z.number().optional(),
    rejected: z.number().optional(),
    hitCount: z.number().optional(),
    verificationHintCount: z.number().optional(),
    latencyMs: z.number().optional(),
    tokenCount: z.number().optional(),
    verificationPressureFactCount: z.number().optional(),
  }),
  linkedMemoryIds: stringList,
  linkedArchiveIds: stringList,
  linkedEvidenceIds: stringList,
  linkedProposalIds: stringList,
  metadata: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])).optional(),
  createdAt: timestamp,
});

export const learningProposalSchema: z.ZodType<LearningProposal> = z.object({
  ...scoped,
  proposalType: z.enum([
    "memory_write",
    "memory_revision",
    "procedural_pattern",
    "maintenance_action",
    "recall_weight_adjustment",
    "verification_rule",
  ]),
  status: z.enum(["pending", "accepted", "rejected", "delayed"]),
  traceId: z.string(),
  summary: z.string(),
  rationale: z.string(),
  sourceExperienceIds: stringList,
  linkedMemoryIds: stringList,
  linkedArchiveIds: stringList,
  linkedEvidenceIds: stringList,
  modelInfluence,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const promotionSchema: z.ZodType<PromotionRecord> = z.object({
  ...scoped,
  proposalId: z.string(),
  traceId: z.string(),
  decision: z.enum(["accepted", "rejected", "delayed"]),
  summary: z.string(),
  rationale: z.string(),
  sourceExperienceIds: stringList,
  linkedMemoryIds: stringList,
  linkedArchiveIds: stringList,
  linkedEvidenceIds: stringList,
  policyOutcome: gateOutcome,
  verificationOutcome: gateOutcome,
  evalOutcome: gateOutcome,
  createdAt: timestamp,
  decidedAt: timestamp,
});

// Collection name in the envelope -> record schema. Required collections are
// always present in an export; `notes` and `sourceMessages` may be absent.
export const DURABLE_COLLECTION_SCHEMAS = {
  preferences: preferenceSchema,
  references: referenceSchema,
  notes: noteSchema,
  facts: factSchema,
  feedback: feedbackSchema,
  episodes: episodeSchema,
  archives: sessionArchiveSchema,
  evidence: evidenceSchema,
  sourceMessages: sourceMessageSchema,
  experiences: experienceSchema,
  proposals: learningProposalSchema,
  promotions: promotionSchema,
} as const;

export type DurableCollectionName = keyof typeof DURABLE_COLLECTION_SCHEMAS;

export const DURABLE_OPTIONAL_COLLECTIONS: ReadonlyArray<DurableCollectionName> = [
  "notes",
  "sourceMessages",
];

function firstIssue(prefix: string, result: z.ZodSafeParseResult<unknown>): string | null {
  if (result.success) {
    return null;
  }
  const issue = result.error.issues[0];
  if (!issue) {
    return `${prefix}: invalid`;
  }
  const path = issue.path.map(String).join(".");
  return `${prefix}${path ? `.${path}` : ""}: ${issue.message}`;
}

// Returns a one-line description of the first problem, or null when every
// record in the envelope matches its contract.
export function describeInvalidDurable(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "durable must be an object";
  }
  const durable = value as Record<string, unknown>;
  if (!("profile" in durable)) {
    return "profile must be null or a record";
  }
  if (durable.profile !== null) {
    const problem = firstIssue("profile", userProfileSchema.safeParse(durable.profile));
    if (problem) {
      return problem;
    }
  }
  for (const name of Object.keys(DURABLE_COLLECTION_SCHEMAS) as DurableCollectionName[]) {
    const records = durable[name];
    if (records === undefined) {
      if (DURABLE_OPTIONAL_COLLECTIONS.includes(name)) {
        continue;
      }
      return `${name} must be an array`;
    }
    if (!Array.isArray(records)) {
      return `${name} must be an array`;
    }
    const schema = DURABLE_COLLECTION_SCHEMAS[name];
    for (const [index, record] of records.entries()) {
      const problem = firstIssue(`${name}[${index}]`, schema.safeParse(record));
      if (problem) {
        return problem;
      }
    }
  }
  return null;
}
