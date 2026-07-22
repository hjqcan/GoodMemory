import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { isActiveMemoryLifecycle } from "../../domain/records";
import type { FactMemory } from "../../domain/records";
import { normalizeScope } from "../../domain/scope";
import type { MemoryScope } from "../../domain/scope";
import type { EvidenceRecord } from "../../evidence/contracts";
import type {
  ProjectionCapableDocumentStore,
  StorageDocument,
} from "../../storage/contracts";
import type { LanguageService } from "../../language";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  PROJECTION_SEARCH_SCHEMA_VERSION,
} from "./contracts";
import type {
  AppendClaimProjectionInput,
  ClaimProjection,
  ClaimProjectionState,
  ClaimProjectionStatus,
} from "./contracts";
import {
  buildEntityProjectionId,
  resolveProjectionLanguageContext,
  resolveProjectionScope,
} from "./projector";
import {
  matchesScopeFilter,
  recallScopeKey,
  scopeFilter,
} from "./shared";

export interface ClaimProjectionIndex {
  append(
    input: AppendClaimProjectionInput,
    state?: ClaimProjectionState,
  ): Promise<ClaimProjection | null>;
  markFailed(input: AppendClaimProjectionInput, error: unknown): Promise<void>;
  query(scope: MemoryScope): Promise<ClaimProjection[]>;
  queryBySourceMemoryIds(
    scope: MemoryScope,
    sourceMemoryIds: readonly string[],
  ): Promise<ClaimProjection[]>;
  queryForSourceMemoryGroups(
    scope: MemoryScope,
    sourceMemoryIds: readonly string[],
  ): Promise<ClaimProjection[]>;
  queryHistory(scope: MemoryScope): Promise<ClaimProjection[]>;
  search(
    scope: MemoryScope,
    query: string,
    limit: number,
    history: boolean,
    locale?: string,
  ): Promise<ClaimProjection[]>;
  rebuildScope(input: {
    scope: MemoryScope;
    sources: readonly ClaimProjectionCanonicalSource[];
    timestamp: string;
  }): Promise<void>;
  reconcileScope(input: {
    canonicalSourceIds: ReadonlySet<string>;
    scope: MemoryScope;
  }): Promise<void>;
  synchronizeFact(input: {
    document: StorageDocument | null;
    evidence?: readonly EvidenceRecord[];
    fallbackScope?: MemoryScope;
    sourceMemoryId: string;
    timestamp: string;
  }): Promise<void>;
}

export interface ClaimProjectionCanonicalSource {
  collection: string;
  document: StorageDocument;
  evidence?: readonly EvidenceRecord[];
  id: string;
}

function stableId(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 32);
  return `${prefix}:${digest}`;
}

export function buildClaimProjectionStatusId(
  scope: MemoryScope,
  sourceMemoryId: string,
): string {
  return stableId("claim-status", `${recallScopeKey(scope)}\u0000${sourceMemoryId}`);
}

export function buildClaimProjectionSearchText(input: {
  contextualDescriptor?: string;
  modality?: string;
  objectEntity?: string;
  objectText: string;
  polarity?: string;
  predicateKey: string;
  subject: string;
}): string {
  return [
    input.subject,
    input.predicateKey,
    input.objectText,
    input.objectEntity,
    input.polarity,
    input.modality,
    input.contextualDescriptor,
  ].filter((value): value is string => Boolean(value?.trim())).join(" ");
}

function projectionId(input: Omit<ClaimProjection, "id">): string {
  return stableId("claim", JSON.stringify({
    scopeKey: input.scopeKey,
    sourceMemoryId: input.sourceMemoryId,
    subject: input.subjectText ?? input.subjectEntityId,
    predicateKey: input.predicateKey,
    objectText: input.objectText,
    objectEntity: input.objectEntityText ?? input.objectEntityId,
    polarity: input.polarity,
    modality: input.modality,
    validFrom: input.validFrom,
    validUntil: input.validUntil,
    observedAt: input.observedAt,
    ingestedAt: input.ingestedAt,
    evidenceIds: input.evidenceIds,
    sourceMessageIds: input.sourceMessageIds,
    extractorVersion: input.extractorVersion,
    confidence: input.confidence,
    contextualDescriptor: input.contextualDescriptor,
  }));
}

function isFactMemory(document: StorageDocument): document is FactMemory {
  const record = document as Partial<FactMemory>;
  return typeof record.id === "string" && typeof record.content === "string";
}

function selectedClaims(
  statuses: readonly ClaimProjectionStatus[],
  history: readonly ClaimProjection[],
): ClaimProjection[] {
  const selectedIds = new Set(statuses.flatMap((status) => status.claimIds));
  return history
    .filter((claim) => selectedIds.has(claim.id))
    .sort((left, right) =>
      left.ingestedAt.localeCompare(right.ingestedAt) || left.id.localeCompare(right.id),
    );
}

