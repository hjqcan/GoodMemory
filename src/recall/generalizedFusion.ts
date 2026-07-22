import { computeBm25Scores } from "./bm25";
import type { LanguageEntityCandidateInput } from "../language";
import {
  isRecallProjectionSourceCollection,
} from "./projections/contracts";
import type {
  ClaimProjection,
  EntityProjection,
  RecallIndexDocument,
  RecallProjectionSourceCollection,
} from "./projections/contracts";
import type { RecallPlan } from "./recallPlan";

export type GeneralizedFusionChannel =
  | "lexical"
  | "dense"
  | "entity"
  | "temporal"
  | "relation";
export type GeneralizedFusionSourceCollection =
  | "facts"
  | "references"
  | "episodes"
  | "session_archives";

export interface DenseFusionCandidate {
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
  score: number;
}

export interface GeneralizedFusionChannelEvidence {
  evidenceDocumentIds: string[];
  rank: number;
  rawScore: number;
  rrfScore: number;
}

export interface GeneralizedFusionCandidate {
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
  score: number;
  evidenceStrength: number;
  channels: Partial<
    Record<GeneralizedFusionChannel, GeneralizedFusionChannelEvidence>
  >;
}

export interface GeneralizedFusionResult {
  budget: number;
  candidates: GeneralizedFusionCandidate[];
  rankedCandidates: GeneralizedFusionCandidate[];
}

export interface GeneralizedFusionInput {
  channels?: readonly GeneralizedFusionChannel[];
  claims?: readonly ClaimProjection[];
  query: string;
  documents: readonly RecallIndexDocument[];
  documentSetComplete?: boolean;
  entities: readonly EntityProjection[];
  denseCandidates?: readonly DenseFusionCandidate[];
  maxCandidates?: number;
  maxEntityMemoryFrequency?: number;
  acceptsEntityCandidate: (input: LanguageEntityCandidateInput) => boolean;
  matchesEntityAlias: (query: string, alias: string) => boolean;
  minRelativeStrength?: number;
  plan?: RecallPlan;
  referenceTime?: string;
  rrfK?: number;
  tokenize: (text: string) => string[];
}

interface RawChannelCandidate {
  evidenceDocumentIds: string[];
  rawScore: number;
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
}

interface RankedChannelCandidate extends RawChannelCandidate {
  normalizedScore: number;
  rank: number;
}

interface RankedFusionChannel {
  name: GeneralizedFusionChannel;
  candidates: RankedChannelCandidate[];
}

interface TemporalClaimSelection {
  claims: ClaimProjection[];
  groupClaims: ReadonlyMap<string, readonly ClaimProjection[]>;
  groupScores: ReadonlyMap<string, number>;
}

export const DEFAULT_GENERALIZED_FUSION_RRF_K = 60;
const DEFAULT_MAX_CANDIDATES = 8;
export const DEFAULT_GENERALIZED_FUSION_MIN_RELATIVE_STRENGTH = 0.35;

function sourceKey(input: {
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
}): string {
  return `${input.sourceCollection}:${input.sourceMemoryId}`;
}

function parseSourceKey(value: string): {
  sourceCollection: RecallProjectionSourceCollection;
  sourceMemoryId: string;
} | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) {
    return null;
  }
  const sourceCollection = value.slice(0, separator);
  if (!isRecallProjectionSourceCollection(sourceCollection)) {
    return null;
  }
  return {
    sourceCollection,
    sourceMemoryId: value.slice(separator + 1),
  };
}

function isDocumentTemporallyVisible(
  document: RecallIndexDocument,
  referenceTime: string | undefined,
): boolean {
  if (!referenceTime) {
    return true;
  }
  const reference = Date.parse(referenceTime);
  if (!Number.isFinite(reference)) {
    return true;
  }
  if (document.effectiveFrom) {
    const startsAt = Date.parse(document.effectiveFrom);
    if (Number.isFinite(startsAt) && startsAt > reference) {
      return false;
    }
  }
  if (document.effectiveUntil) {
    const endsAt = Date.parse(document.effectiveUntil);
    if (Number.isFinite(endsAt) && endsAt <= reference) {
      return false;
    }
  }
  return true;
}

