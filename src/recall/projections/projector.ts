import { createHash } from "node:crypto";

import { isActiveMemoryLifecycle } from "../../domain/records";
import type { MemorySource } from "../../domain/provenance";
import {
  normalizeScope,
  scopeToKey,
} from "../../domain/scope";
import type { MemoryScope } from "../../domain/scope";
import type { StorageDocument } from "../../storage/contracts";
import type {
  LanguageService,
  ResolvedLanguageContext,
} from "../../language";
import type {
  RecallDocumentGranularity,
  RecallEntityMention,
  RecallIndexDocument,
  RecallProjectionSourceCollection,
} from "./contracts";
import { PROJECTION_SEARCH_SCHEMA_VERSION } from "./contracts";
import { recallScopeKey } from "./shared";

const MAX_MEMORY_TEXT_LENGTH = 32_000;
const MAX_FIELD_DOCUMENTS = 24;
const MAX_SENTENCE_DOCUMENTS = 64;
const MAX_SOURCE_ENTITIES = 128;
const MIN_SENTENCE_LENGTH = 8;
const STRUCTURED_ENTITY_FIELDS = new Set(["entities", "subject", "tags"]);

interface ProjectionTextField {
  name: string;
  text: string;
}

interface ScopeBoundStorageRecord extends Record<string, unknown> {
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function earliestOptionalTimestamp(
  record: Record<string, unknown>,
  keys: string[],
): string | undefined {
  return keys
    .map((key) => optionalString(record, key))
    .filter((value): value is string => Boolean(value))
    .sort()[0];
}

function resolveScope(document: StorageDocument): MemoryScope | null {
  if (!isRecord(document)) {
    return null;
  }
  const userId = optionalString(document, "userId");
  if (!userId) {
    return null;
  }

  return normalizeScope({
    userId,
    tenantId: optionalString(document, "tenantId"),
    workspaceId: optionalString(document, "workspaceId"),
    agentId: optionalString(document, "agentId"),
    sessionId: optionalString(document, "sessionId"),
  });
}

function stringifyTextValue(value: unknown): string[] {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? [normalized] : [];
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap(stringifyTextValue);
  }
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nested]) =>
      stringifyTextValue(nested).map((text) => `${key}: ${text}`),
    );
  }
  return [];
}

function pushField(
  fields: ProjectionTextField[],
  name: string,
  value: unknown,
): void {
  const texts = stringifyTextValue(value);
  for (const text of texts) {
    fields.push({ name, text });
  }
}