export function createClaimProjectionIndex(
  documentStore: ProjectionCapableDocumentStore,
  language: LanguageService,
): ClaimProjectionIndex {
  function analyzeSearchText(
    text: string,
    locale?: string,
  ): Pick<
    ClaimProjection,
    | "languagePackId"
    | "searchAnalyzerVersion"
    | "searchLocale"
    | "searchSchemaVersion"
    | "searchText"
  > {
    const context = language.resolveFromText({
      ...(locale ? { locale } : {}),
      text,
    });
    return {
      languagePackId: context.languagePackId,
      searchAnalyzerVersion: language.analyzerVersion(context),
      searchLocale: context.locale,
      searchText: [...new Set(language.buildSearchTerms(text, context))].join(" "),
      searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
    };
  }

  async function queryStatuses(scope: MemoryScope): Promise<ClaimProjectionStatus[]> {
    const queried = await documentStore.query<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      scopeFilter(scope),
    );
    return queried.filter((status) => matchesScopeFilter(status, scope));
  }

  async function queryHistory(scope: MemoryScope): Promise<ClaimProjection[]> {
    const queried = await documentStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      scopeFilter(scope),
    );
    return queried
      .filter((claim) => matchesScopeFilter(claim, scope))
      .sort((left, right) =>
        left.ingestedAt.localeCompare(right.ingestedAt) || left.id.localeCompare(right.id),
      );
  }

  async function queryBySourceMemoryIds(
    scope: MemoryScope,
    sourceMemoryIds: readonly string[],
  ): Promise<ClaimProjection[]> {
    const ids = [...new Set(sourceMemoryIds)];
    const statuses = (
      await Promise.all(ids.map((sourceMemoryId) =>
        documentStore.get<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          buildClaimProjectionStatusId(scope, sourceMemoryId),
        )
      ))
    ).filter((status): status is ClaimProjectionStatus =>
      status !== null && matchesScopeFilter(status, scope)
    );
    const claimIds = [...new Set(statuses.flatMap(({ claimIds }) => claimIds))];
    const history = (
      await Promise.all(claimIds.map((claimId) =>
        documentStore.get<ClaimProjection>(
          CLAIM_PROJECTIONS_COLLECTION,
          claimId,
        )
      ))
    ).filter((claim): claim is ClaimProjection =>
      claim !== null && matchesScopeFilter(claim, scope)
    );
    return selectedClaims(statuses, history);
  }

  async function queryForSourceMemoryGroups(
    scope: MemoryScope,
    sourceMemoryIds: readonly string[],
  ): Promise<ClaimProjection[]> {
    const selected = await queryBySourceMemoryIds(scope, sourceMemoryIds);
    const groups = [...new Map(selected.map((claim) => [
      `${claim.subjectEntityId}\u0000${claim.predicateKey}`,
      {
        predicateKey: claim.predicateKey,
        subjectEntityId: claim.subjectEntityId,
      },
    ])).values()];
    const history = [...new Map((await Promise.all(groups.map((group) =>
      documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {
        scopeKey: recallScopeKey(scope),
        ...group,
      })
    ))).flat()
      .filter((claim) => matchesScopeFilter(claim, scope))
      .map((claim) => [claim.id, claim])).values()];
    const peerSourceMemoryIds = [
      ...new Set(history.map(({ sourceMemoryId }) => sourceMemoryId)),
    ];
    const statuses = (
      await Promise.all(peerSourceMemoryIds.map((sourceMemoryId) =>
        documentStore.get<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          buildClaimProjectionStatusId(scope, sourceMemoryId),
        )
      ))
    ).filter((status): status is ClaimProjectionStatus =>
      status !== null && matchesScopeFilter(status, scope)
    );
    return selectedClaims(statuses, history);
  }

  async function rebuildClaimAnalysis(
    fact: FactMemory,
    scope: MemoryScope,
  ): Promise<ClaimProjectionStatus | null> {
    const statusId = buildClaimProjectionStatusId(scope, fact.id);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [status, queriedClaims] = await Promise.all([
        documentStore.get<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          statusId,
        ),
        documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {
          sourceMemoryId: fact.id,
        }),
      ]);
      const selectedClaimSnapshots = status
        ? await Promise.all(status.claimIds.map(async (id) => ({
            document: await documentStore.get<ClaimProjection>(
              CLAIM_PROJECTIONS_COLLECTION,
              id,
            ),
            id,
          })))
        : [];
      const claims = [...new Map([
        ...queriedClaims,
        ...selectedClaimSnapshots.flatMap(({ document }) =>
          document ? [document] : []
        ),
      ]
        .filter((claim) => matchesScopeFilter(claim, scope))
        .map((claim) => [claim.id, claim])).values()];
      const hasInvalidSelection = status && status.state !== "failed" &&
        (status.claimIds.length === 0 || selectedClaimSnapshots.some(
          ({ document }) =>
            !document ||
            document.sourceMemoryId !== fact.id ||
            !matchesScopeFilter(document, scope),
        ));
      if (hasInvalidSelection) {
        const committed = await documentStore.writeBatchIfUnchanged({
          delete: [{
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            id: status.id,
          }],
          expected: {
            collection: "facts",
            document: fact,
            id: fact.id,
          },
          set: [],
          unchanged: [
            {
              collection: CLAIM_PROJECTION_STATUS_COLLECTION,
              document: status,
              id: status.id,
            },
            ...selectedClaimSnapshots.map(({ document, id }) => ({
              collection: CLAIM_PROJECTIONS_COLLECTION,
              document,
              id,
            })),
          ],
        });
        if (committed) {
          return null;
        }
        continue;
      }
      const fallbackSubject = fact.subject && fact.subject !== "unknown"
        ? fact.subject
        : fact.userId;
      const replacements = claims.map((claim) => {
        const subjectText = claim.subjectText?.trim() ||
          (claim.predicateKey.startsWith("fact.") ? fallbackSubject : undefined);
        if (!subjectText) {
          throw new Error(
            `Claim projection ${claim.id} cannot rebuild its subject entity without raw text.`,
          );
        }
        const objectEntityText = claim.objectEntityText?.trim();
        if (claim.objectEntityId && !objectEntityText) {
          throw new Error(
            `Claim projection ${claim.id} cannot rebuild its object entity without raw text.`,
          );
        }
        const text = buildClaimProjectionSearchText({
          subject: subjectText,
          predicateKey: claim.predicateKey,
          objectText: claim.objectText,
          objectEntity: objectEntityText,
          polarity: claim.polarity,
          modality: claim.modality,
          contextualDescriptor: claim.contextualDescriptor,
        });
        const languageContext = language.resolveFromText({
          ...(fact.source.locale ? { locale: fact.source.locale } : {}),
          text,
        });
        const subjectEntityId = buildEntityProjectionId(
          claim.scopeKey,
          language.normalizeForEquality(subjectText, languageContext),
        );
        const objectEntityId = objectEntityText
          ? buildEntityProjectionId(
            claim.scopeKey,
            language.normalizeForEquality(objectEntityText, languageContext),
          )
          : undefined;
        const { id: _id, objectEntityId: _oldObjectEntityId, ...base } = claim;
        const projectionWithoutId: Omit<ClaimProjection, "id"> = {
          ...base,
          subjectText,
          subjectEntityId,
          text,
          ...analyzeSearchText(text, fact.source.locale),
          ...(objectEntityText
            ? { objectEntityId, objectEntityText }
            : {}),
        };
        return {
          previous: claim,
          projection: {
            id: projectionId(projectionWithoutId),
            ...projectionWithoutId,
          },
        };
      });
      const changed = replacements.filter(({ previous, projection }) =>
        !isDeepStrictEqual(previous, projection)
      );
      if (changed.length === 0) {
        return status;
      }
      const nextIds = new Map(
        replacements.map(({ previous, projection }) => [previous.id, projection.id]),
      );
      const nextStatus = status
        ? {
            ...status,
            claimIds: status.claimIds.map((claimId) =>
              nextIds.get(claimId) ?? claimId
            ),
          }
        : null;
      const replacementIds = new Set(
        replacements.map(({ projection }) => projection.id),
      );
      const committed = await documentStore.writeBatchIfUnchanged({
        delete: changed
          .filter(({ previous, projection }) =>
            previous.id !== projection.id && !replacementIds.has(previous.id)
          )
          .map(({ previous }) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            id: previous.id,
          })),
        expected: {
          collection: "facts",
          document: fact,
          id: fact.id,
        },
        set: [
          ...changed.map(({ projection }) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: projection,
            id: projection.id,
          })),
          ...(nextStatus && !isDeepStrictEqual(status, nextStatus)
            ? [{
                collection: CLAIM_PROJECTION_STATUS_COLLECTION,
                document: nextStatus,
                id: nextStatus.id,
              }]
            : []),
        ],
        unchanged: [
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: status,
            id: statusId,
          },
          ...claims.map((claim) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: claim,
            id: claim.id,
          })),
        ],
      });
      if (committed) {
        return nextStatus;
      }
    }
    throw new Error(
      `Claim analysis changed repeatedly during rebuild: ${fact.id}`,
    );
  }

  function normalizeClaimObjectText(claim: ClaimProjection): string {
    const context = language.resolveFromText({
      locale: claim.searchLocale,
      text: claim.objectText,
    });
    return language.normalizeForEquality(claim.objectText, context);
  }

  async function reconcileStructuredSupersession(
    scope: MemoryScope,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [statuses, history] = await Promise.all([
        queryStatuses(scope),
        queryHistory(scope),
      ]);
      const selected = selectedClaims(statuses, history)
        .filter((claim) =>
          !claim.predicateKey.startsWith("fact.") &&
          claim.polarity === "positive" &&
          claim.modality === "asserted"
        )
        .sort((left, right) =>
          left.observedAt.localeCompare(right.observedAt) ||
          left.id.localeCompare(right.id)
        );
      const openBySlot = new Map<string, ClaimProjection[]>();
      const closures = new Map<string, ClaimProjection>();
      for (const claim of selected) {
        const slot = `${claim.subjectEntityId}\u0000${claim.predicateKey}`;
        const open = openBySlot.get(slot) ?? [];
        const nextOpen: ClaimProjection[] = [];
        const value = normalizeClaimObjectText(claim);
        for (const older of open) {
          if (
            older.sourceMemoryId !== claim.sourceMemoryId &&
            older.observedAt.localeCompare(claim.observedAt) < 0 &&
            normalizeClaimObjectText(older) !== value
          ) {
            const { id: _id, ...projectionWithoutId } = older;
            const closedWithoutId: Omit<ClaimProjection, "id"> = {
              ...projectionWithoutId,
              validUntil: claim.observedAt,
              ingestedAt: claim.ingestedAt,
            };
            closures.set(older.id, {
              id: projectionId(closedWithoutId),
              ...closedWithoutId,
            });
          } else {
            nextOpen.push(older);
          }
        }
        if (!claim.validUntil) {
          nextOpen.push(claim);
        }
        openBySlot.set(slot, nextOpen);
      }
      if (closures.size === 0) {
        return;
      }
      const nextStatuses = statuses.map((status) => ({
        previous: status,
        status: {
          ...status,
          claimIds: status.claimIds.map((claimId) =>
            closures.get(claimId)?.id ?? claimId
          ),
        },
      }));
      const changedStatuses = nextStatuses.filter(({ previous, status }) =>
        !isDeepStrictEqual(previous, status)
      );
      const snapshots = [
        ...statuses.map((status) => ({
          collection: CLAIM_PROJECTION_STATUS_COLLECTION,
          document: status,
          id: status.id,
        })),
        ...history.map((claim) => ({
          collection: CLAIM_PROJECTIONS_COLLECTION,
          document: claim,
          id: claim.id,
        })),
      ];
      const expected = snapshots[0];
      if (!expected) {
        return;
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        delete: [...closures.keys()].map((id) => ({
          collection: CLAIM_PROJECTIONS_COLLECTION,
          id,
        })),
        expected,
        set: [
          ...[...closures.values()].map((claim) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: claim,
            id: claim.id,
          })),
          ...changedStatuses.map(({ status }) => ({
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: status,
            id: status.id,
          })),
        ],
        unchanged: snapshots.slice(1),
      });
      if (committed) {
        return;
      }
    }
    throw new Error(
      `Claim supersession changed repeatedly during rebuild: ${recallScopeKey(scope)}`,
    );
  }

  // Structural bi-temporal supersession: when a newly projected claim occupies
  // the same (subjectEntityId, predicateKey) slot as an older current claim
  // from a different source with an earlier observation and a different value,
  // close the older claim's validity window at the newer observation instead
  // of leaving two open "current" values. Invalidate, never delete: the closed
  // claim stays queryable for history/change aggregations. The generic
  // deterministic namespace ("fact.*") has unknown cardinality (several
  // blockers can be true at once), so only structured extractor predicates
  // participate; negations and non-asserted modalities never close anything.
  async function resolveSlotSupersession(
    claim: ClaimProjection,
    scope: MemoryScope,
  ): Promise<
    | {
        delete: Array<{ collection: string; id: string }>;
        set: Array<{
          collection: string;
          document: StorageDocument;
          id: string;
        }>;
        unchanged: Array<{
          collection: string;
          document: StorageDocument | null;
          id: string;
        }>;
      }
    | undefined
  > {
    if (
      claim.predicateKey.startsWith("fact.") ||
      claim.polarity !== "positive" ||
      claim.modality !== "asserted"
    ) {
      return undefined;
    }
    const slotClaims = await documentStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      {
        predicateKey: claim.predicateKey,
        scopeKey: claim.scopeKey,
        subjectEntityId: claim.subjectEntityId,
      },
    );
    const newValue = normalizeClaimObjectText(claim);
    const set: Array<{
      collection: string;
      document: StorageDocument;
      id: string;
    }> = [];
    const unchanged: Array<{
      collection: string;
      document: StorageDocument | null;
      id: string;
    }> = [];
    const removals: Array<{ collection: string; id: string }> = [];
    const closedSources = new Set<string>();
    for (const older of slotClaims) {
      if (
        older.sourceMemoryId === claim.sourceMemoryId ||
        closedSources.has(older.sourceMemoryId) ||
        older.validUntil !== undefined ||
        older.polarity !== "positive" ||
        older.observedAt.localeCompare(claim.observedAt) >= 0 ||
        normalizeClaimObjectText(older) === newValue
      ) {
        continue;
      }
      const statusId = buildClaimProjectionStatusId(
        scope,
        older.sourceMemoryId,
      );
      const olderStatus = await documentStore.get<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        statusId,
      );
      if (!olderStatus || !olderStatus.claimIds.includes(older.id)) {
        continue;
      }
      closedSources.add(older.sourceMemoryId);
      const { id: _olderId, ...olderWithoutId } = older;
      const closedWithoutId: Omit<ClaimProjection, "id"> = {
        ...olderWithoutId,
        validUntil: claim.observedAt,
        ingestedAt: claim.ingestedAt,
      };
      const closed: ClaimProjection = {
        id: projectionId(closedWithoutId),
        ...closedWithoutId,
      };
      set.push(
        {
          collection: CLAIM_PROJECTIONS_COLLECTION,
          document: closed,
          id: closed.id,
        },
        {
          collection: CLAIM_PROJECTION_STATUS_COLLECTION,
          document: {
            ...olderStatus,
            claimIds: olderStatus.claimIds.map((claimId) =>
              claimId === older.id ? closed.id : claimId
            ),
            updatedAt: claim.ingestedAt,
          },
          id: statusId,
        },
      );
      unchanged.push({
        collection: CLAIM_PROJECTION_STATUS_COLLECTION,
        document: olderStatus,
        id: statusId,
      });
      removals.push({
        collection: CLAIM_PROJECTIONS_COLLECTION,
        id: older.id,
      });
    }
    if (set.length === 0) {
      return undefined;
    }
    return { delete: removals, set, unchanged };
  }

  async function append(
    input: AppendClaimProjectionInput,
    state: ClaimProjectionState = "projected",
  ): Promise<ClaimProjection | null> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const normalized = normalizeScope(input);
      const sourceFact = await documentStore.get<FactMemory>(
        "facts",
        input.sourceMemoryId,
      );
      if (
        !sourceFact ||
        !matchesScopeFilter(sourceFact, normalized) ||
        !isActiveMemoryLifecycle(sourceFact) ||
        sourceFact.isActive === false
      ) {
        return null;
      }
      const id = buildClaimProjectionStatusId(normalized, input.sourceMemoryId);
      const existingStatus = await documentStore.get<ClaimProjectionStatus>(
        CLAIM_PROJECTION_STATUS_COLLECTION,
        id,
      );
      if (existingStatus?.sourceUpdatedAt) {
        const timeOrder = existingStatus.sourceUpdatedAt.localeCompare(
          input.ingestedAt,
        );
        const structuredPromotion =
          timeOrder === 0 &&
          existingStatus.state === "unstructured" &&
          state === "projected";
        const provenanceEnrichment =
          timeOrder === 0 &&
          existingStatus.state === "unstructured" &&
          state === "unstructured";
        if (
          timeOrder > 0 ||
          (timeOrder === 0 &&
            existingStatus.state !== "failed" &&
            !structuredPromotion &&
            !provenanceEnrichment)
        ) {
          return null;
        }
      }
      const scopeKey = recallScopeKey(normalized);
      const claimText = buildClaimProjectionSearchText({
        subject: input.subject,
        predicateKey: input.claim.predicateKey,
        objectText: input.claim.objectText,
        objectEntity: input.claim.objectEntity,
        polarity: input.claim.polarity ?? "positive",
        modality: input.claim.modality ?? "asserted",
        contextualDescriptor: input.contextualDescriptor,
      });
      const languageContext = resolveProjectionLanguageContext(
        language,
        claimText,
        sourceFact.source,
      );
      const subjectKey = language.normalizeForEquality(
        input.subject,
        languageContext,
      );
      const objectEntityKey = input.claim.objectEntity
        ? language.normalizeForEquality(
          input.claim.objectEntity,
          languageContext,
        )
        : undefined;
      const projectionWithoutId: Omit<ClaimProjection, "id"> = {
        schemaVersion: 2,
        ...normalized,
        scopeKey,
        sourceMemoryId: input.sourceMemoryId,
        subjectText: input.subject.trim(),
        subjectEntityId: buildEntityProjectionId(scopeKey, subjectKey),
        predicateKey: input.claim.predicateKey.trim(),
        objectText: input.claim.objectText.trim(),
        text: claimText,
        searchText: [...new Set(
          language.buildSearchTerms(claimText, languageContext),
        )].join(" "),
        searchLocale: languageContext.locale,
        languagePackId: languageContext.languagePackId,
        searchAnalyzerVersion: language.analyzerVersion(languageContext),
        searchSchemaVersion: PROJECTION_SEARCH_SCHEMA_VERSION,
        ...(objectEntityKey
          ? {
              objectEntityId: buildEntityProjectionId(scopeKey, objectEntityKey),
              objectEntityText: input.claim.objectEntity?.trim(),
            }
          : {}),
        polarity: input.claim.polarity ?? "positive",
        modality: input.claim.modality ?? "asserted",
        ...(input.claim.validFrom ? { validFrom: input.claim.validFrom } : {}),
        ...(input.claim.validUntil ? { validUntil: input.claim.validUntil } : {}),
        observedAt: input.observedAt,
        ingestedAt: input.ingestedAt,
        evidenceIds: [...new Set(input.evidenceIds)],
        sourceMessageIds: [...new Set(input.sourceMessageIds)],
        extractorVersion: input.extractorVersion,
        ...(input.claim.confidence !== undefined
          ? { confidence: input.claim.confidence }
          : {}),
        ...(input.contextualDescriptor
          ? { contextualDescriptor: input.contextualDescriptor }
          : {}),
      };
      const claim: ClaimProjection = {
        id: projectionId(projectionWithoutId),
        ...projectionWithoutId,
      };
      const status: ClaimProjectionStatus = {
        id,
        schemaVersion: 2,
        ...normalized,
        scopeKey,
        sourceMemoryId: input.sourceMemoryId,
        state,
        claimIds: [claim.id],
        extractorVersion: input.extractorVersion,
        sourceUpdatedAt: input.ingestedAt,
        updatedAt: input.ingestedAt,
      };
      const supersession = state === "projected"
        ? await resolveSlotSupersession(claim, normalized)
        : undefined;
      const committed = await documentStore.writeBatchIfUnchanged({
        ...(supersession ? { delete: supersession.delete } : {}),
        expected: {
          collection: "facts",
          id: sourceFact.id,
          document: sourceFact,
        },
        set: [
          {
            collection: CLAIM_PROJECTIONS_COLLECTION,
            id: claim.id,
            document: claim,
          },
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            id: status.id,
            document: status,
          },
          ...(supersession?.set ?? []),
        ],
        unchanged: [
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: existingStatus,
            id,
          },
          ...(supersession?.unchanged ?? []),
        ],
      });
      if (committed) return claim;
    }
    throw new Error(
      `Claim projection changed repeatedly during append: ${input.sourceMemoryId}`,
    );
  }

  async function removeSource(sourceMemoryId: string): Promise<void> {
    const [claims, statuses] = await Promise.all([
      documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {
        sourceMemoryId,
      }),
      documentStore.query<ClaimProjectionStatus>(CLAIM_PROJECTION_STATUS_COLLECTION, {
        sourceMemoryId,
      }),
    ]);
    for (const claim of claims) {
      await documentStore.delete(CLAIM_PROJECTIONS_COLLECTION, claim.id);
    }
    for (const status of statuses) {
      await documentStore.delete(CLAIM_PROJECTION_STATUS_COLLECTION, status.id);
    }
  }

  async function removeSourceFromScope(input: {
    expectedFact?: FactMemory;
    scope: MemoryScope;
    sourceMemoryId: string;
  }): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [queriedClaims, queriedStatuses] = await Promise.all([
        documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {
          sourceMemoryId: input.sourceMemoryId,
        }),
        documentStore.query<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          {
          sourceMemoryId: input.sourceMemoryId,
          },
        ),
      ]);
      const claims = queriedClaims.filter((claim) =>
        matchesScopeFilter(claim, input.scope)
      );
      const statuses = queriedStatuses.filter((status) =>
        matchesScopeFilter(status, input.scope)
      );
      const projections = [
        ...claims.map((claim) => ({
          collection: CLAIM_PROJECTIONS_COLLECTION,
          document: claim,
          id: claim.id,
        })),
        ...statuses.map((status) => ({
          collection: CLAIM_PROJECTION_STATUS_COLLECTION,
          document: status,
          id: status.id,
        })),
      ];
      if (projections.length === 0) {
        return;
      }
      const sourceFact = input.expectedFact ??
        await documentStore.get<FactMemory>("facts", input.sourceMemoryId);
      if (
        !input.expectedFact &&
        sourceFact &&
        isFactMemory(sourceFact) &&
        matchesScopeFilter(sourceFact, input.scope)
      ) {
        return;
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        delete: projections.map(({ collection, id }) => ({ collection, id })),
        expected: {
          collection: "facts",
          document: sourceFact,
          id: input.sourceMemoryId,
        },
        set: [],
        unchanged: projections,
      });
      if (committed) {
        return;
      }
    }
    throw new Error(
      `Claim scope changed repeatedly during cleanup: ${input.sourceMemoryId}`,
    );
  }

  async function synchronizeFact(input: {
    document: StorageDocument | null;
    evidence?: readonly EvidenceRecord[];
    fallbackScope?: MemoryScope;
    sourceMemoryId: string;
    timestamp: string;
  }): Promise<void> {
    if (!input.document) {
      await removeSource(input.sourceMemoryId);
      return;
    }
    if (!isFactMemory(input.document)) {
      return;
    }
    const fact = input.document;
    const factScope = resolveProjectionScope(fact) ?? input.fallbackScope;
    if (!factScope) {
      return;
    }
    if (
      input.fallbackScope &&
      recallScopeKey(input.fallbackScope) !== recallScopeKey(factScope)
    ) {
      await removeSourceFromScope({
        expectedFact: fact,
        scope: input.fallbackScope,
        sourceMemoryId: input.sourceMemoryId,
      });
    }
    const existingStatus = await rebuildClaimAnalysis(fact, factScope);
    const existingStatuses = existingStatus &&
      matchesScopeFilter(existingStatus, factScope)
      ? [existingStatus]
      : [];
    const evidence = input.evidence ?? [];
    const evidenceIds = evidence.map(({ id }) => id);
    const sourceMessageIds = [
      ...new Set(evidence.flatMap((record) => record.sourceMessageIds)),
    ];
    const fallbackInput = (validUntil?: string): AppendClaimProjectionInput => ({
      ...factScope,
      sourceMemoryId: fact.id,
      subject: fact.subject && fact.subject !== "unknown"
        ? fact.subject
        : fact.userId,
      claim: {
        predicateKey: fact.factKind
          ? `fact.${fact.factKind}`
          : `fact.unstructured.${fact.id}`,
        objectText: fact.content,
        polarity: "positive",
        modality: "asserted",
        validFrom: fact.validFrom,
        validUntil,
        confidence: fact.confidence,
      },
      // Prefer event time over transaction time: explicit validity start, then
      // the source-message observation time, then extraction wall clock.
      observedAt: fact.validFrom ?? fact.observedAt ?? fact.source.extractedAt ??
        fact.createdAt,
      ingestedAt: fact.updatedAt,
      evidenceIds,
      sourceMessageIds,
      extractorVersion: "deterministic-fact-v1",
    });

    if (isActiveMemoryLifecycle(fact) && fact.isActive !== false) {
      if (existingStatuses.some(({ state }) => state === "failed")) {
        return;
      }
      const existingStatus = existingStatuses.find(
        (status) => status.claimIds.length > 0,
      );
      if (existingStatus && existingStatus.state !== "unstructured") {
        return;
      }
      if (existingStatus) {
        const existingClaims = await documentStore.query<ClaimProjection>(
          CLAIM_PROJECTIONS_COLLECTION,
          { sourceMemoryId: fact.id },
        );
        const current = existingClaims.find((claim) =>
          existingStatus.claimIds.includes(claim.id),
        );
        if (
          evidenceIds.length === 0 ||
          (current &&
            evidenceIds.every((id) => current.evidenceIds.includes(id)) &&
            sourceMessageIds.every((id) => current.sourceMessageIds.includes(id)))
        ) {
          return;
        }
      }
      await append(fallbackInput(fact.validUntil), "unstructured");
      return;
    }

    if (existingStatuses.length === 0) {
      await append(fallbackInput(fact.validUntil ?? fact.updatedAt), "unstructured");
      return;
    }

    const allClaims = await documentStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      { sourceMemoryId: fact.id },
    );
    for (const status of existingStatuses) {
      const current = allClaims.filter((claim) => status.claimIds.includes(claim.id));
      if (status.state === "failed" && current.length === 0) {
        await documentStore.writeBatchIfUnchanged({
          delete: [{
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            id: status.id,
          }],
          expected: {
            collection: "facts",
            document: fact,
            id: fact.id,
          },
          set: [],
          unchanged: [{
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: status,
            id: status.id,
          }],
        });
        continue;
      }
      const closed = current.map((claim): ClaimProjection => {
        if (claim.validUntil) return claim;
        const { id: _id, ...projectionWithoutId } = claim;
        const projection = {
          ...projectionWithoutId,
          validUntil: fact.updatedAt,
          ingestedAt: fact.updatedAt,
        };
        return { id: projectionId(projection), ...projection };
      });
      const { lastError: _lastError, ...statusWithoutError } = status;
      const nextStatus: ClaimProjectionStatus = {
        ...statusWithoutError,
        state: current.every((claim) => claim.predicateKey.startsWith("fact."))
          ? "unstructured"
          : "projected",
        extractorVersion: current[0]?.extractorVersion ?? status.extractorVersion,
        claimIds: closed.map(({ id }) => id),
        sourceUpdatedAt: fact.updatedAt,
        updatedAt: input.timestamp,
      };
      await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: "facts",
          document: fact,
          id: fact.id,
        },
        set: [
          ...closed.map((claim) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: claim,
            id: claim.id,
          })),
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: nextStatus,
            id: nextStatus.id,
          },
        ],
        unchanged: [{
          collection: CLAIM_PROJECTION_STATUS_COLLECTION,
          document: status,
          id: status.id,
        }],
      });
    }
  }

  return {
    append,
    async markFailed(input, error) {
      const normalized = normalizeScope(input);
      const id = buildClaimProjectionStatusId(normalized, input.sourceMemoryId);
      const [sourceFact, existing] = await Promise.all([
        documentStore.get<FactMemory>("facts", input.sourceMemoryId),
        documentStore.get<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          id,
        ),
      ]);
      if (
        !sourceFact ||
        !matchesScopeFilter(sourceFact, normalized) ||
        !isActiveMemoryLifecycle(sourceFact) ||
        sourceFact.isActive === false
      ) {
        return;
      }
      if (
        existing?.sourceUpdatedAt &&
        (existing.sourceUpdatedAt > input.ingestedAt ||
          (existing.sourceUpdatedAt === input.ingestedAt &&
            existing.state === "projected"))
      ) {
        return;
      }
      const status: ClaimProjectionStatus = {
        id,
        schemaVersion: 2,
        ...normalized,
        scopeKey: recallScopeKey(normalized),
        sourceMemoryId: input.sourceMemoryId,
        state: "failed",
        claimIds: existing?.claimIds ?? [],
        extractorVersion: input.extractorVersion,
        sourceUpdatedAt: input.ingestedAt,
        lastError: error instanceof Error ? error.message : String(error),
        updatedAt: input.ingestedAt,
      };
      await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: "facts",
          document: sourceFact,
          id: sourceFact.id,
        },
        set: [{
          collection: CLAIM_PROJECTION_STATUS_COLLECTION,
          document: status,
          id,
        }],
        unchanged: [{
          collection: CLAIM_PROJECTION_STATUS_COLLECTION,
          document: existing,
          id,
        }],
      });
    },
    async query(scope) {
      const [statuses, history] = await Promise.all([
        queryStatuses(scope),
        queryHistory(scope),
      ]);
      return selectedClaims(statuses, history);
    },
    queryBySourceMemoryIds,
    queryForSourceMemoryGroups,
    queryHistory,
    async search(scope, query, limit, history, locale) {
      if (!documentStore.searchText) {
        return (history ? await queryHistory(scope) : await this.query(scope))
          .slice(0, limit);
      }
      const queryContext = language.resolveFromText({
        ...(locale ? { locale } : {}),
        text: query,
      });
      const searchQuery = language.buildSearchTerms(query, queryContext).join(" ");
      if (!searchQuery) {
        return [];
      }
      const results = await documentStore.searchText<ClaimProjection>(
        CLAIM_PROJECTIONS_COLLECTION,
        {
          field: "searchText",
          filter: scopeFilter(scope),
          limit,
          query: searchQuery,
        },
      );
      const ranked = new Map<string, { claim: ClaimProjection; score: number }>();
      for (const result of results) {
        if (!matchesScopeFilter(result.document, scope)) {
          continue;
        }
        const existing = ranked.get(result.id);
        if (!existing || result.score > existing.score) {
          ranked.set(result.id, {
            claim: result.document,
            score: result.score,
          });
        }
      }
      const claims = [...ranked.values()]
        .sort(
          (left, right) =>
            right.score - left.score || left.claim.id.localeCompare(right.claim.id),
        )
        .slice(0, limit)
        .map(({ claim }) => claim);
      if (history) {
        return claims;
      }
      const sourceMemoryIds = [...new Set(
        claims.map(({ sourceMemoryId }) => sourceMemoryId),
      )];
      const statuses = (
        await Promise.all(
          sourceMemoryIds.map((sourceMemoryId) =>
            documentStore.get<ClaimProjectionStatus>(
              CLAIM_PROJECTION_STATUS_COLLECTION,
              buildClaimProjectionStatusId(scope, sourceMemoryId),
            )
          ),
        )
      ).filter((status): status is ClaimProjectionStatus =>
        status !== null && matchesScopeFilter(status, scope)
      );
      return selectedClaims(statuses, claims);
    },
    async rebuildScope({ scope, sources, timestamp }) {
      const factSources = sources.filter((source) => source.collection === "facts");
      const canonicalIds = new Set(factSources.map(({ id }) => id));
      for (const source of factSources) {
        await synchronizeFact({
          document: source.document,
          evidence: source.evidence,
          sourceMemoryId: source.id,
          timestamp,
        });
      }
      await this.reconcileScope({ canonicalSourceIds: canonicalIds, scope });
    },
    async reconcileScope({ canonicalSourceIds, scope }) {
      const [statuses, history] = await Promise.all([
        queryStatuses(scope),
        queryHistory(scope),
      ]);
      const sourceMemoryIds = new Set([
        ...statuses.map(({ sourceMemoryId }) => sourceMemoryId),
        ...history.map(({ sourceMemoryId }) => sourceMemoryId),
      ]);
      for (const sourceMemoryId of sourceMemoryIds) {
        if (!canonicalSourceIds.has(sourceMemoryId)) {
          await removeSourceFromScope({
            scope,
            sourceMemoryId,
          });
        }
      }
      await reconcileStructuredSupersession(scope);
    },
    synchronizeFact,
  };
}
