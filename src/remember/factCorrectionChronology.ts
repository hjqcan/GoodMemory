import { createHash } from "node:crypto";
import type { FactMemory } from "../domain/records";
import { isSameDurableScope, type MemoryScope } from "../domain/scope";
import { isRfc3339Instant } from "../domain/temporal";
import { EVIDENCE_COLLECTION, SOURCE_MESSAGES_COLLECTION, type EvidenceRecord, type SourceMessageRecord } from "../evidence/contracts";
import { evidenceSchema, sourceMessageSchema } from "../interchange/durableEnvelope";
import type { ConditionalDocumentWriteBatch, DocumentStore } from "../storage/contracts";

type Snapshot = ConditionalDocumentWriteBatch["expected"];

export function factCorrectionIsCurrent(input: {
  target: FactMemory; incoming: SourceMessageRecord; validFrom?: string; validUntil?: string; now: string;
}): boolean {
  const now = Date.parse(input.now);
  const currentWindow = (from?: string, until?: string) =>
    (from === undefined || (isRfc3339Instant(from) && Date.parse(from) <= now)) &&
    (until === undefined || (isRfc3339Instant(until) && Date.parse(until) > now));
  return Number.isFinite(now) && currentWindow(input.target.validFrom, input.target.validUntil) &&
    currentWindow(input.validFrom, input.validUntil) &&
    (input.incoming.observedAt === undefined || (isRfc3339Instant(input.incoming.observedAt) && Date.parse(input.incoming.observedAt) <= now));
}

/** Author observation time is independent of ingestion/extraction time. */
export async function checkFactCorrectionChronology(input: {
  scope: MemoryScope;
  target: FactMemory;
  incoming: SourceMessageRecord;
  validFrom?: string;
  validUntil?: string;
  now: string;
  get: DocumentStore["get"];
  query: DocumentStore["query"];
  supportsAuthorSource: (source: SourceMessageRecord, evidence: EvidenceRecord) => boolean;
}): Promise<{ reason?: string; unchanged: Snapshot[]; querySnapshots: NonNullable<ConditionalDocumentWriteBatch["querySnapshots"]> }> {
  const filter = Object.fromEntries(Object.entries({ userId: input.scope.userId,
    tenantId: input.scope.tenantId, workspaceId: input.scope.workspaceId, agentId: input.scope.agentId,
  }).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const evidence = await input.query<EvidenceRecord>(EVIDENCE_COLLECTION, filter);
  const querySnapshots = [{ collection: EVIDENCE_COLLECTION, filter, documents: evidence }];
  const snapshots = new Map<string, Snapshot>();
  const supports = new Map<string, SourceMessageRecord>();
  let verified = true;
  for (const link of evidence.filter(item => isSameDurableScope(item, input.scope) && item.linkedMemoryIds.includes(input.target.id))) {
    if (!evidenceSchema.safeParse(link).success || !link.sourceRecordIds?.length) { verified = false; continue; }
    for (const id of link.sourceRecordIds) {
      const source = await input.get<SourceMessageRecord>(SOURCE_MESSAGES_COLLECTION, id);
      snapshots.set(id, { collection: SOURCE_MESSAGES_COLLECTION, id, document: source });
      if (!source || source.id !== id || !sourceMessageSchema.safeParse(source).success ||
        !isSameDurableScope(source, input.scope) ||
        (source.observedAt !== undefined && !isRfc3339Instant(source.observedAt)) ||
        createHash("sha256").update(source.content).digest("hex") !== source.contentSha256) {
        verified = false; continue;
      }
      if (source.role === "user") {
        // Every linked author observation must be accounted for. An uncertain
        // source cannot be silently excluded while another source lends a clock.
        if (input.supportsAuthorSource(source, link)) supports.set(id, source);
        else verified = false;
      }
    }
  }
  const unchanged = [...snapshots.values()];
  const reject = (reason: string) => ({ reason, unchanged, querySnapshots });
  if (!verified || supports.size === 0) return reject("unverified_fact_correction_target");
  if (!factCorrectionIsCurrent(input)) {
    return reject("not_current_fact_correction_source");
  }
  const priorTimes = [...supports.values()].map(source => source.observedAt === undefined ? undefined : Date.parse(source.observedAt));
  const incomingTime = input.incoming.observedAt === undefined ? undefined : Date.parse(input.incoming.observedAt);
  // With no clocks on either side, the live author's complete explicit
  // "instead of" statement provides the directional replacement assertion.
  // One-sided, equal or mixed clocks cannot prove that relation is current.
  if (incomingTime === undefined && priorTimes.every(time => time === undefined)) return { unchanged, querySnapshots };
  if (incomingTime === undefined || !Number.isFinite(incomingTime) ||
    priorTimes.some(time => time === undefined || !Number.isFinite(time))) return reject("unordered_fact_correction_source");
  const latestPrior = Math.max(...priorTimes as number[]);
  if (incomingTime < latestPrior) return reject("stale_fact_correction_source");
  if (incomingTime === latestPrior) return reject("unordered_fact_correction_source");
  return { unchanged, querySnapshots };
}
