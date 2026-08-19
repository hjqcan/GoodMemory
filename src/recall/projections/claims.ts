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
  // R4.1's batch form: close stale open values in legacy or damaged
  // (subjectEntityId, predicateKey) slots. Returns the number of claims closed.
  sweepSlotSupersession(scope: MemoryScope): Promise<number>;
}

export interface ClaimProjectionCanonicalSource {
  collection: string;
  document: StorageDocument;
  evidence?: readonly EvidenceRecord[];
  id: string;
}

const MAX_CLAIM_SEARCH_CANDIDATES = 512;

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
    schemaVersion: input.schemaVersion,
    scopeKey: input.scopeKey,
    sourceMemoryId: input.sourceMemoryId,
    subject: input.subjectText ?? input.subjectEntityId,
    subjectEntityId: input.subjectEntityId,
    predicateKey: input.predicateKey,
    objectText: input.objectText,
    text: input.text,
    searchText: input.searchText,
    searchLocale: input.searchLocale,
    languagePackId: input.languagePackId,
    searchAnalyzerVersion: input.searchAnalyzerVersion,
    searchSchemaVersion: input.searchSchemaVersion,
    objectEntity: input.objectEntityText ?? input.objectEntityId,
    objectEntityId: input.objectEntityId,
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

function matchesCanonicalClaimScope(
  claim: ClaimProjection,
  scope: MemoryScope,
): boolean {
  return matchesScopeFilter(claim, scope) &&
    claim.scopeKey === recallScopeKey(scope);
}

function matchesCanonicalStatusScope(
  status: ClaimProjectionStatus,
  scope: MemoryScope,
): boolean {
  return matchesScopeFilter(status, scope) &&
    status.scopeKey === recallScopeKey(scope) &&
    status.id === buildClaimProjectionStatusId(scope, status.sourceMemoryId);
}

function selectedClaims(
  statuses: readonly ClaimProjectionStatus[],
  history: readonly ClaimProjection[],
): ClaimProjection[] {
  const statusBySourceMemoryId = new Map(
    statuses.map((status) => [status.sourceMemoryId, status]),
  );
  return history
    .filter((claim) => {
      const status = statusBySourceMemoryId.get(claim.sourceMemoryId);
      return status?.claimIds.includes(claim.id) === true &&
        !status.retiredRevisionIds?.includes(claim.id);
    })
    .sort((left, right) =>
      left.ingestedAt.localeCompare(right.ingestedAt) || left.id.localeCompare(right.id),
    );
}

function logicalClaims(
  statuses: readonly ClaimProjectionStatus[],
  history: readonly ClaimProjection[],
): ClaimProjection[] {
  const statusBySourceMemoryId = new Map(
    statuses.map((status) => [status.sourceMemoryId, status]),
  );
  return history.filter((claim) => {
    const status = statusBySourceMemoryId.get(claim.sourceMemoryId);
    return !status?.retiredRevisionIds?.includes(claim.id);
  });
}