function hasTemporalConstraint(referenceTime: string | undefined): boolean {
  return referenceTime !== undefined && Number.isFinite(Date.parse(referenceTime));
}

function enforceDocumentVisibility(input: GeneralizedFusionInput): boolean {
  return input.documentSetComplete !== false &&
    hasTemporalConstraint(input.referenceTime);
}

function buildVisibleSourceKeys(input: GeneralizedFusionInput): Set<string> {
  return new Set(
    input.documents
      .filter((document) =>
        isDocumentTemporallyVisible(document, input.referenceTime),
      )
      .map(sourceKey),
  );
}

function rankChannel(
  candidates: readonly RawChannelCandidate[],
): RankedChannelCandidate[] {
  const ordered = [...candidates]
    .filter(
      (candidate) =>
        Number.isFinite(candidate.rawScore) && candidate.rawScore > 0,
    )
    .sort(
      (left, right) =>
        right.rawScore - left.rawScore ||
        sourceKey(left).localeCompare(sourceKey(right)),
    );
  const maxScore = ordered[0]?.rawScore ?? 0;
  return ordered.map((candidate, index) => ({
    ...candidate,
    normalizedScore: maxScore > 0 ? candidate.rawScore / maxScore : 0,
    rank: index + 1,
  }));
}

function buildLexicalChannel(input: GeneralizedFusionInput): RankedChannelCandidate[] {
  const visibleDocuments = input.documents.filter((document) =>
    isDocumentTemporallyVisible(document, input.referenceTime),
  );
  const scores = computeBm25Scores(
    input.query,
    visibleDocuments.map((document) => ({
      id: document.id,
      text: document.text,
    })),
    { tokenize: input.tokenize },
  );
  const grouped = new Map<
    string,
    RawChannelCandidate & { scoredDocuments: Array<{ id: string; score: number }> }
  >();
  for (const document of visibleDocuments) {
    const score = scores.get(document.id) ?? 0;
    if (score <= 0) {
      continue;
    }
    const key = sourceKey(document);
    const existing = grouped.get(key);
    if (existing) {
      existing.rawScore = Math.max(existing.rawScore, score);
      existing.scoredDocuments.push({ id: document.id, score });
      continue;
    }
    grouped.set(key, {
      sourceCollection: document.sourceCollection,
      sourceMemoryId: document.sourceMemoryId,
      rawScore: score,
      evidenceDocumentIds: [],
      scoredDocuments: [{ id: document.id, score }],
    });
  }
  return rankChannel(
    [...grouped.values()].map((candidate) => ({
      sourceCollection: candidate.sourceCollection,
      sourceMemoryId: candidate.sourceMemoryId,
      rawScore: candidate.rawScore,
      evidenceDocumentIds: candidate.scoredDocuments
        .sort(
          (left, right) =>
            right.score - left.score || left.id.localeCompare(right.id),
        )
        .slice(0, 3)
        .map((document) => document.id),
    })),
  );
}

function buildDenseChannel(
  input: GeneralizedFusionInput,
  visibleSourceKeys: ReadonlySet<string>,
): RankedChannelCandidate[] {
  const grouped = new Map<string, RawChannelCandidate>();
  for (const candidate of input.denseCandidates ?? []) {
    if (!Number.isFinite(candidate.score) || candidate.score <= 0) {
      continue;
    }
    const key = sourceKey(candidate);
    if (enforceDocumentVisibility(input) && !visibleSourceKeys.has(key)) {
      continue;
    }
    const existing = grouped.get(key);
    if (existing && existing.rawScore >= candidate.score) {
      continue;
    }
    grouped.set(key, {
      sourceCollection: candidate.sourceCollection,
      sourceMemoryId: candidate.sourceMemoryId,
      rawScore: candidate.score,
      evidenceDocumentIds: [],
    });
  }
  return rankChannel([...grouped.values()]);
}

