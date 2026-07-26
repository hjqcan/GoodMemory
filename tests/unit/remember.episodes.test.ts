import { describe, expect, it } from "bun:test";
import { createLanguageService } from "../../src/language";
import { maybeBuildEpisode } from "../../src/remember/episodes";
import { analyzeRememberSourceMessages } from "../../src/remember/languageAnalysis";

const TIMESTAMP = "2026-01-10T00:00:00.000Z";

describe("remember episodes", () => {
  it("skips episodic synthesis for pure assistant acknowledgement", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          { role: "user", content: "Remember that runtime rollout is blocked." },
          { role: "assistant", content: "Okay." },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "Runtime rollout is blocked.",
          sourceMessageIndex: 0,
          sourceRole: "user",
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode).toBeNull();
  });

  it("builds an episode when the assistant contributes substantive follow-through", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          { role: "user", content: "Remember that runtime rollout is blocked on legal signoff." },
          { role: "assistant", content: "I will keep that blocker and the next review step in mind." },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "Runtime rollout is blocked on legal signoff.",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            category: "project",
            factKind: "blocker",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode?.id).toBe("episode-1");
    expect(episode?.summary).toContain("Assistant follow-through");
    expect(episode?.keyDecisions[0]).toContain("Assistant follow-through on");
    expect(episode?.keyDecisions[0]).toContain("Runtime rollout is blocked on legal signoff.");
    expect(episode?.observedAt).toBeUndefined();
    expect(episode?.sourceMessageIds).toBeUndefined();
  });

  it("stamps event time and source-message span from the contributing messages", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          {
            content: "Earlier unrelated aside about the weather being nice.",
            id: "m-0",
            observedAt: "2026-01-04T08:00:00.000Z",
            role: "user",
          },
          {
            content:
              "Remember that runtime rollout is blocked on legal signoff.",
            id: "m-1",
            observedAt: "2026-01-05T09:30:00.000Z",
            role: "user",
          },
          {
            content:
              "I will keep that blocker and the next review step in mind.",
            id: "m-2",
            observedAt: "2026-01-05T09:31:00.000Z",
            role: "assistant",
          },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "Runtime rollout is blocked on legal signoff.",
          sourceMessageIndex: 1,
          sourceRole: "user",
          metadata: {
            category: "project",
            factKind: "blocker",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    // Event time is the earliest contributing message, not the transaction
    // clock and not the unrelated earlier message; the span points at the
    // contributing candidate and assistant messages.
    expect(episode?.observedAt).toBe("2026-01-05T09:30:00.000Z");
    expect(episode?.sourceMessageIds).toEqual(["m-1", "m-2"]);
  });

  it("does not persist paraphrased assistant follow-through that reintroduces redacted content", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          {
            role: "user",
            content: "Remember that the rollout is blocked on prod verification.",
          },
          {
            role: "assistant",
            content: "I will keep the prod verification blocker in mind for rollout.",
          },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "the rollout is blocked on [REDACTED].",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            category: "project",
            factKind: "blocker",
            subject: "prod verification",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode?.summary).not.toContain("prod verification");
    expect(episode?.keyDecisions.join("\n")).not.toContain("prod verification");
    expect(episode?.summary).toContain("Assistant follow-through captured.");
  });

  it("derives episode topics from redacted candidate content instead of raw metadata", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          {
            role: "user",
            content: "Remember that the rollout is blocked on prod verification.",
          },
          {
            role: "assistant",
            content: "I will keep the rollout blocker in mind.",
          },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "the rollout is blocked on [REDACTED].",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            category: "project",
            factKind: "blocker",
            subject: "prod verification",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode?.topics.join("\n")).not.toContain("prod verification");
    expect(episode?.topics).toContain(
      "the rollout is blocked on [REDACTED].",
    );
  });

  it("does not invent assistant follow-through when the assistant message is unrelated", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          {
            role: "user",
            content: "Remember that runtime rollout is blocked on legal signoff.",
          },
          {
            role: "assistant",
            content: "I also drafted the release note template for tomorrow's stakeholder review.",
          },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "Runtime rollout is blocked on legal signoff.",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            category: "project",
            factKind: "blocker",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode).toBeNull();
  });

  it("does not treat overlapping non-continuity commentary as assistant follow-through", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          {
            role: "user",
            content: "Remember that runtime rollout is blocked on legal signoff.",
          },
          {
            role: "assistant",
            content: "That rollout blocker sounds frustrating, and legal review seems slow.",
          },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "fact",
          explicitness: "explicit",
          content: "Runtime rollout is blocked on legal signoff.",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            category: "project",
            factKind: "blocker",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode).toBeNull();
  });

  it("does not bind one continuity reply to multiple same-kind candidates", () => {
    const episode = maybeBuildEpisode(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages: [
          {
            role: "user",
            content: "Use docs/runbook-a.md as the source of truth.",
          },
          {
            role: "user",
            content: "Use docs/runbook-b.md as the source of truth.",
          },
          {
            role: "assistant",
            content: "I will use the newer runbook going forward.",
          },
        ],
      },
      [
        {
          id: "candidate-1",
          kindHint: "reference",
          explicitness: "explicit",
          content: "docs/runbook-a.md",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: {
            referenceKind: "runbook",
            referencePointer: "docs/runbook-a.md",
          },
        },
        {
          id: "candidate-2",
          kindHint: "reference",
          explicitness: "explicit",
          content: "docs/runbook-b.md",
          sourceMessageIndex: 1,
          sourceRole: "user",
          metadata: {
            referenceKind: "runbook",
            referencePointer: "docs/runbook-b.md",
          },
        },
      ],
      "episode-1",
      TIMESTAMP,
      createLanguageService(),
      "en-US",
    );

    expect(episode?.summary).toContain("Assistant substantive continuity captured.");
    expect(episode?.keyDecisions).toHaveLength(0);
  });

  it("renders Traditional Chinese episode labels and topics through the resolved pack", () => {
    const language = createLanguageService();
    const input = {
      locale: "zh-TW",
      scope: { userId: "user-hant", sessionId: "session-hant" },
      messages: [
        { role: "user", content: "請記住目前專案阻塞是供應商審批。" },
        {
          role: "assistant",
          content: "我會繼續跟進目前專案阻塞和供應商審批。",
        },
      ],
    };
    const sourceAnalyses = analyzeRememberSourceMessages(input, language);

    const episode = maybeBuildEpisode(
      input,
      [
        {
          id: "candidate-hant",
          kindHint: "fact",
          explicitness: "explicit",
          content: "目前專案阻塞是供應商審批。",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: { category: "project", factKind: "blocker" },
        },
      ],
      "episode-hant",
      TIMESTAMP,
      language,
      "zh-TW",
      sourceAnalyses,
    );

    expect(episode?.summary).toBe(
      "本次會話涵蓋：目前專案阻塞是供應商審批。 / 已記錄助手的後續跟進。",
    );
    expect(episode?.keyDecisions).toEqual([
      "助手已跟進：目前專案阻塞是供應商審批。",
    ]);
    expect(episode?.topics).toEqual(["目前專案阻塞是供應商審批。"]);
  });

  it("renders Japanese episode labels and topics through the resolved pack", () => {
    const language = createLanguageService();
    const input = {
      locale: "ja-JP",
      scope: { userId: "user-ja", sessionId: "session-ja" },
      messages: [
        { role: "user", content: "現在のプロジェクトは承認待ちです。" },
        {
          role: "assistant",
          content: "今後も現在のプロジェクトの承認待ちを確認して対応します。",
        },
      ],
    };
    const sourceAnalyses = analyzeRememberSourceMessages(input, language);

    const episode = maybeBuildEpisode(
      input,
      [
        {
          id: "candidate-ja",
          kindHint: "fact",
          explicitness: "explicit",
          content: "現在のプロジェクトは承認待ちです。",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: { category: "project", factKind: "blocker" },
        },
      ],
      "episode-ja",
      TIMESTAMP,
      language,
      "ja-JP",
      sourceAnalyses,
    );

    expect(episode?.summary).toBe(
      "会話で扱った内容: 現在のプロジェクトは承認待ちです。 / アシスタントのフォローアップを記録しました。",
    );
    expect(episode?.keyDecisions).toEqual([
      "アシスタントのフォローアップ: 現在のプロジェクトは承認待ちです。",
    ]);
    expect(episode?.topics).toEqual(["現在のプロジェクトは承認待ちです。"]);
  });

  it("localizes substantive continuity when no unique follow-through target exists", () => {
    const language = createLanguageService();
    const input = {
      locale: "zh-TW",
      scope: { userId: "user-hant", sessionId: "session-hant" },
      messages: [
        { role: "user", content: "請使用 docs/runbook-a.md。" },
        { role: "user", content: "也請使用 docs/runbook-b.md。" },
        { role: "assistant", content: "我會繼續使用這份 runbook。" },
      ],
    };
    const sourceAnalyses = analyzeRememberSourceMessages(input, language);

    const episode = maybeBuildEpisode(
      input,
      [
        {
          id: "candidate-a",
          kindHint: "reference",
          explicitness: "explicit",
          content: "docs/runbook-a.md",
          sourceMessageIndex: 0,
          sourceRole: "user",
          metadata: { referenceKind: "runbook" },
        },
        {
          id: "candidate-b",
          kindHint: "reference",
          explicitness: "explicit",
          content: "docs/runbook-b.md",
          sourceMessageIndex: 1,
          sourceRole: "user",
          metadata: { referenceKind: "runbook" },
        },
      ],
      "episode-hant-continuity",
      TIMESTAMP,
      language,
      "zh-TW",
      sourceAnalyses,
    );

    expect(episode?.summary).toBe(
      "本次會話涵蓋：docs/runbook-a.md / docs/runbook-b.md / 已記錄助手提供的實質性延續。",
    );
    expect(episode?.keyDecisions).toEqual([]);
  });
});

