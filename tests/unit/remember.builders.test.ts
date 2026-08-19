import { describe, expect, it } from "bun:test";
import {
  createFactMemory,
  createReferenceMemory,
} from "../../src/domain/records";
import {
  buildFact,
  enrichDuplicateFact,
  resolveReferenceSubject,
} from "../../src/remember/builders";
import type { ClassifiedCandidate } from "../../src/remember/contracts";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";

describe("remember builders", () => {
  it("carries the structured predicate into fact selection metadata", () => {
    const candidate: ClassifiedCandidate = {
      id: "candidate-claim",
      kindHint: "fact",
      explicitness: "explicit",
      content: "Marco lives in Lisbon.",
      sourceMessageIndex: 0,
      sourceRole: "user",
      decision: "write",
      memoryType: "fact",
      score: 1,
      metadata: {
        category: "personal",
        subject: "Marco",
        claim: {
          predicateKey: "person.residence",
          objectText: "Lisbon",
          polarity: "positive",
          modality: "asserted",
        },
      },
    };

    const fact = buildFact(
      { userId: "user-1" },
      candidate,
      "fact-claim",
      TIMESTAMP,
      "en",
      "2026-01-01T00:00:00.000Z",
    );

    expect(fact.attributes?.claimKey).toBe("person.residence");
  });

  it("inherits a corrected reference subject from the superseded pointer", () => {
    const candidate: ClassifiedCandidate = {
      id: "candidate-1",
      kindHint: "reference",
      explicitness: "explicit",
      content: "docs/runtime-runbook-v2.md",
      sourceMessageIndex: 0,
      sourceRole: "user",
      decision: "write",
      memoryType: "reference",
      score: 0.9,
      metadata: {
        supersedesPointer: "docs/runtime-runbook-v1.md",
      },
    };

    const subject = resolveReferenceSubject(candidate, [
      createReferenceMemory({
        id: "ref-old",
        userId: "user-1",
        title: "Runtime Runbook",
        pointer: "docs/runtime-runbook-v1.md",
        subject: "runtime rollout",
        source: {
          method: "explicit",
          extractedAt: TIMESTAMP,
        },
        lifecycle: "active",
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      }),
    ]);

    expect(subject).toBe("runtime rollout");
  });

  it("enriches duplicate facts with stronger metadata and provenance", () => {
    const enriched = enrichDuplicateFact(
      createFactMemory({
        id: "fact-1",
        userId: "user-1",
        category: "project",
        content: "Runtime rollout still needs legal signoff.",
        source: {
          method: "inferred",
          extractedAt: TIMESTAMP,
          locale: "zh-TW",
          localeSource: "explicit",
          languagePackId: "zh-Hant",
          languagePackVersion: "2-opencc-1.4.1",
        },
        subject: "unknown",
        updatedAt: TIMESTAMP,
      }),
      {
        id: "candidate-1",
        kindHint: "fact",
        explicitness: "explicit",
        content: "Runtime rollout still needs legal signoff.",
        sourceMessageIndex: 0,
        sourceRole: "user",
        decision: "write",
        memoryType: "fact",
        score: 0.92,
        metadata: {
          category: "technical",
          factKind: "open_loop",
          scopeKind: "project",
          subject: "runtime rollout",
          claim: {
            predicateKey: "project.blocker",
            objectText: "legal signoff",
            polarity: "positive",
            modality: "asserted",
          },
        },
      },
      TIMESTAMP,
      {
        locale: "zh-CN",
        localeSource: "explicit",
        languagePackId: "zh-Hans",
        languagePackVersion: "2-opencc-1.4.1",
      },
    );

    expect(enriched?.category).toBe("technical");
    expect(enriched?.factKind).toBe("open_loop");
    expect(enriched?.subject).toBe("runtime rollout");
    expect(enriched?.attributes?.claimKey).toBe("project.blocker");
    expect(enriched?.source.method).toBe("explicit");
    expect(enriched?.source).toMatchObject({
      locale: "zh-TW",
      localeSource: "explicit",
      languagePackId: "zh-Hant",
      languagePackVersion: "2-opencc-1.4.1",
    });
  });
});