function collectTextFields(
  collection: RecallProjectionSourceCollection,
  record: Record<string, unknown>,
): ProjectionTextField[] {
  const fields: ProjectionTextField[] = [];
  if (collection === "profiles") {
    pushField(fields, "identity", record.identity);
    pushField(fields, "expertise", record.expertise);
    pushField(fields, "activeContext", record.activeContext);
  } else if (collection === "preferences") {
    pushField(fields, "category", record.category);
    pushField(fields, "value", record.value);
    pushField(fields, "tags", record.tags);
    pushField(fields, "attributes", record.attributes);
  } else if (collection === "references") {
    pushField(fields, "title", record.title);
    pushField(fields, "description", record.description);
    pushField(fields, "pointer", record.pointer);
    pushField(fields, "subject", record.subject);
    pushField(fields, "tags", record.tags);
    pushField(fields, "attributes", record.attributes);
  } else if (collection === "facts") {
    pushField(fields, "content", record.content);
    pushField(fields, "subject", record.subject);
    pushField(fields, "tags", record.tags);
    pushField(fields, "attributes", record.attributes);
  } else if (collection === "episodes") {
    pushField(fields, "summary", record.summary);
    pushField(fields, "keyDecisions", record.keyDecisions);
    pushField(fields, "unresolvedItems", record.unresolvedItems);
    pushField(fields, "topics", record.topics);
    pushField(fields, "entities", record.entities);
  } else if (collection === "feedback") {
    pushField(fields, "rule", record.rule);
    pushField(fields, "appliesTo", record.appliesTo);
    pushField(fields, "why", record.why);
    pushField(fields, "evidence", record.evidence);
    pushField(fields, "tags", record.tags);
    pushField(fields, "attributes", record.attributes);
  } else {
    pushField(fields, "summary", record.summary);
    pushField(fields, "normalizedTranscript", record.normalizedTranscript);
    pushField(fields, "keyDecisions", record.keyDecisions);
    pushField(fields, "unresolvedItems", record.unresolvedItems);
    pushField(fields, "referencedArtifacts", record.referencedArtifacts);
    pushField(fields, "scopeLineage", record.scopeLineage);
  }

  const seen = new Set<string>();
  return fields.filter((field) => {
    const key = `${field.name}\u0000${field.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isProjectionActive(
  collection: RecallProjectionSourceCollection,
  record: Record<string, unknown>,
): boolean {
  if (collection === "facts" && record.isActive === false) {
    return false;
  }
  if (collection === "episodes" && typeof record.archivedAt === "string") {
    return false;
  }
  if (collection === "profiles" || collection === "session_archives") {
    return true;
  }
  return isActiveMemoryLifecycle(record);
}

export function buildEntityProjectionId(
  scopeKey: string,
  canonicalKey: string,
): string {
  return stableId("entity", `${scopeKey}\u0000${canonicalKey}`);
}

export function buildEntityAdjacencyProjectionId(
  entityId: string,
  memoryId: string,
): string {
  return stableId("entity_edge", `${entityId}\u0000${memoryId}`);
}

function buildEntityMentions(input: {
  context: ResolvedLanguageContext;
  field?: string;
  language: LanguageService;
  scopeKey: string;
  text: string;
}): RecallEntityMention[] {
  const mentions = input.language.extractEntityMentions(
    input.text,
    input.context,
  );
  if (
    input.field &&
    STRUCTURED_ENTITY_FIELDS.has(input.field) &&
    input.text.trim().toLowerCase() !== "unknown"
  ) {
    mentions.unshift({
      kind: "term",
      normalized: input.text,
      surface: input.text,
    });
  }
  const seen = new Set<string>();
  return mentions.flatMap((mention) => {
    const canonicalKey = input.language.normalizeForEquality(
      mention.normalized,
      input.context,
    );
    if (!canonicalKey || seen.has(canonicalKey)) {
      return [];
    }
    seen.add(canonicalKey);
    return [{
      canonicalKey,
      entityId: buildEntityProjectionId(input.scopeKey, canonicalKey),
      surface: mention.surface,
    }];
  });
}

function resolveMemoryType(
  collection: RecallProjectionSourceCollection,
): string {
  if (collection === "session_archives") {
    return "archive";
  }
  return collection.endsWith("s") ? collection.slice(0, -1) : collection;
}

function resolveProvenance(record: Record<string, unknown>): RecallIndexDocument["provenance"] {
  const source = isRecord(record.source)
    ? (record.source as Partial<MemorySource>)
    : undefined;
  return {
    ...(source?.method ? { method: source.method } : {}),
    ...(source?.extractedAt ? { extractedAt: source.extractedAt } : {}),
    ...(source?.sessionId ? { sessionId: source.sessionId } : {}),
    ...(source?.locale ? { locale: source.locale } : {}),
    ...(source?.localeSource ? { localeSource: source.localeSource } : {}),
    ...(source?.languagePackId
      ? { languagePackId: source.languagePackId }
      : {}),
    ...(source?.languagePackVersion
      ? { languagePackVersion: source.languagePackVersion }
      : {}),
  };
}

export function resolveProjectionLanguageContext(
  language: LanguageService,
  text: string,
  source?: Partial<MemorySource>,
): ResolvedLanguageContext {
  if (!source?.locale) {
    return language.resolveFromText({ text });
  }
  if (source.localeSource) {
    return language.resolveFromText({ locale: source.locale, text });
  }
  const recorded = language.resolveFromText({ locale: source.locale, text });
  const detected = language.resolveFromText({ text });
  return detected.localeSource === "detected" &&
      detected.languagePackId !== recorded.languagePackId
    ? detected
    : recorded;
}

function buildIndexDocument(input: {
  collection: RecallProjectionSourceCollection;
  field?: string;
  granularity: RecallDocumentGranularity;
  indexedAt: string;
  ordinal: number;
  record: Record<string, unknown>;
  language: LanguageService;
  sourceMemoryId: string;
  scope: MemoryScope;
  text: string;
}): RecallIndexDocument {
  const text = input.text.slice(0, MAX_MEMORY_TEXT_LENGTH);
  const scopeKey = scopeToKey(input.scope);
  const source = isRecord(input.record.source)
    ? input.record.source
    : undefined;
  const languageContext = resolveProjectionLanguageContext(
    input.language,
    text,
    source as Partial<MemorySource> | undefined,
  );
  const entityMentions = buildEntityMentions({
    context: languageContext,
    field: input.field,
    language: input.language,
    scopeKey: recallScopeKey(input.scope),
    text,
  });
  const searchText = [...new Set(
    input.language.buildSearchTerms(text, languageContext),
  )].join(" ").slice(0, MAX_MEMORY_TEXT_LENGTH);
  const effectiveUntil = earliestOptionalTimestamp(input.record, [
    "validUntil",
    "expiresAt",
  ]);
  const identity = [
    input.collection,
    input.sourceMemoryId,
    input.granularity,
    input.field ?? "",
    String(input.ordinal),
    text,
  ].join("\u0000");
  return {
    id: stableId("recall", identity),
    schemaVersion: 3,
    ...input.scope,
    scopeKey,
    sourceCollection: input.collection,
    sourceMemoryId: input.sourceMemoryId,
    sourceMemoryType: resolveMemoryType(input.collection),
    granularity: input.granularity,
    ...(input.field ? { field: input.field } : {}),
    text,
    searchText,
    searchLocale: languageContext.locale,
    languagePackId: languageContext.languagePackId,
    searchAnalyzerVersion: input.language.analyzerVersion(languageContext),
    searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
    entityIds: entityMentions.map((mention) => mention.entityId),
    entityMentions,
    ...(optionalString(input.record, "validFrom")
      ? { effectiveFrom: optionalString(input.record, "validFrom") }
      : {}),
    ...(effectiveUntil ? { effectiveUntil } : {}),
    provenance: resolveProvenance(input.record),
    ...(optionalString(input.record, "createdAt")
      ? { sourceCreatedAt: optionalString(input.record, "createdAt") }
      : {}),
    ...(optionalString(input.record, "updatedAt")
      ? { sourceUpdatedAt: optionalString(input.record, "updatedAt") }
      : {}),
    indexedAt: input.indexedAt,
  };
}

export function resolveProjectionScope(
  document: StorageDocument,
): MemoryScope | null {
  return resolveScope(document);
}

export function buildRecallIndexDocuments(input: {
  collection: RecallProjectionSourceCollection;
  document: StorageDocument;
  indexedAt: string;
  language: LanguageService;
  sourceMemoryId: string;
}): RecallIndexDocument[] {
  if (!isRecord(input.document) || !isProjectionActive(input.collection, input.document)) {
    return [];
  }
  const record = input.document;
  const scope = resolveScope(record);
  if (!scope) {
    return [];
  }
  const fields = collectTextFields(input.collection, record).slice(
    0,
    MAX_FIELD_DOCUMENTS,
  );
  if (fields.length === 0) {
    return [];
  }
  const memoryText = fields
    .map((field) => `${field.name}: ${field.text}`)
    .join("\n")
    .slice(0, MAX_MEMORY_TEXT_LENGTH);
  const documents: RecallIndexDocument[] = [
    buildIndexDocument({
      collection: input.collection,
      granularity: "memory",
      indexedAt: input.indexedAt,
      ordinal: 0,
      record,
      language: input.language,
      sourceMemoryId: input.sourceMemoryId,
      scope,
      text: memoryText,
    }),
  ];

  fields.forEach((field, ordinal) => {
    documents.push(
      buildIndexDocument({
        collection: input.collection,
        field: field.name,
        granularity: "field",
        indexedAt: input.indexedAt,
        ordinal,
        record,
        language: input.language,
        sourceMemoryId: input.sourceMemoryId,
        scope,
        text: field.text,
      }),
    );
  });

  const sentences = fields
    .flatMap((field) => {
      const source = isRecord(record.source) ? record.source : undefined;
      const locale = source ? optionalString(source, "locale") : undefined;
      const context = input.language.resolveFromText({
        ...(locale ? { locale } : {}),
        text: field.text,
      });
      return input.language.splitSentences(field.text, context);
    })
    .filter((sentence) => sentence.length >= MIN_SENTENCE_LENGTH)
    .filter((sentence, index, all) => all.indexOf(sentence) === index)
    .slice(0, MAX_SENTENCE_DOCUMENTS);
  sentences.forEach((sentence, ordinal) => {
    documents.push(
      buildIndexDocument({
        collection: input.collection,
        granularity: "sentence",
        indexedAt: input.indexedAt,
        ordinal,
        record,
        language: input.language,
        sourceMemoryId: input.sourceMemoryId,
        scope,
        text: sentence,
      }),
    );
  });

  const sourceEntityIds = new Set(
    documents.flatMap((document) => document.entityIds).slice(
      0,
      MAX_SOURCE_ENTITIES,
    ),
  );
  return documents.map((document) => ({
    ...document,
    entityIds: [...new Set(document.entityIds)].filter((entityId) =>
      sourceEntityIds.has(entityId),
    ),
    entityMentions: document.entityMentions.filter((mention) =>
      sourceEntityIds.has(mention.entityId),
    ),
  }));
}