// R5 increment 2b: opt-in deterministic multi-episode segmentation. A remember
// batch replaying several sittings (multi-session ingestion) splits at large
// observation-time gaps; each segment synthesizes its own episode with its own
// span pointers. Absent the option, behavior stays single-episode.
describe("remember episode segmentation", () => {
  const language = createLanguageService();
  const sitting = (
    dayHour: [string, string],
    topic: string,
  ): Array<{
    content: string;
    id?: string;
    observedAt?: string;
    role: "user" | "assistant";
  }> => [
    {
      role: "user",
      content: `Remember that ${topic}.`,
      id: `m-${dayHour[0]}-u`,
      observedAt: `${dayHour[0]}T${dayHour[1]}:00:00.000Z`,
    },
    {
      role: "assistant",
      content: `I will keep the plan for ${topic} and the next review step in mind.`,
      id: `m-${dayHour[0]}-a`,
      observedAt: `${dayHour[0]}T${dayHour[1]}:05:00.000Z`,
    },
  ];
  const candidateAt = (
    index: number,
    content: string,
  ): import("../../src/remember/candidates").MemoryCandidate => ({
    id: `candidate-${index}`,
    kindHint: "fact",
    explicitness: "explicit",
    content,
    sourceMessageIndex: index,
    sourceRole: "user",
    metadata: { category: "project", factKind: "blocker" },
  });

  it("splits a multi-sitting batch at large observation gaps", async () => {
    const { buildEpisodes } = await import("../../src/remember/episodes");
    const messages = [
      ...sitting(["2026-01-05", "09"], "the rollout is blocked on legal signoff"),
      ...sitting(["2026-01-12", "18"], "the audit report is due next Friday"),
    ];
    let idCounter = 0;
    const episodes = buildEpisodes(
      {
        scope: { userId: "user-1", sessionId: "s-1" },
        messages,
      },
      [
        candidateAt(0, "The rollout is blocked on legal signoff."),
        candidateAt(2, "The audit report is due next Friday."),
      ],
      () => `episode-${(idCounter += 1)}`,
      TIMESTAMP,
      language,
      "en-US",
      undefined,
      { segmentTimeGapMs: 6 * 60 * 60 * 1000 },
    );

    expect(episodes).toHaveLength(2);
    expect(episodes[0]?.summary).toContain("rollout is blocked");
    expect(episodes[1]?.summary).toContain("audit report is due");
    // Each segment anchors to its own sitting.
    expect(episodes[0]?.observedAt).toBe("2026-01-05T09:00:00.000Z");
    expect(episodes[1]?.observedAt).toBe("2026-01-12T18:00:00.000Z");
    expect(episodes[0]?.sourceMessageIds).toEqual(["m-2026-01-05-u", "m-2026-01-05-a"]);
    expect(episodes[1]?.sourceMessageIds).toEqual(["m-2026-01-12-u", "m-2026-01-12-a"]);
  });

  it("keeps single-episode behavior when segmentation is off or gaps are small", async () => {
    const { buildEpisodes } = await import("../../src/remember/episodes");
    const messages = [
      ...sitting(["2026-01-05", "09"], "the rollout is blocked on legal signoff"),
      ...sitting(["2026-01-05", "10"], "the audit report is due next Friday"),
    ];
    const candidates = [
      candidateAt(0, "The rollout is blocked on legal signoff."),
      candidateAt(2, "The audit report is due next Friday."),
    ];
    let idCounter = 0;
    const segmentedSmallGap = buildEpisodes(
      { scope: { userId: "user-1", sessionId: "s-1" }, messages },
      candidates,
      () => `episode-${(idCounter += 1)}`,
      TIMESTAMP,
      language,
      "en-US",
      undefined,
      { segmentTimeGapMs: 6 * 60 * 60 * 1000 },
    );
    // One hour apart: same sitting, one episode.
    expect(segmentedSmallGap).toHaveLength(1);

    const off = buildEpisodes(
      { scope: { userId: "user-1", sessionId: "s-1" }, messages },
      candidates,
      () => "episode-off",
      TIMESTAMP,
      language,
      "en-US",
    );
    expect(off).toHaveLength(1);
    expect(off[0]?.id).toBe("episode-off");
  });
});