function entityMatchesQuery(
  input: GeneralizedFusionInput,
  entity: EntityProjection,
): boolean {
  const matches = (alias: string) =>
    input.matchesEntityAlias(input.query, alias);
  return matches(entity.canonicalKey) || entity.aliases.some(matches);
}

function acceptsEntity(
  input: GeneralizedFusionInput,
  entity: EntityProjection,
  documentTexts: readonly string[],
): boolean {
  return input.acceptsEntityCandidate({
    aliases: entity.aliases,
    canonicalKey: entity.canonicalKey,
    documentTexts,
  });
}

function buildEntityChannel(
  input: GeneralizedFusionInput,
  visibleSourceKeys: ReadonlySet<string>,
): RankedChannelCandidate[] {
  const temporalConstraint = enforceDocumentVisibility(input);
  const sourceMemoryCount = temporalConstraint
    ? visibleSourceKeys.size
    : new Set(input.entities.flatMap(({ memoryIds }) => memoryIds)).size;
  const maxEntityMemoryFrequency = Math.max(
    1,
    Math.floor(
      input.maxEntityMemoryFrequency ??
        Math.max(2, Math.ceil(Math.sqrt(Math.max(1, sourceMemoryCount)))),
    ),
  );
  const documentTexts = input.documents.map(({ text }) => text);
  const matchedEntities = input.entities
    .map((entity) => ({
      ...entity,
      memoryIds: temporalConstraint
        ? entity.memoryIds.filter((memoryId) => visibleSourceKeys.has(memoryId))
        : entity.memoryIds,
    }))
    .filter(
      (entity) =>
        entity.memoryIds.length > 0 &&
        entity.memoryIds.length <= maxEntityMemoryFrequency &&
        entityMatchesQuery(input, entity) &&
        acceptsEntity(input, entity, documentTexts),
    );
  if (matchedEntities.length === 0) {
    return [];
  }
  const descriptionScores = computeBm25Scores(
    input.query,
    matchedEntities.map((entity) => ({
      id: entity.id,
      text: [entity.canonicalKey, ...entity.aliases, entity.description ?? ""].join(
        " ",
      ),
    })),
    { tokenize: input.tokenize },
  );
  const grouped = new Map<string, RawChannelCandidate>();
  for (const entity of matchedEntities) {
    const rarity = 1 / Math.max(1, entity.memoryIds.length);
    const entityScore = rarity * (1 + (descriptionScores.get(entity.id) ?? 0) * 0.25);
    for (const memoryId of entity.memoryIds) {
      const source = parseSourceKey(memoryId);
      if (!source) {
        continue;
      }
      const key = sourceKey(source);
      const existing = grouped.get(key);
      if (existing) {
        existing.rawScore += entityScore;
        existing.evidenceDocumentIds.push(entity.id);
      } else {
        grouped.set(key, {
          ...source,
          rawScore: entityScore,
          evidenceDocumentIds: [entity.id],
        });
      }
    }
  }
  return rankChannel(
    [...grouped.values()].map((candidate) => ({
      ...candidate,
      evidenceDocumentIds: [...new Set(candidate.evidenceDocumentIds)].sort(),
    })),
  );
}

function claimText(claim: ClaimProjection): string {
  return [
    claim.predicateKey.replace(/[._:-]+/gu, " "),
    claim.objectText,
    claim.contextualDescriptor ?? "",
  ].join(" ");
}

function buildClaimRelevance(
  input: GeneralizedFusionInput,
): Map<string, number> {
  const claims = input.claims ?? [];
  return computeBm25Scores(
    input.query,
    claims.map((claim) => ({ id: claim.id, text: claimText(claim) })),
    { tokenize: input.tokenize },
  );
}

