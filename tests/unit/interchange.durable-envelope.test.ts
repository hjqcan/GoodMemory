import { describe, expect, it } from "bun:test";
import { createGoodMemory } from "../../src";
import {
  createExperienceRecord,
  createLearningProposal,
  createPromotionRecord,
  createSessionArchive,
} from "../../src/domain/evolutionRecords";
import { createNoteMemory, createUserProfile } from "../../src/domain/records";
import type { FactMemory } from "../../src/domain/records";
import { describeInvalidDurable } from "../../src/interchange/durableEnvelope";
import { buildNoteRememberInput } from "../../src/remember/noteInput";

// The durable half of an export envelope crosses an external boundary (HTTP
// bridge, files on disk). Every record is validated against its real shape
// before any write; operator confirmation says the operator trusts the file's
// origin, not that its contents are well-formed.

const scope = { userId: "u-envelope", workspaceId: "workspace-a" };
const NOW = "2026-09-02T00:00:00.000Z";

async function realEnvelope() {
  const memory = createGoodMemory({ storage: { provider: "memory" } });
  await memory.remember({
    messages: [
      { content: "Remember that my editor is Neovim and I work on the Atlas migration.", role: "user" },
      { content: "Noted: Neovim, Atlas migration.", role: "assistant" },
    ],
    scope: { ...scope, sessionId: "session-1" },
  });
  await memory.remember(
    buildNoteRememberInput({ body: "# Woks\n\nCarbon fibre woks scorch at the centre.\n", scope, title: "Woks" }),
  );
  const exported = await memory.exportMemory({ scope });
  const common = { traceId: "trace-1", userId: scope.userId, workspaceId: scope.workspaceId };
  return {
    ...exported.durable,
    archives: [
      createSessionArchive({ id: "archive-1", sessionId: "session-1", summary: "Session one.", userId: scope.userId, workspaceId: scope.workspaceId }),
    ],
    experiences: [createExperienceRecord({ ...common, id: "exp-1", kind: "recall", summary: "Recalled." })],
    profile: createUserProfile({ userId: scope.userId }),
    promotions: [
      createPromotionRecord({ ...common, decision: "accepted", id: "promo-1", proposalId: "prop-1", rationale: "Confirmed.", summary: "Promoted." }),
    ],
    proposals: [
      createLearningProposal({ ...common, id: "prop-1", proposalType: "memory_write", rationale: "Seen twice.", summary: "Promote." }),
    ],
  };
}

describe("durable envelope validation", () => {
  it("accepts a real export envelope and tolerates unknown extra fields", async () => {
    const envelope = await realEnvelope();
    expect(envelope.facts.length).toBeGreaterThan(0);
    expect(envelope.notes?.length).toBe(1);
    expect(describeInvalidDurable(envelope)).toBeNull();

    const forwardCompatible = {
      ...envelope,
      facts: envelope.facts.map((fact) => ({ ...fact, fieldFromANewerRelease: { nested: true } })),
    };
    expect(describeInvalidDurable(forwardCompatible)).toBeNull();
  });

  it("names the first malformed field of a record, collection by collection", async () => {
    const envelope = await realEnvelope();
    const fact = envelope.facts[0]!;
    const withFact = (patch: Partial<Record<keyof FactMemory, unknown>>, drop: Array<keyof FactMemory> = []) => {
      const record: Record<string, unknown> = { ...fact, ...patch };
      for (const key of drop) {
        delete record[key];
      }
      return { ...envelope, facts: [record] };
    };

    // The reviewer's probe: a fact carrying nothing but scope and id.
    expect(
      describeInvalidDurable({ ...envelope, facts: [{ id: "fact-broken", userId: scope.userId, workspaceId: scope.workspaceId }] }),
    ).toMatch(/^facts\[0\]\.(category|content): /);
    expect(describeInvalidDurable(withFact({}, ["content"]))).toMatch(/^facts\[0\]\.content: /);
    expect(describeInvalidDurable(withFact({ lifecycle: "zombie" }))).toMatch(/^facts\[0\]\.lifecycle: /);
    expect(describeInvalidDurable(withFact({ createdAt: "yesterday" }))).toMatch(/^facts\[0\]\.createdAt: /);
    expect(describeInvalidDurable(withFact({ source: { method: "guess", extractedAt: NOW } }))).toMatch(
      /^facts\[0\]\.source\.method: /,
    );
    expect(describeInvalidDurable(withFact({ tags: "not-a-list" }))).toMatch(/^facts\[0\]\.tags: /);
    expect(describeInvalidDurable(withFact({ isActive: "yes" }))).toMatch(/^facts\[0\]\.isActive: /);

    const note = createNoteMemory({
      body: "Body.",
      id: "note-1",
      source: { extractedAt: NOW, method: "import" },
      title: "Title",
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    });
    expect(describeInvalidDurable({ ...envelope, notes: [{ ...note, format: "html" }] })).toMatch(/^notes\[0\]\.format: /);
    expect(describeInvalidDurable({ ...envelope, evidence: [{ ...envelope.evidence[0], sourceMessageIds: "m-1" }] })).toMatch(
      /^evidence\[0\]\.sourceMessageIds: /,
    );
    expect(
      describeInvalidDurable({ ...envelope, sourceMessages: [{ ...(envelope.sourceMessages ?? [])[0], schemaVersion: 2 }] }),
    ).toMatch(/^sourceMessages\[0\]\./);
    expect(describeInvalidDurable({ ...envelope, profile: { userId: scope.userId } })).toMatch(/^profile\./);
    expect(describeInvalidDurable({ ...envelope, proposals: [{ ...envelope.proposals[0], status: "maybe" }] })).toMatch(
      /^proposals\[0\]\.status: /,
    );
    expect(describeInvalidDurable({ ...envelope, promotions: [{ ...envelope.promotions[0], evalOutcome: "ok" }] })).toMatch(
      /^promotions\[0\]\.evalOutcome: /,
    );
    expect(describeInvalidDurable({ ...envelope, experiences: [{ ...envelope.experiences[0], metrics: [] }] })).toMatch(
      /^experiences\[0\]\.metrics: /,
    );
    expect(describeInvalidDurable({ ...envelope, archives: [{ ...envelope.archives[0], sessionId: undefined }] })).toMatch(
      /^archives\[0\]\.sessionId: /,
    );
  });

  it("rejects non-objects, missing collections, and non-array collections", () => {
    expect(describeInvalidDurable(null)).toBe("durable must be an object");
    expect(describeInvalidDurable([])).toBe("durable must be an object");
    expect(describeInvalidDurable({})).toMatch(/^profile/);
    expect(describeInvalidDurable({ profile: null })).toBe("preferences must be an array");
    expect(
      describeInvalidDurable({
        archives: [],
        episodes: [],
        evidence: [],
        experiences: [],
        facts: {},
        feedback: [],
        preferences: [],
        profile: null,
        promotions: [],
        proposals: [],
        references: [],
      }),
    ).toBe("facts must be an array");
  });
});