describe("remember engine episode segmentation wiring", () => {
  it("writes one episode per sitting when remember.episodeSegmentTimeGapMs is set", async () => {
    const { createGoodMemory } = await import("../../src");
    const { createInMemoryDocumentStore, createInMemorySessionStore } =
      await import("../../src/storage/memory");
    const documentStore = createInMemoryDocumentStore();
    const candidates = [
      {
        id: "candidate-1",
        kindHint: "fact" as const,
        memoryType: "fact" as const,
        decision: "write" as const,
        score: 1,
        explicitness: "explicit" as const,
        content: "The rollout is blocked on legal signoff.",
        sourceMessageIndex: 0,
        sourceRole: "user" as const,
        metadata: {
          category: "project",
          factKind: "blocker" as const,
        },
      },
      {
        id: "candidate-2",
        kindHint: "fact" as const,
        memoryType: "fact" as const,
        decision: "write" as const,
        score: 1,
        explicitness: "explicit" as const,
        content: "The audit report is due next Friday.",
        sourceMessageIndex: 2,
        sourceRole: "user" as const,
        metadata: {
          category: "project",
          factKind: "blocker" as const,
        },
      },
    ];
    const memory = createGoodMemory({
      adapters: {
        documentStore,
        sessionStore: createInMemorySessionStore(),
      },
      remember: { episodeSegmentTimeGapMs: 6 * 60 * 60 * 1000 },
      testing: {
        extractor: {
          async extract() {
            return { candidates, ignoredMessageCount: 0 };
          },
        },
        now: () => new Date("2026-07-01T00:00:00.000Z"),
      },
    });

    await memory.remember({
      scope: { userId: "u-1", sessionId: "s-1" },
      messages: [
        {
          role: "user",
          content: "Remember that the rollout is blocked on legal signoff.",
          id: "m-1",
          observedAt: "2026-01-05T09:00:00.000Z",
        },
        {
          role: "assistant",
          content:
            "I will keep the plan for the rollout blocker and the next review step in mind.",
          id: "m-2",
          observedAt: "2026-01-05T09:05:00.000Z",
        },
        {
          role: "user",
          content: "Remember that the audit report is due next Friday.",
          id: "m-3",
          observedAt: "2026-01-12T18:00:00.000Z",
        },
        {
          role: "assistant",
          content:
            "I will keep the plan for the audit report deadline and the next review step in mind.",
          id: "m-4",
          observedAt: "2026-01-12T18:05:00.000Z",
        },
      ],
    });

    const episodes = await documentStore.query<{
      observedAt?: string;
      sourceMessageIds?: string[];
      summary: string;
    }>("episodes", {});
    expect(episodes).toHaveLength(2);
    const anchors = episodes.map((episode) => episode.observedAt).sort();
    expect(anchors).toEqual([
      "2026-01-05T09:00:00.000Z",
      "2026-01-12T18:00:00.000Z",
    ]);
  });
});