function retiredRevisionIds(
  status: ClaimProjectionStatus | null | undefined,
  additions: readonly string[] = [],
): string[] {
  return [...new Set([
    ...(status?.retiredRevisionIds ?? []),
    ...additions,
  ])];
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
    return queried
      .filter((status) => matchesCanonicalStatusScope(status, scope))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  async function queryPhysicalHistory(
    scope: MemoryScope,
  ): Promise<ClaimProjection[]> {
    const queried = await documentStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      scopeFilter(scope),
    );
    return queried
      .filter((claim) => matchesCanonicalClaimScope(claim, scope))
      .sort((left, right) =>
        left.ingestedAt.localeCompare(right.ingestedAt) || left.id.localeCompare(right.id),
      );
  }

  async function queryHistory(scope: MemoryScope): Promise<ClaimProjection[]> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const before = await queryStatuses(scope);
      const history = await queryPhysicalHistory(scope);
      const after = await queryStatuses(scope);
      if (isDeepStrictEqual(before, after)) {
        return logicalClaims(after, history);
      }
    }
    throw new Error(
      `Claim history changed repeatedly during query: ${recallScopeKey(scope)}`,
    );
  }

  async function loadSelectedClaims(
    scope: MemoryScope,
    statuses: readonly ClaimProjectionStatus[],
  ): Promise<ClaimProjection[]> {
    const claimIds = [...new Set(statuses.flatMap(({ claimIds }) => claimIds))];
    const history = (
      await Promise.all(claimIds.map((claimId) =>
        documentStore.get<ClaimProjection>(
          CLAIM_PROJECTIONS_COLLECTION,
          claimId,
        )
      ))
    ).filter((claim): claim is ClaimProjection =>
      claim !== null && matchesCanonicalClaimScope(claim, scope)
    );
    return selectedClaims(statuses, history);
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
      status !== null && matchesCanonicalStatusScope(status, scope)
    );
    return loadSelectedClaims(scope, statuses);
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
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const loadGroupHistory = async () =>
        [...new Map((await Promise.all(groups.map((group) =>
          documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION, {
            scopeKey: recallScopeKey(scope),
            ...group,
          })
        ))).flat()
          .filter((claim) => matchesCanonicalClaimScope(claim, scope))
          .map((claim) => [claim.id, claim])).values()]
          .sort((left, right) => left.id.localeCompare(right.id));
      const before = await loadGroupHistory();
      const peerSourceMemoryIds = [
        ...new Set(before.map(({ sourceMemoryId }) => sourceMemoryId)),
      ];
      const statuses = (
        await Promise.all(peerSourceMemoryIds.map((sourceMemoryId) =>
          documentStore.get<ClaimProjectionStatus>(
            CLAIM_PROJECTION_STATUS_COLLECTION,
            buildClaimProjectionStatusId(scope, sourceMemoryId),
          )
        ))
      ).filter((status): status is ClaimProjectionStatus =>
        status !== null && matchesCanonicalStatusScope(status, scope)
      );
      const after = await loadGroupHistory();
      if (isDeepStrictEqual(before, after)) {
        return selectedClaims(statuses, after);
      }
    }
    throw new Error(
      `Claim groups changed repeatedly during query: ${recallScopeKey(scope)}`,
    );
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
        .filter((claim) => !status?.retiredRevisionIds?.includes(claim.id))
        .map((claim) => [claim.id, claim])).values()];
      const hasInvalidSelection = status && status.state !== "failed" &&
        (
          status.claimIds.length === 0 ||
          status.claimIds.some((id) =>
            status.retiredRevisionIds?.includes(id)
          ) ||
          selectedClaimSnapshots.some(
            ({ document }) =>
              !document ||
              document.sourceMemoryId !== fact.id ||
              !matchesScopeFilter(document, scope),
          )
        );
      if (hasInvalidSelection) {
        const { lastError: _lastError, ...statusWithoutError } = status;
        const recoveredStatus: ClaimProjectionStatus = {
          ...statusWithoutError,
          schemaVersion: 2,
          state: "unstructured",
          claimIds: [],
          retiredRevisionIds: retiredRevisionIds(
            status,
            selectedClaimSnapshots.flatMap(({ document }) =>
              document &&
                document.sourceMemoryId === fact.id &&
                matchesScopeFilter(document, scope)
                ? [document.id]
                : []
            ),
          ),
          sourceUpdatedAt: fact.updatedAt,
          updatedAt: fact.updatedAt,
        };
        const committed = await documentStore.writeBatchIfUnchanged({
          expected: {
            collection: "facts",
            document: fact,
            id: fact.id,
          },
          set: [{
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: recoveredStatus,
            id: recoveredStatus.id,
          }],
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
          return recoveredStatus;
        }
        continue;
      }
      if (!status && claims.length > 0) {
        const recoveredStatus: ClaimProjectionStatus = {
          id: statusId,
          schemaVersion: 2,
          ...scope,
          scopeKey: recallScopeKey(scope),
          sourceMemoryId: fact.id,
          state: "unstructured",
          claimIds: [],
          retiredRevisionIds: claims.map(({ id }) => id),
          extractorVersion: "deterministic-fact-v1",
          sourceUpdatedAt: fact.updatedAt,
          updatedAt: fact.updatedAt,
        };
        const committed = await documentStore.writeBatchIfUnchanged({
          expected: {
            collection: "facts",
            document: fact,
            id: fact.id,
          },
          set: [{
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: recoveredStatus,
            id: recoveredStatus.id,
          }],
          unchanged: [
            {
              collection: CLAIM_PROJECTION_STATUS_COLLECTION,
              document: null,
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
          return recoveredStatus;
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
          schemaVersion: 2,
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
      const selectedIds = new Set(status?.claimIds ?? []);
      const staleFallbacks = status?.state === "projected" &&
          status.sourceUpdatedAt === fact.updatedAt
        ? claims.filter((claim) =>
            !selectedIds.has(claim.id) &&
            claim.sourceMemoryId === fact.id &&
            claim.ingestedAt === status.sourceUpdatedAt &&
            claim.predicateKey.startsWith("fact.")
          )
        : [];
      const staleFallbackIds = new Set(staleFallbacks.map(({ id }) => id));
      const revisionChanges = changed.filter(
        ({ previous }) => !staleFallbackIds.has(previous.id),
      );
      const statusNeedsRevisionMetadata = status !== null &&
        (status.schemaVersion !== 2 ||
          status.retiredRevisionIds === undefined);
      if (
        changed.length === 0 &&
        staleFallbacks.length === 0 &&
        !statusNeedsRevisionMetadata
      ) {
        return status;
      }
      const nextIds = new Map(
        replacements.map(({ previous, projection }) => [previous.id, projection.id]),
      );
      const nextStatus = status
        ? {
            ...status,
            schemaVersion: 2 as const,
            claimIds: status.claimIds.map((claimId) =>
              nextIds.get(claimId) ?? claimId
            ),
            retiredRevisionIds: retiredRevisionIds(status, [
              ...revisionChanges.flatMap(({ previous, projection }) =>
                previous.id === projection.id ? [] : [previous.id]
              ),
              ...staleFallbacks.map(({ id }) => id),
            ]),
          }
        : null;
      const committed = await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: "facts",
          document: fact,
          id: fact.id,
        },
        set: [
          ...revisionChanges.map(({ projection }) => ({
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

  function claimEventTime(claim: ClaimProjection): string {
    return claim.validFrom ?? claim.observedAt;
  }

  async function reconcileStructuredSupersession(
    scope: MemoryScope,
  ): Promise<void> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const [statuses, physicalHistory] = await Promise.all([
        queryStatuses(scope),
        queryPhysicalHistory(scope),
      ]);
      const history = logicalClaims(statuses, physicalHistory);
      const selected = selectedClaims(statuses, history)
        .filter((claim) =>
          !claim.predicateKey.startsWith("fact.") &&
          claim.polarity === "positive" &&
          claim.modality === "asserted"
        )
        .sort((left, right) =>
          claimEventTime(left).localeCompare(claimEventTime(right)) ||
          left.id.localeCompare(right.id)
        );
      const openBySlot = new Map<string, ClaimProjection[]>();
      const closures = new Map<string, ClaimProjection>();
      for (const claim of selected) {
        const slot = `${claim.subjectEntityId}\u0000${claim.predicateKey}`;
        const open = openBySlot.get(slot) ?? [];
        const nextOpen: ClaimProjection[] = [];
        const value = normalizeClaimObjectText(claim);
        const eventTime = claimEventTime(claim);
        for (const older of open) {
          if (
            older.sourceMemoryId !== claim.sourceMemoryId &&
            claimEventTime(older).localeCompare(eventTime) < 0 &&
            normalizeClaimObjectText(older) !== value
          ) {
            const { id: _id, ...projectionWithoutId } = older;
            const closedWithoutId: Omit<ClaimProjection, "id"> = {
              ...projectionWithoutId,
              validUntil: eventTime,
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
          retiredRevisionIds: retiredRevisionIds(
            status,
            status.claimIds.filter((claimId) => closures.has(claimId)),
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
        ...physicalHistory.map((claim) => ({
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
  // from a different source with an earlier event time and a different value,
  // close the older claim's validity window at the newer event time instead
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
        claim: ClaimProjection;
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
    const eventTime = claimEventTime(claim);
    const selectedPeers: Array<{
      claim: ClaimProjection;
      status: ClaimProjectionStatus;
      statusId: string;
    }> = [];
    const statusesBySource = new Map<string, ClaimProjectionStatus | null>();
    for (const peer of slotClaims) {
      if (
        peer.sourceMemoryId === claim.sourceMemoryId ||
        peer.validUntil !== undefined ||
        peer.polarity !== "positive" ||
        peer.modality !== "asserted"
      ) {
        continue;
      }
      const statusId = buildClaimProjectionStatusId(scope, peer.sourceMemoryId);
      let status = statusesBySource.get(peer.sourceMemoryId);
      if (status === undefined) {
        status = await documentStore.get<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          statusId,
        );
        statusesBySource.set(peer.sourceMemoryId, status);
      }
      if (!status?.claimIds.includes(peer.id)) {
        continue;
      }
      selectedPeers.push({ claim: peer, status, statusId });
    }

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
    let resolvedClaim = claim;
    if (claim.validUntil === undefined) {
      const nextValue = selectedPeers
        .filter(({ claim: peer }) =>
          claimEventTime(peer).localeCompare(eventTime) > 0 &&
          normalizeClaimObjectText(peer) !== newValue
        )
        .sort((left, right) =>
          claimEventTime(left.claim).localeCompare(claimEventTime(right.claim)) ||
          left.claim.ingestedAt.localeCompare(right.claim.ingestedAt) ||
          left.claim.id.localeCompare(right.claim.id)
        )[0];
      if (nextValue) {
        const { id: _claimId, ...claimWithoutId } = claim;
        const boundedWithoutId: Omit<ClaimProjection, "id"> = {
          ...claimWithoutId,
          validUntil: claimEventTime(nextValue.claim),
        };
        resolvedClaim = {
          id: projectionId(boundedWithoutId),
          ...boundedWithoutId,
        };
        unchanged.push(
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: nextValue.status,
            id: nextValue.statusId,
          },
          {
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: nextValue.claim,
            id: nextValue.claim.id,
          },
        );
      }
    }

    const closedSources = new Set<string>();
    for (const { claim: older, status: olderStatus, statusId } of selectedPeers) {
      if (
        closedSources.has(older.sourceMemoryId) ||
        claimEventTime(older).localeCompare(eventTime) >= 0 ||
        normalizeClaimObjectText(older) === newValue
      ) {
        continue;
      }
      closedSources.add(older.sourceMemoryId);
      const { id: _olderId, ...olderWithoutId } = older;
      const closedWithoutId: Omit<ClaimProjection, "id"> = {
        ...olderWithoutId,
        validUntil: eventTime,
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
            retiredRevisionIds: retiredRevisionIds(olderStatus, [older.id]),
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
      unchanged.push({
        collection: CLAIM_PROJECTIONS_COLLECTION,
        document: older,
        id: older.id,
      });
    }
    if (set.length === 0 && resolvedClaim === claim) {
      return undefined;
    }
    return { claim: resolvedClaim, set, unchanged };
  }

  // R4.1's batch form (R9.4): sweep legacy or damaged current slots holding
  // more than one open value. Normal append converges out-of-order writes
  // immediately. Each inconsistent slot resolves exactly as the write path
  // does: the newest event stays open, stale values close at its validity start. The
  // per-slot commit is optimistic-concurrency guarded on the winner claim;
  // contested slots are skipped and repaired on the next run.
  async function sweepSlotSupersession(scope: MemoryScope): Promise<number> {
    const statuses = await queryStatuses(scope);
    const selected = await loadSelectedClaims(scope, statuses);
    const slots = new Map<string, ClaimProjection[]>();
    for (const claim of selected) {
      if (
        claim.predicateKey.startsWith("fact.") ||
        claim.polarity !== "positive" ||
        claim.modality !== "asserted" ||
        claim.validUntil !== undefined
      ) {
        continue;
      }
      const key = `${claim.subjectEntityId} ${claim.predicateKey}`;
      const bucket = slots.get(key);
      if (bucket) {
        bucket.push(claim);
      } else {
        slots.set(key, [claim]);
      }
    }
    let closed = 0;
    for (const slotClaims of slots.values()) {
      if (slotClaims.length < 2) {
        continue;
      }
      const values = new Set(
        slotClaims.map((claim) => normalizeClaimObjectText(claim)),
      );
      if (values.size < 2) {
        continue;
      }
      const winner = [...slotClaims].sort(
        (left, right) =>
          claimEventTime(right).localeCompare(claimEventTime(left)) ||
          right.ingestedAt.localeCompare(left.ingestedAt) ||
          right.id.localeCompare(left.id),
      )[0]!;
      const supersession = await resolveSlotSupersession(winner, scope);
      if (!supersession) {
        continue;
      }
      const committed = await documentStore.writeBatchIfUnchanged({
        expected: {
          collection: CLAIM_PROJECTIONS_COLLECTION,
          id: winner.id,
          document: winner,
        },
        set: supersession.set,
        unchanged: supersession.unchanged,
      });
      if (committed) {
        closed += supersession.set.filter(
          (entry) => entry.collection === CLAIM_PROJECTIONS_COLLECTION,
        ).length;
      }
    }
    return closed;
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
      let structuredPromotion = false;
      let provenanceEnrichment = false;
      if (existingStatus?.sourceUpdatedAt) {
        const timeOrder = existingStatus.sourceUpdatedAt.localeCompare(
          input.ingestedAt,
        );
        structuredPromotion =
          timeOrder === 0 &&
          existingStatus.state === "unstructured" &&
          state === "projected";
        provenanceEnrichment =
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
      const projectedClaim: ClaimProjection = {
        id: projectionId(projectionWithoutId),
        ...projectionWithoutId,
      };
      const supersession = state === "projected"
        ? await resolveSlotSupersession(projectedClaim, normalized)
        : undefined;
      const claim = supersession?.claim ?? projectedClaim;
      const replacesSameVersionRevision =
        existingStatus?.sourceUpdatedAt === input.ingestedAt &&
        (structuredPromotion ||
          provenanceEnrichment ||
          existingStatus.state === "failed");
      const failedSameVersion = existingStatus?.sourceUpdatedAt ===
          input.ingestedAt &&
        existingStatus.state === "failed";
      const previousClaimSnapshots = replacesSameVersionRevision
        ? await Promise.all(existingStatus.claimIds.map(async (claimId) => ({
            claim: await documentStore.get<ClaimProjection>(
              CLAIM_PROJECTIONS_COLLECTION,
              claimId,
            ),
            id: claimId,
          })))
        : [];
      const retiredClaims = previousClaimSnapshots.filter(
        (snapshot): snapshot is { claim: ClaimProjection; id: string } =>
          snapshot.claim !== null &&
          snapshot.id !== claim.id &&
          snapshot.claim.sourceMemoryId === input.sourceMemoryId &&
          matchesScopeFilter(snapshot.claim, normalized) &&
          snapshot.claim.ingestedAt === input.ingestedAt &&
          (provenanceEnrichment ||
            failedSameVersion ||
            snapshot.claim.predicateKey.startsWith("fact.")),
      );
      const status: ClaimProjectionStatus = {
        id,
        schemaVersion: 2,
        ...normalized,
        scopeKey,
        sourceMemoryId: input.sourceMemoryId,
        state,
        claimIds: [claim.id],
        retiredRevisionIds: retiredRevisionIds(
          existingStatus,
          retiredClaims.map(({ id: claimId }) => claimId),
        ),
        extractorVersion: input.extractorVersion,
        sourceUpdatedAt: input.ingestedAt,
        updatedAt: input.ingestedAt,
      };
      const committed = await documentStore.writeBatchIfUnchanged({
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
          ...retiredClaims.map(({ claim: previousClaim, id: claimId }) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: previousClaim,
            id: claimId,
          })),
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
      const closed = current.map((claim) => {
        if (claim.validUntil) {
          return { previous: claim, projection: claim };
        }
        const { id: _id, ...projectionWithoutId } = claim;
        const projection = {
          ...projectionWithoutId,
          validUntil: fact.updatedAt,
          ingestedAt: fact.updatedAt,
        };
        return {
          previous: claim,
          projection: {
            id: projectionId(projection),
            ...projection,
          },
        };
      });
      const { lastError: _lastError, ...statusWithoutError } = status;
      const nextStatus: ClaimProjectionStatus = {
        ...statusWithoutError,
        state: current.every((claim) => claim.predicateKey.startsWith("fact."))
          ? "unstructured"
          : "projected",
        extractorVersion: current[0]?.extractorVersion ?? status.extractorVersion,
        claimIds: closed.map(({ projection }) => projection.id),
        retiredRevisionIds: retiredRevisionIds(
          status,
          closed.flatMap(({ previous, projection }) =>
            previous.id === projection.id ? [] : [previous.id]
          ),
        ),
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
          ...closed.flatMap(({ previous, projection }) =>
            previous.id === projection.id
              ? []
              : [{
                  collection: CLAIM_PROJECTIONS_COLLECTION,
                  document: projection,
                  id: projection.id,
                }]
          ),
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: nextStatus,
            id: nextStatus.id,
          },
        ],
        unchanged: [
          {
            collection: CLAIM_PROJECTION_STATUS_COLLECTION,
            document: status,
            id: status.id,
          },
          ...current.map((claim) => ({
            collection: CLAIM_PROJECTIONS_COLLECTION,
            document: claim,
            id: claim.id,
          })),
        ],
      });
    }
  }

  return {
    append,
    sweepSlotSupersession,
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
        retiredRevisionIds: retiredRevisionIds(existing),
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
      const statuses = await queryStatuses(scope);
      return loadSelectedClaims(scope, statuses);
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
      const targetLimit = Math.min(limit, MAX_CLAIM_SEARCH_CANDIDATES);
      if (targetLimit <= 0) {
        return [];
      }
      let ranked = new Map<
        string,
        { claim: ClaimProjection; score: number }
      >();
      let retriedInvisibleAtLimit: number | null = null;
      let searchLimit = targetLimit;
      while (true) {
        const results = await documentStore.searchText<ClaimProjection>(
          CLAIM_PROJECTIONS_COLLECTION,
          {
            field: "searchText",
            filter: scopeFilter(scope),
            limit: searchLimit,
            query: searchQuery,
          },
        );
        const sourceMemoryIds = [...new Set(
          results.map(({ document }) => document.sourceMemoryId),
        )];
        const loadedStatuses = await Promise.all(
          sourceMemoryIds.map((sourceMemoryId) =>
            documentStore.get<ClaimProjectionStatus>(
              CLAIM_PROJECTION_STATUS_COLLECTION,
              buildClaimProjectionStatusId(scope, sourceMemoryId),
            )
          ),
        );
        const statusBySourceMemoryId = new Map<
          string,
          ClaimProjectionStatus | null
        >();
        for (const [index, sourceMemoryId] of sourceMemoryIds.entries()) {
          const status = loadedStatuses[index] ?? null;
          statusBySourceMemoryId.set(
            sourceMemoryId,
            status?.sourceMemoryId === sourceMemoryId &&
                matchesCanonicalStatusScope(status, scope)
              ? status
              : null,
          );
        }
        let sawInvisibleResult = false;
        const iterationRanked = new Map<
          string,
          { claim: ClaimProjection; score: number }
        >();
        for (const result of results) {
          if (!matchesCanonicalClaimScope(result.document, scope)) {
            continue;
          }
          const status = statusBySourceMemoryId.get(
            result.document.sourceMemoryId,
          );
          const retired = status?.retiredRevisionIds?.includes(result.id) ??
            false;
          const owned = status?.sourceMemoryId ===
            result.document.sourceMemoryId;
          const visible = owned && (history
            ? !retired
            : !retired && (status?.claimIds.includes(result.id) ?? false));
          if (!visible) {
            sawInvisibleResult = true;
            continue;
          }
          const existing = iterationRanked.get(result.id);
          if (!existing || result.score > existing.score) {
            iterationRanked.set(result.id, {
              claim: result.document,
              score: result.score,
            });
          }
        }
        ranked = iterationRanked;
        if (ranked.size >= targetLimit) {
          break;
        }
        if (
          results.length < searchLimit &&
          sawInvisibleResult &&
          retriedInvisibleAtLimit !== searchLimit
        ) {
          retriedInvisibleAtLimit = searchLimit;
          continue;
        }
        if (
          results.length < searchLimit ||
          searchLimit === MAX_CLAIM_SEARCH_CANDIDATES
        ) {
          break;
        }
        searchLimit = Math.min(
          searchLimit * 2,
          MAX_CLAIM_SEARCH_CANDIDATES,
        );
        retriedInvisibleAtLimit = null;
      }
      return [...ranked.values()]
        .sort(
          (left, right) =>
            right.score - left.score || left.claim.id.localeCompare(right.claim.id),
        )
        .slice(0, targetLimit)
        .map(({ claim }) => claim);
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
      const [queriedStatuses, queriedHistory] = await Promise.all([
        documentStore.query<ClaimProjectionStatus>(
          CLAIM_PROJECTION_STATUS_COLLECTION,
          scopeFilter(scope),
        ),
        documentStore.query<ClaimProjection>(
          CLAIM_PROJECTIONS_COLLECTION,
          scopeFilter(scope),
        ),
      ]);
      const statuses = queriedStatuses.filter((status) =>
        matchesScopeFilter(status, scope)
      );
      const history = queriedHistory.filter((claim) =>
        matchesScopeFilter(claim, scope)
      );
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