function matchedQueryEntityIds(input: GeneralizedFusionInput): Set<string> {
  const documentTexts = input.documents.map(({ text }) => text);
  return new Set(
    input.entities
      .filter(
        (entity) =>
          entityMatchesQuery(input, entity) &&
          acceptsEntity(input, entity, documentTexts),
      )
      .map((entity) => entity.id),
  );
}

function claimTime(claim: ClaimProjection): number {
  for (const value of [claim.validFrom, claim.observedAt, claim.ingestedAt]) {
    if (!value) {
      continue;
    }
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return 0;
}

function isClaimCurrent(
  claim: ClaimProjection,
  referenceTime: string | undefined,
): boolean {
  const reference = referenceTime ? Date.parse(referenceTime) : Number.NaN;
  if (!Number.isFinite(reference)) {
    return !claim.validUntil;
  }
  const validFrom = claim.validFrom ? Date.parse(claim.validFrom) : Number.NaN;
  if (Number.isFinite(validFrom) && validFrom > reference) {
    return false;
  }
  const validUntil = claim.validUntil
    ? Date.parse(claim.validUntil)
    : Number.NaN;
  return !Number.isFinite(validUntil) || validUntil > reference;
}

function selectCurrentClaimsByGroup(
  claims: readonly ClaimProjection[],
  referenceTime: string | undefined,
): ClaimProjection[] {
  const selected: ClaimProjection[] = [];
  for (const group of groupClaimsBySubjectPredicate(claims).values()) {
    const current = group.filter((claim) =>
      isClaimCurrent(claim, referenceTime),
    );
    const latestTime = Math.max(...current.map(claimTime));
    selected.push(
      ...current.filter((claim) => claimTime(claim) === latestTime),
    );
  }
  return selected;
}

function groupClaimsBySubjectPredicate(
  claims: readonly ClaimProjection[],
): Map<string, ClaimProjection[]> {
  const grouped = new Map<string, ClaimProjection[]>();
  for (const claim of claims) {
    const key = claimProjectionGroupKey(claim);
    const group = grouped.get(key) ?? [];
    group.push(claim);
    grouped.set(key, group);
  }
  return grouped;
}

export function claimProjectionGroupKey(
  claim: Pick<
    ClaimProjection,
    "predicateKey" | "scopeKey" | "subjectEntityId"
  >,
): string {
  return `${claim.scopeKey}\u0000${claim.subjectEntityId}\u0000${claim.predicateKey}`;
}

function selectTemporalClaims(input: {
  claims: readonly ClaimProjection[];
  plan: RecallPlan;
  referenceTime: string | undefined;
}): ClaimProjection[] {
  const selected: ClaimProjection[] = [];
  const groups = groupClaimsBySubjectPredicate(input.claims);
  const historyRequested =
    input.plan.aggregation === "history" ||
    input.plan.temporalConstraints.some(({ kind }) => kind === "history");
  const changeRequested = input.plan.aggregation === "change";
  const countRequested = input.plan.aggregation === "count";
  const boundaries = input.plan.temporalConstraints.filter(
    ({ kind }) => kind === "before" || kind === "after",
  );

  for (const group of groups.values()) {
    const ordered = [...group].sort(
      (left, right) =>
        claimTime(left) - claimTime(right) || left.id.localeCompare(right.id),
    );
    const bounded = ordered.filter((claim) => boundaries.every((constraint) => {
      const boundary = Date.parse(constraint.referenceTime);
      if (!Number.isFinite(boundary)) {
        return true;
      }
      return constraint.kind === "before"
        ? claimTime(claim) < boundary
        : claimTime(claim) >= boundary;
    }));
    if (changeRequested) {
      const distinctValues = new Set(
        bounded.map(
          (claim) =>
            `${claim.polarity}\u0000${claim.modality}\u0000${claim.objectText}`,
        ),
      );
      if (distinctValues.size > 1) {
        selected.push(...bounded);
      }
      continue;
    }
    if (historyRequested) {
      selected.push(...bounded);
      continue;
    }

    if (boundaries.length > 0) {
      if (countRequested) {
        selected.push(...bounded);
      } else {
        const latest = bounded.at(-1);
        if (latest) {
          selected.push(latest);
        }
      }
      continue;
    }

    const current = bounded.filter((claim) =>
      isClaimCurrent(claim, input.referenceTime),
    );
    if (countRequested) {
      selected.push(...current);
      continue;
    }
    const latest = current.at(-1);
    if (latest) {
      selected.push(latest);
    }
  }
  const sourcesWithStructuredClaims = new Set(
    selected
      .filter(({ extractorVersion }) => extractorVersion !== "deterministic-fact-v1")
      .map(({ sourceMemoryId }) => sourceMemoryId),
  );
  return selected.filter(
    (claim) =>
      claim.extractorVersion !== "deterministic-fact-v1" ||
      !sourcesWithStructuredClaims.has(claim.sourceMemoryId),
  );
}

function collectBaseFactScores(
  channels: readonly RankedFusionChannel[],
): Map<string, number> {
  const scores = new Map<string, number>();
  for (const channel of channels) {
    for (const candidate of channel.candidates) {
      if (candidate.sourceCollection !== "facts") {
        continue;
      }
      scores.set(
        candidate.sourceMemoryId,
        Math.max(
          scores.get(candidate.sourceMemoryId) ?? 0,
          candidate.normalizedScore,
        ),
      );
    }
  }
  return scores;
}

function buildTemporalClaimSelection(input: {
  baseScoresBySource: ReadonlyMap<string, number>;
  fusion: GeneralizedFusionInput;
  relevance: ReadonlyMap<string, number>;
}): TemporalClaimSelection {
  if (!input.fusion.plan || !input.fusion.claims) {
    return { claims: [], groupClaims: new Map(), groupScores: new Map() };
  }
  const groupClaims = groupClaimsBySubjectPredicate(input.fusion.claims);
  const anchoredGroupClaims = new Map<string, readonly ClaimProjection[]>();
  const groupScores = new Map<string, number>();
  const hasBaseCandidates = input.baseScoresBySource.size > 0;
  for (const [groupKey, claims] of groupClaims) {
    if (claims.length < 2) {
      continue;
    }
    let score = 0;
    for (const claim of claims) {
      const baseScore = input.baseScoresBySource.get(claim.sourceMemoryId) ?? 0;
      const claimRelevance = input.relevance.get(claim.id) ?? 0;
      if (claimRelevance > 0 && (baseScore > 0 || !hasBaseCandidates)) {
        score = Math.max(score, baseScore, claimRelevance);
      }
    }
    if (score <= 0) {
      continue;
    }
    anchoredGroupClaims.set(groupKey, claims);
    groupScores.set(groupKey, score);
  }
  return {
    claims: selectTemporalClaims({
      claims: [...anchoredGroupClaims.values()].flat(),
      plan: input.fusion.plan,
      referenceTime: input.fusion.referenceTime,
    }),
    groupClaims: anchoredGroupClaims,
    groupScores,
  };
}

function filterChannelsToTemporalClaimBoundary(
  input: GeneralizedFusionInput,
  channels: RankedFusionChannel[],
  selection: TemporalClaimSelection,
): void {
  if (!input.plan || !input.claims) {
    return;
  }
  const constrained =
    input.plan.aggregation === "count" ||
    input.plan.aggregation === "current" ||
    input.plan.temporalConstraints.some(
      ({ kind }) =>
        kind === "before" || kind === "after" || kind === "current",
    );
  if (!constrained) {
    return;
  }
  const competingSourceIds = new Set(
    [...selection.groupClaims.values()]
      .flat()
      .map(({ sourceMemoryId }) => sourceMemoryId),
  );
  const selectedSourceIds = new Set(
    selection.claims.map(({ sourceMemoryId }) => sourceMemoryId),
  );
  for (const channel of channels) {
    channel.candidates = channel.candidates.filter((candidate) =>
      candidate.sourceCollection !== "facts" ||
      !competingSourceIds.has(candidate.sourceMemoryId) ||
      selectedSourceIds.has(candidate.sourceMemoryId)
    );
  }
}

function buildTemporalChannel(
  input: GeneralizedFusionInput,
  relevance: ReadonlyMap<string, number>,
  selection: TemporalClaimSelection,
): RankedChannelCandidate[] {
  if (
    !input.plan ||
    !input.claims ||
    (!input.plan.evidenceNeeds.includes("temporal") &&
      input.plan.temporalConstraints.length === 0 &&
      input.plan.aggregation === undefined)
  ) {
    return [];
  }
  const bySource = new Map<string, RawChannelCandidate>();
  for (const claim of selection.claims) {
    const rawScore = Math.max(
      relevance.get(claim.id) ?? 0,
      selection.groupScores.get(claimProjectionGroupKey(claim)) ?? 0,
    );
    if (rawScore <= 0) {
      continue;
    }
    const existing = bySource.get(claim.sourceMemoryId);
    if (existing) {
      existing.evidenceDocumentIds.push(claim.id);
      existing.rawScore = Math.max(existing.rawScore, rawScore);
    } else {
      bySource.set(claim.sourceMemoryId, {
        evidenceDocumentIds: [claim.id],
        rawScore,
        sourceCollection: "facts",
        sourceMemoryId: claim.sourceMemoryId,
      });
    }
  }
  return rankChannel([...bySource.values()]);
}

function buildRelationChannel(
  input: GeneralizedFusionInput,
  relevance: ReadonlyMap<string, number>,
  baseScoresBySource: ReadonlyMap<string, number>,
): RankedChannelCandidate[] {
  if (
    !input.plan?.evidenceNeeds.includes("relation") ||
    !input.claims
  ) {
    return [];
  }
  const matchedEntityIds = matchedQueryEntityIds(input);
  const bySource = new Map<string, RawChannelCandidate>();
  for (const claim of selectCurrentClaimsByGroup(
    input.claims,
    input.referenceTime,
  )) {
    if (claim.objectEntityId === undefined) {
      continue;
    }
    const endpointMatches = Number(matchedEntityIds.has(claim.subjectEntityId)) +
      Number(matchedEntityIds.has(claim.objectEntityId));
    const baseScore = baseScoresBySource.get(claim.sourceMemoryId) ?? 0;
    const fullySpecifiedEdge = matchedEntityIds.size >= 2 && endpointMatches === 2;
    const lexicalRelevance = relevance.get(claim.id) ?? 0;
    if (
      endpointMatches === 0 ||
      (!fullySpecifiedEdge && baseScore <= 0 && lexicalRelevance <= 0)
    ) {
      continue;
    }
    const rawScore = endpointMatches + baseScore + lexicalRelevance;
    const existing = bySource.get(claim.sourceMemoryId);
    if (existing) {
      existing.evidenceDocumentIds.push(claim.id);
      existing.rawScore = Math.max(existing.rawScore, rawScore);
    } else {
      bySource.set(claim.sourceMemoryId, {
        evidenceDocumentIds: [claim.id],
        rawScore,
        sourceCollection: "facts",
        sourceMemoryId: claim.sourceMemoryId,
      });
    }
  }
  return rankChannel([...bySource.values()]);
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function computeEvidenceStrength(
  channels: GeneralizedFusionCandidate["channels"],
): number {
  let inverse = 1;
  for (const channel of Object.values(channels)) {
    inverse *= 1 - clampUnit(channel.rawScore);
  }
  return 1 - inverse;
}

export function selectDynamicFusionBudget(
  ranked: readonly GeneralizedFusionCandidate[],
  options?: {
    maxCandidates?: number;
    minCandidates?: number;
    minRelativeStrength?: number;
  },
): GeneralizedFusionCandidate[] {
  if (ranked.length === 0) {
    return [];
  }
  const maxCandidates = Math.max(
    0,
    Math.floor(options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES),
  );
  if (maxCandidates === 0) {
    return [];
  }
  const minCandidates = Math.min(
    maxCandidates,
    Math.max(1, Math.floor(options?.minCandidates ?? 1)),
  );
  const minRelativeStrength = clampUnit(
    options?.minRelativeStrength ??
      DEFAULT_GENERALIZED_FUSION_MIN_RELATIVE_STRENGTH,
  );
  const strongest = Math.max(...ranked.map((candidate) => candidate.evidenceStrength));
  const threshold = strongest * minRelativeStrength;
  const qualified = ranked.filter(
    (candidate) => candidate.evidenceStrength + Number.EPSILON >= threshold,
  );
  const budget = Math.min(
    maxCandidates,
    Math.max(minCandidates, qualified.length),
  );
  if (qualified.length >= minCandidates) {
    return qualified.slice(0, budget);
  }
  return [...ranked].slice(0, budget);
}

export function fuseGeneralizedRecallCandidates(
  input: GeneralizedFusionInput,
): GeneralizedFusionResult {
  const rrfK = Math.max(1, input.rrfK ?? DEFAULT_GENERALIZED_FUSION_RRF_K);
  const visibleSourceKeys = buildVisibleSourceKeys(input);
  const claimRelevance = buildClaimRelevance(input);
  const enabledChannels = input.channels
    ? new Set(input.channels)
    : undefined;
  const baseChannels: RankedFusionChannel[] = [
    { name: "lexical", candidates: buildLexicalChannel(input) },
    { name: "dense", candidates: buildDenseChannel(input, visibleSourceKeys) },
    { name: "entity", candidates: buildEntityChannel(input, visibleSourceKeys) },
  ];
  const enabledBaseChannels = baseChannels.filter(
    ({ name }) => enabledChannels?.has(name) ?? true,
  );
  const baseScoresBySource = collectBaseFactScores(enabledBaseChannels);
  const temporalSelection = buildTemporalClaimSelection({
    baseScoresBySource,
    fusion: input,
    relevance: claimRelevance,
  });
  const allChannels: RankedFusionChannel[] = [
    ...enabledBaseChannels,
    {
      name: "temporal",
      candidates: buildTemporalChannel(
        input,
        claimRelevance,
        temporalSelection,
      ),
    },
    {
      name: "relation",
      candidates: buildRelationChannel(
        input,
        claimRelevance,
        baseScoresBySource,
      ),
    },
  ];
  const channels = allChannels.filter(
    ({ name }) => enabledChannels?.has(name) ?? true,
  );
  if (channels.some(({ name }) => name === "temporal")) {
    filterChannelsToTemporalClaimBoundary(input, channels, temporalSelection);
  }
  const fused = new Map<string, GeneralizedFusionCandidate>();
  for (const channel of channels) {
    for (const candidate of channel.candidates) {
      const key = sourceKey(candidate);
      const rrfScore = 1 / (rrfK + candidate.rank);
      const existing = fused.get(key) ?? {
        sourceCollection: candidate.sourceCollection,
        sourceMemoryId: candidate.sourceMemoryId,
        score: 0,
        evidenceStrength: 0,
        channels: {},
      };
      existing.score += rrfScore;
      existing.channels[channel.name] = {
        evidenceDocumentIds: candidate.evidenceDocumentIds,
        rank: candidate.rank,
        rawScore: candidate.normalizedScore,
        rrfScore,
      };
      fused.set(key, existing);
    }
  }
  const rankedCandidates = [...fused.values()]
    .map((candidate) => ({
      ...candidate,
      evidenceStrength: computeEvidenceStrength(candidate.channels),
    }))
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.evidenceStrength - left.evidenceStrength ||
        sourceKey(left).localeCompare(sourceKey(right)),
    );
  const candidates = selectDynamicFusionBudget(rankedCandidates, {
    maxCandidates: input.maxCandidates,
    minRelativeStrength: input.minRelativeStrength,
  });
  return {
    budget: candidates.length,
    candidates,
    rankedCandidates,
  };
}
