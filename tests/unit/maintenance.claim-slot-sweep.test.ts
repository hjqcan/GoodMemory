import { describe, expect, it } from "bun:test";
import {
  createGoodMemory,
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src";
import type { ClassifiedCandidate } from "../../src/remember/contracts";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  CLAIM_PROJECTION_STATUS_COLLECTION,
  type ClaimProjection,
  type ClaimProjectionStatus,
} from "../../src/recall/projections/contracts";

// R9.4: the contradiction maintenance job runs R4.1's structural supersession
// in batch form over legacy or damaged slots. The normal append path converges
// ordered and out-of-order writes immediately; the sweep remains a repair path
// for two selected open values in the same structured slot.
describe("claim slot sweep (contradiction maintenance job)", () => {
  const scope = { userId: "u-1", workspaceId: "workspace-a" };
  const NOW = "2026-07-01T00:00:00.000Z";

  function residenceCandidate(
    id: string,
    city: string,
  ): ClassifiedCandidate {
    return {
      id,
      kindHint: "fact",
      memoryType: "fact",
      decision: "write",
      score: 1,
      explicitness: "explicit",
      content: `Marco lives in ${city}.`,
      sourceMessageIndex: 0,
      sourceRole: "user",
      extractorIds: ["atomic-extractor-v2"],
      metadata: {
        category: "personal",
        subject: "Marco",
        claim: {
          predicateKey: "person.residence",
          objectText: city,
          polarity: "positive",
          modality: "asserted",
        },
      },
    };
  }

  async function seedOutOfOrder() {
    const rawStore = createInMemoryDocumentStore();
    const batches: ClassifiedCandidate[][] = [
      [residenceCandidate("candidate-lisbon", "Lisbon")],
      [residenceCandidate("candidate-paris", "Paris")],
    ];
    const memory = createGoodMemory({
      adapters: {
        documentStore: rawStore,
        sessionStore: createInMemorySessionStore(),
      },
      retrieval: { preset: "recommended" },
      testing: {
        extractor: {
          async extract() {
            return {
              candidates: batches.shift() ?? [],
              ignoredMessageCount: 0,
            };
          },
        },
        now: () => new Date(NOW),
      },
    });

    // Newest observation ingested FIRST: the write path has nothing to close
    // when the older Paris value lands afterwards.
    await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Marco lives in Lisbon.",
          observedAt: "2026-06-01T10:00:00.000Z",
        },
      ],
    });
    await memory.remember({
      scope,
      messages: [
        {
          role: "user",
          content: "Marco lives in Paris.",
          observedAt: "2026-03-01T10:00:00.000Z",
        },
      ],
    });
    return { memory, rawStore };
  }

  async function slotClaims(
    rawStore: ReturnType<typeof createInMemoryDocumentStore>,
  ) {
    const claims = await rawStore.query<ClaimProjection>(
      CLAIM_PROJECTIONS_COLLECTION,
      {},
    );
    const statuses = await rawStore.query<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      {},
    );
    const selected = new Set(statuses.flatMap((status) => status.claimIds));
    return claims.filter(
      (claim) =>
        claim.predicateKey === "person.residence" && selected.has(claim.id),
    );
  }

  async function seedLegacyOpenSlot() {
    const seeded = await seedOutOfOrder();
    const selected = await slotClaims(seeded.rawStore);
    const paris = selected.find((claim) => claim.objectText === "Paris")!;
    const statuses = await seeded.rawStore.query<ClaimProjectionStatus>(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      {},
    );
    const status = statuses.find(
      (candidate) => candidate.sourceMemoryId === paris.sourceMemoryId,
    )!;
    const legacyOpenParis: ClaimProjection = {
      ...paris,
      id: "legacy-open-paris",
      validUntil: undefined,
    };
    await seeded.rawStore.set(
      CLAIM_PROJECTIONS_COLLECTION,
      legacyOpenParis.id,
      legacyOpenParis,
    );
    await seeded.rawStore.set(
      CLAIM_PROJECTION_STATUS_COLLECTION,
      status.id,
      {
        ...status,
        claimIds: status.claimIds.map((claimId) =>
          claimId === paris.id ? legacyOpenParis.id : claimId
        ),
      },
    );
    return seeded;
  }

  it("converges newest-first ingestion before maintenance runs", async () => {
    const { memory, rawStore } = await seedOutOfOrder();

    const before = await slotClaims(rawStore);
    expect(before).toHaveLength(2);
    expect(before.find((claim) => claim.objectText === "Paris")?.validUntil)
      .toBe("2026-06-01T10:00:00.000Z");
    expect(before.find((claim) => claim.objectText === "Lisbon")?.validUntil)
      .toBeUndefined();

    const report = await memory.runMaintenance({ scope, jobs: ["contradiction"] });
    const contradiction = report.maintenance?.jobs.find(
      (job) => job.name === "contradiction",
    );
    expect(contradiction?.applied).toBe(0);
  });

  it("repairs a legacy slot containing two selected open values", async () => {
    const { memory, rawStore } = await seedLegacyOpenSlot();

    const before = await slotClaims(rawStore);
    expect(before).toHaveLength(2);
    expect(before.every((claim) => claim.validUntil === undefined)).toBe(true);

    const report = await memory.runMaintenance({ scope, jobs: ["contradiction"] });
    const contradiction = report.maintenance?.jobs.find(
      (job) => job.name === "contradiction",
    );
    expect(contradiction?.applied).toBeGreaterThanOrEqual(1);

    const after = await slotClaims(rawStore);
    const paris = after.find((claim) => claim.objectText === "Paris");
    const lisbon = after.find((claim) => claim.objectText === "Lisbon");
    // Bi-temporal soft invalidation, batch form: the stale value closes at the
    // newer observation; the newest value stays open; history is preserved.
    expect(paris?.validUntil).toBe("2026-06-01T10:00:00.000Z");
    expect(lisbon?.validUntil).toBeUndefined();
  });

  it("is idempotent: a second sweep closes nothing further", async () => {
    const { memory } = await seedLegacyOpenSlot();
    await memory.runMaintenance({ scope, jobs: ["contradiction"] });
    const second = await memory.runMaintenance({
      scope,
      jobs: ["contradiction"],
    });
    const contradiction = second.maintenance?.jobs.find(
      (job) => job.name === "contradiction",
    );
    expect(contradiction?.applied).toBe(0);
  });
});
