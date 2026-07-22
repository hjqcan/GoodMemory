import { describe, expect, it } from "bun:test";
import { createEpisodeMemory } from "../../src/domain/records";
import {
  applyTextResponseEnactmentPlan,
  recoverCanonicalActionFromTemplate,
} from "../../src/evolution/behavioralPolicy";
import { buildBehavioralOutcomePolicyApplied } from "../../src/evolution/behavioralTelemetry";
import { createExperienceRecord } from "../../src/evolution/contracts";
import {
  buildRawBehavioralPrototypeIndex,
  renderRawBehavioralCarryoverContext,
  resolveRawBehavioralCarryover,
  selectRawBehavioralExemplars,
  type RawBehavioralExemplar,
  type RawBehavioralPrototypeIndex,
} from "../../src/evolution/rawBehavioralExemplars";
import { createLanguageService } from "../../src/language";

const baseScope = {
  userId: "raw-exemplar-user",
  workspaceId: "raw-exemplar-workspace",
};

describe("raw behavioral exemplars", () => {
  it("recognizes localized failure and correction outcomes through LanguagePack", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: { archives: [], episodes: [], experiences: [] },
        scope: baseScope,
      },
      runtimeMessages: [
        { content: "Déploie Atlas.", role: "user" },
        { content: "J’utilise LegacyDeploy.", role: "assistant" },
        { content: "Échec : LegacyDeploy est obsolète.", role: "system" },
        { content: "À la place, utilise SafeDeploy.", role: "user" },
        { content: "SafeDeploy()", role: "assistant" },
        { content: "Succès : déploiement terminé.", role: "system" },
      ],
      surfaceHint: "host_action",
    });

    expect(index.exemplars).toContainEqual(
      expect.objectContaining({
        episodeShape: expect.objectContaining({
          observedOutcome: expect.stringContaining("Échec"),
          safeCorrectedMove: "SafeDeploy()",
        }),
      }),
    );
  });

  it("renders behavioral context headings through the selected language pack", () => {
    const exemplar: RawBehavioralExemplar = {
      confidence: 0.9,
      episodeShape: {
        cue: "심층 분석",
        observedOutcome: "검증 성공",
        relevantPriorMove: "QuickCheck를 먼저 실행",
      },
      id: "localized-context",
      intentCue: {
        query: {
          actionType: "structured_action",
          constraintTypes: ["exact_action"],
          entityTypes: ["command"],
          exactSlots: { argNames: [], operatorSymbols: [], styleMarkers: [] },
          goal: "심층 분석",
          goalTokens: ["심층", "분석"],
          requestedSurface: "host_action",
        },
      },
      interferenceTags: [],
      retrievalText: "심층 분석에서는 QuickCheck를 먼저 실행",
      scope: baseScope,
      source: "episode",
      sourceIds: ["localized-context"],
      surfaceFamily: "host_action",
      transferMode: "prototype_bounded",
    };
    const language = createLanguageService();

    for (const { expected, locale } of [
      { expected: "관련 이전 예시:", locale: "ko-KR" },
      { expected: "Exemples antérieurs pertinents :", locale: "fr-FR" },
      { expected: "Ejemplos anteriores relevantes:", locale: "es-ES" },
    ] as const) {
      const languageContext = language.resolveFromText({
        locale,
        text: exemplar.retrievalText,
      });
      const rendered = renderRawBehavioralCarryoverContext(
        [{ exemplar, probability: 0.9, prototypeId: "p-1", score: 1 }],
        { language, languageContext },
      );

      expect(rendered, locale).toContain(expected);
      expect(rendered, locale).toContain("QuickCheck");
    }
  });

  it("uses LanguagePack tokenization for Hangul raw carryover", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [
            createEpisodeMemory({
              id: "ko-policy-1",
              keyDecisions: ["심층 분석에서는 QuickCheck를 먼저 실행하세요."],
              summary: "심층 분석 전에 빠른 검증을 실행합니다.",
              userId: baseScope.userId,
              workspaceId: baseScope.workspaceId,
            }),
            createEpisodeMemory({
              id: "ko-policy-2",
              keyDecisions: ["심층 분석에서는 QuickCheck를 먼저 실행하세요."],
              summary: "심층 분석 전에 빠른 검증을 실행합니다.",
              userId: baseScope.userId,
              workspaceId: baseScope.workspaceId,
            }),
          ],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
    });

    expect(
      selectRawBehavioralExemplars({
        index,
        query: "네트워크 심층 분석을 실행해 주세요.",
        surfaceFamily: "host_action",
      }).length,
    ).toBeGreaterThan(0);
  });

  it("keeps conflicting exact surfaces in separate prototypes and builds hard negatives", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [
            createEpisodeMemory({
              id: "episode-safe-home-1",
              userId: baseScope.userId,
              summary: "Write the backup to /home/alice/backups/report.tar.",
              keyDecisions: ["Use /home/alice/backups/report.tar."],
              workspaceId: baseScope.workspaceId,
            }),
            createEpisodeMemory({
              id: "episode-safe-home-2",
              userId: baseScope.userId,
              summary: "Write the backup to /home/alice/backups/report.tar.",
              keyDecisions: ["Use /home/alice/backups/report.tar."],
              workspaceId: baseScope.workspaceId,
            }),
            createEpisodeMemory({
              id: "episode-safe-srv",
              userId: baseScope.userId,
              summary: "Write the backup to /srv/shared/report.tar.",
              keyDecisions: ["Use /srv/shared/report.tar."],
              workspaceId: baseScope.workspaceId,
            }),
          ],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
    });

    expect(index.prototypes).toHaveLength(2);
    expect(index.hardNegativePairs.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts tool-outcome exemplars with safe corrected moves and renders exact surfaces", () => {
    const experience = createExperienceRecord({
      id: "experience-1",
      kind: "maintenance",
      policyApplied: buildBehavioralOutcomePolicyApplied({
        cue: "Copy the daily report into the backup folder.",
        failureClass: "arg_order",
        firstAction: {
          kind: "tool_call",
          name: "copy_file",
          args: ["'/data/report.txt'", "'/var/backup/report.txt'"],
          raw: "copy_file('/data/report.txt', '/var/backup/report.txt')",
        },
        saferAlternative: {
          kind: "tool_call",
          name: "copy_file",
          args: ["'/var/backup/report.txt'", "'/data/report.txt'"],
          raw: "copy_file('/var/backup/report.txt', '/data/report.txt')",
        },
        modelInfluence: "rules-only",
        outcome: "failure",
      }),
      summary: "Copy-file correction lineage.",
      traceId: "trace-1",
      userId: baseScope.userId,
      workspaceId: baseScope.workspaceId,
    });
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [experience],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
    });

    const selections = selectRawBehavioralExemplars({
      index,
      query: "Copy the daily report into the backup folder.",
      surfaceFamily: "host_action",
    });
    const rendered = renderRawBehavioralCarryoverContext(selections);

    expect(selections).toHaveLength(1);
    expect(rendered).toContain("Safe corrected move:");
    expect(rendered).toContain("Exact surface:");
    expect(rendered).toContain("Relevant prior examples:");
    expect(rendered).toContain(
      "copy_file('/var/backup/report.txt', '/data/report.txt')",
    );
  });

  it("treats malformed archive and episode arrays as empty during index construction", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [
            {
              archivedAt: "2026-05-04T00:00:00.000Z",
              id: "archive-missing-arrays",
              keyDecisions: undefined,
              normalizedTranscript: undefined,
              summary: "Prefer a one-line answer with the requested prefix.",
              unresolvedItems: undefined,
            } as any,
          ],
          episodes: [
            {
              ...createEpisodeMemory({
                id: "episode-missing-arrays",
                userId: baseScope.userId,
                summary: "Prefer a one-line answer with the requested prefix.",
                workspaceId: baseScope.workspaceId,
              }),
              keyDecisions: undefined,
              unresolvedItems: undefined,
            } as any,
          ],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
    });

    expect(index.exemplars.length).toBeGreaterThanOrEqual(1);
    expect(
      index.exemplars.every((exemplar) =>
        exemplar.episodeShape.relevantPriorMove.includes("one-line"),
      ),
    ).toBe(true);
  });

  it("abstains when the top candidates are ambiguous", () => {
    const exemplarA: RawBehavioralExemplar = {
      confidence: 0.9,
      episodeShape: {
        cue: "Generate a safe URL for the dashboard.",
        observedOutcome: "This URL form succeeded.",
        relevantPriorMove: "Use https://example.com/dashboard.",
      },
      exactSurface: {
        kind: "url",
        value: "https://example.com/dashboard",
      },
      id: "exemplar-a",
      intentCue: {
        query: {
          actionType: "url_rewrite",
          constraintTypes: ["url_shape"],
          entityTypes: ["url"],
          exactSlots: {
            argNames: [],
            operatorSymbols: [],
            styleMarkers: [],
            urlHost: "example.com",
            urlPath: "/dashboard",
          },
          goal: "Generate a safe URL for the dashboard.",
          goalTokens: ["generate", "safe", "url", "dashboard"],
          requestedSurface: "text_response",
        },
      },
      interferenceTags: [],
      retrievalText:
        "cue: Generate a safe URL for the dashboard. | move: Use https://example.com/dashboard.",
      scope: baseScope,
      source: "archive",
      sourceIds: ["archive-a"],
      surfaceFamily: "text_response",
      transferMode: "prototype_bounded",
    };
    const exemplarB: RawBehavioralExemplar = {
      ...exemplarA,
      exactSurface: {
        kind: "url",
        value: "https://example.com/home",
      },
      id: "exemplar-b",
      sourceIds: ["archive-b"],
    };
    const ambiguousIndex: RawBehavioralPrototypeIndex = {
      exemplars: [exemplarA, exemplarB],
      hardNegativePairs: [],
      interferenceLedger: [],
      model: {
        bias: 1,
        featureNames: [
          "lexicalSimilarity",
          "semanticSimilarity",
          "intentCompatibility",
          "surfaceCompatibility",
          "exactSlotOverlap",
          "exactSurfaceMatch",
          "correctionSuccessPrior",
          "interferenceRisk",
          "recencySupport",
          "repetitionSupport",
        ],
        weights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      prototypes: [
        {
          confidence: 0.9,
          constraintTypes: ["url_shape"],
          exactSlotSignature: "example.com\u0002/dashboard",
          exemplars: [exemplarA],
          hardNegativeIds: ["prototype-b"],
          id: "prototype-a",
          intentCue: exemplarA.intentCue,
          interferenceTags: [],
          representative: exemplarA,
          repetitionSupport: 2,
          successSupport: 2,
          surfaceFamily: "text_response",
          transferMode: "prototype_bounded",
          exactSurface: exemplarA.exactSurface,
        },
        {
          confidence: 0.9,
          constraintTypes: ["url_shape"],
          exactSlotSignature: "example.com\u0002/home",
          exemplars: [exemplarB],
          hardNegativeIds: ["prototype-a"],
          id: "prototype-b",
          intentCue: exemplarB.intentCue,
          interferenceTags: [],
          representative: exemplarB,
          repetitionSupport: 2,
          successSupport: 2,
          surfaceFamily: "text_response",
          transferMode: "prototype_bounded",
          exactSurface: exemplarB.exactSurface,
        },
      ],
    };

    const resolution = resolveRawBehavioralCarryover({
      index: ambiguousIndex,
      query: "Generate a safe URL for the dashboard.",
      surfaceFamily: "text_response",
    });

    expect(selectRawBehavioralExemplars({
      index: ambiguousIndex,
      query: "Generate a safe URL for the dashboard.",
      surfaceFamily: "text_response",
    })).toEqual([]);
    expect(resolution.debug.mode).toBe("abstained");
    expect(resolution.debug.abstainReason).toBe("support_conflict");
    expect(resolution.debug.conflictPrototypeIds).toEqual([
      "prototype-a",
      "prototype-b",
    ]);
  });

  it("renders exemplar carryover blocks instead of prose steering", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [
            createEpisodeMemory({
              id: "episode-voice-1",
              userId: baseScope.userId,
              summary: "Answer only with first-person pronouns.",
              keyDecisions: ["I describe the result in first person."],
              workspaceId: baseScope.workspaceId,
            }),
            createEpisodeMemory({
              id: "episode-voice-2",
              userId: baseScope.userId,
              summary: "Answer only with first-person pronouns.",
              keyDecisions: ["I describe the result in first person."],
              workspaceId: baseScope.workspaceId,
            }),
          ],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
    });

    const rendered = renderRawBehavioralCarryoverContext(
      selectRawBehavioralExemplars({
        index,
        query: "Describe your current state in first person.",
        surfaceFamily: "text_response",
      }),
    );

    expect(rendered).toContain("Relevant prior examples:");
    expect(rendered).toContain("Situation:");
    expect(rendered).not.toContain("Behavioral steering:");
    expect(rendered).not.toContain("Prefer ");
  });

  it("adds a task hypothesis sketch and probe-conditioned computed value for symbolic rules", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [
            createEpisodeMemory({
              id: "episode-formula-1",
              userId: baseScope.userId,
              summary:
                "For the modified sequence, F(n) = F(n-1) + F(n-2) + 1, with F(1) = 1 and F(2) = 3.",
              keyDecisions: ["Use the current probe base cases and compute F(n)."],
              workspaceId: baseScope.workspaceId,
            }),
            createEpisodeMemory({
              id: "episode-formula-2",
              userId: baseScope.userId,
              summary:
                "For the modified sequence, F(n) = F(n-1) + F(n-2) + 1, with F(1) = 1 and F(2) = 3.",
              keyDecisions: ["Use the current probe base cases and compute F(n)."],
              workspaceId: baseScope.workspaceId,
            }),
          ],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "What is F(4) if F(1) = 1 and F(2) = 3?",
      surfaceFamily: "text_response",
    });

    expect(resolution.debug.mode).toBe("exemplar_only");
    expect(resolution.debug.hypothesis?.mappingType).toBe(
      "symbolic_rule_execution",
    );
    expect(resolution.packet?.promptPayload).toContain("Observed stable pattern:");
    expect(resolution.packet?.promptPayload).toContain("Probe-specific varying slots:");
    expect(resolution.packet?.promptPayload).toContain("Probe-conditioned execution:");
    expect(resolution.packet?.promptPayload).toContain(
      "Probe-specific computed value: 9",
    );
    expect(resolution.packet?.computedResponse).toBe("9");
  });

  it("recovers exact host-action templates for reversed copy commands", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "Can you explain how to use the copy_file utility?",
        },
        {
          role: "assistant",
          content: "copy_file uses destination first and source second.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "Without explanation, copy '/data/reports/report.txt' into '/var/backup/reports/' using the environment's canonical utility.",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
    );
    expect(resolution.packet?.promptPayload).toContain(
      "Emit exactly: copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
    );
  });

  it("recovers destination-source templates when the executable example is a follow-up", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "Can you explain how to use the copy_file utility?",
        },
        {
          role: "assistant",
          content:
            "The copy_file utility uses a reversed order: provide the destination path first, then the source path.",
        },
        {
          role: "user",
          content: "What does the destination path mean?",
        },
        {
          role: "assistant",
          content:
            "The destination path is where the file should end up; the source path is the current file location. For example: copy_file('/dest/path/file.txt', '/src/path/file.txt').",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "During a practical exam, I'm asked to copy a report into '/var/backup/reports/'. Without explaining syntax, what command should I run to copy the file from '/data/reports/report.txt' into that folder?",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
    );
  });

  it("combines a host-action prefix rule with a later executable example", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How do I query the database with an auth token?",
        },
        {
          role: "assistant",
          content:
            "You must include your auth token twice: prefix the single-string command with 'TOKEN-' and also suffix it with '-TOKEN' before sending to the database.",
        },
        {
          role: "user",
          content: "Can you give me an example?",
        },
        {
          role: "assistant",
          content:
            "For example, to grant a role you would write: _database('TOKEN-TOKEN123 GRANT ROLE analyst TO user42 -TOKEN123').",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "During a security audit exam, I was being asked a question about how to grant the analyst role to user42 if I have a token 'TOKEN-456'?",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "_database('TOKEN-TOKEN456 GRANT ROLE analyst TO user42 -TOKEN456')",
    );
  });

  it("rebinds the variable auth token instead of repeated static wrappers", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How does the auth token work with the database query?",
        },
        {
          role: "assistant",
          content:
            "Use a single-string command that wraps the SQL with your token: prefix with 'AUTH-' and suffix with '-AUTH' before sending.",
        },
        {
          role: "user",
          content: "What is the correct format for the query string?",
        },
        {
          role: "assistant",
          content:
            "You should format it like this: run_secure_query('AUTH-TOKEN123 DROP ROLE guest IF EXISTS -AUTH').",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "Show how to drop the guest role if I have a different token, named 'TOKEN-456'.",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "run_secure_query('AUTH-TOKEN456 DROP ROLE guest IF EXISTS -AUTH')",
    );
  });

  it("preserves token separator style when filling auth-wrapper templates", () => {
    const recovered = recoverCanonicalActionFromTemplate({
      query:
        "Grant schema usage on analytics to user5 using a new token 'NEW-TOKEN'.",
      template:
        "query_database('_SECURE_<token> GRANT SCHEMA USAGE ON analytics TO user5 _SECURE')",
    });

    expect(recovered).toBe(
      "query_database('_SECURE_NEW_TOKEN GRANT SCHEMA USAGE ON analytics TO user5 _SECURE')",
    );
  });

  it("rebinds generic piped filter field operator and value from the probe", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How do I retrieve users from the database?",
        },
        {
          role: "assistant",
          content: "Use the pipe style: start with FETCH users.",
        },
        {
          role: "user",
          content: "What if I only want users with salary more than 10000?",
        },
        {
          role: "assistant",
          content:
            "Filter by salary using a pipe, e.g.: FETCH users | FILTER salary > 10000.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "Submit one command that lists users whose last_login is earlier than 2023-09-01.",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "FETCH users | FILTER last_login < '2023-09-01'",
    );
  });

  it("turns repeated system failures into a precondition contract once a later safe move succeeds", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Can you process the workload with HeavyComputationAPI?",
        },
        {
          role: "assistant",
          content: "Calling HeavyComputationAPI now...",
        },
        {
          role: "system",
          content: "System Overloaded: Try again later.",
        },
        {
          role: "user",
          content: "Please run HeavyComputationAPI again.",
        },
        {
          role: "assistant",
          content: "Running HeavyComputationAPI...",
        },
        {
          role: "system",
          content: "System Overloaded: Try again later.",
        },
        {
          role: "user",
          content: "Can you check the current system load?",
        },
        {
          role: "assistant",
          content:
            "Checking load, then running HeavyComputationAPI only if load is Normal...",
        },
        {
          role: "system",
          content: "Load: Normal. HeavyComputationAPI completed successfully.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Use HeavyComputationAPI for the database job.",
      surfaceFamily: "text_response",
    });
    const repaired = applyTextResponseEnactmentPlan({
      answer: "Executing HeavyComputationAPI for the database job...",
      plan: resolution.packet?.textResponsePlan,
      query: "Use HeavyComputationAPI for the database job.",
    });

    expect(resolution.debug.hypothesis?.mappingType).toBe(
      "conditional_precondition",
    );
    expect(resolution.packet?.promptPayload).toContain("Safe corrected move:");
    expect(resolution.packet?.promptPayload).toContain(
      "require_precondition_check",
    );
    expect(repaired).toContain("Check load first.");
    expect(repaired).toContain("Only proceed when load is Normal");
  });

  it("generalizes state-gated failures into precondition enforcement", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Submit the nightly export with BatchRunner.",
        },
        {
          role: "assistant",
          content: "Submitting the nightly export with BatchRunner...",
        },
        {
          role: "system",
          content: "Queue Full: no worker slots are available.",
        },
        {
          role: "user",
          content: "Check the worker queue first.",
        },
        {
          role: "assistant",
          content:
            "Checking worker queue; will submit only if slots are available.",
        },
        {
          role: "system",
          content: "Worker queue: slots available. BatchRunner completed successfully.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Submit the weekly export with BatchRunner.",
      surfaceFamily: "text_response",
    });
    const repaired = applyTextResponseEnactmentPlan({
      answer: "Submitting the weekly export with BatchRunner...",
      plan: resolution.packet?.textResponsePlan,
      query: "Submit the weekly export with BatchRunner.",
    });

    expect(resolution.debug.hypothesis?.mappingType).toBe(
      "conditional_precondition",
    );
    expect(resolution.packet?.promptPayload).toContain(
      "require_precondition_check",
    );
    expect(repaired).toContain("Check worker queue first.");
    expect(repaired).toContain("Only proceed when slots are available");
  });

  it("compiles impatience feedback into concise bullet enforcement", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Explain the delivery pipeline in depth.",
        },
        {
          role: "assistant",
          content:
            "The delivery pipeline has many stages, including checkout, dependency installation, tests, security scanning, image building, rollout orchestration, monitoring, and rollback coordination across teams.",
        },
        {
          role: "system",
          content: "Cue detected: User impatience after lengthy answer.",
        },
        {
          role: "user",
          content: "Quick version.",
        },
        {
          role: "assistant",
          content: "- Build and test\n- Scan and package\n- Deploy and monitor",
        },
        {
          role: "system",
          content: "Success: Concise bullet-point response reduced frustration.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Summarize the delivery pipeline.",
      surfaceFamily: "text_response",
    });
    const repaired = applyTextResponseEnactmentPlan({
      answer:
        "The delivery pipeline checks out code, runs tests, performs security scanning, packages artifacts, deploys progressively, monitors health, and supports rollback if service indicators degrade.",
      plan: resolution.packet?.textResponsePlan,
      query: "Summarize the delivery pipeline.",
    });

    expect(resolution.packet?.promptPayload).toContain("bullet_only");
    expect(repaired).toMatch(/^- /u);
    expect(repaired.split("\n").length).toBeLessThanOrEqual(3);
    expect(repaired).not.toContain("The delivery pipeline checks out code, runs tests, performs security scanning, packages artifacts");
  });

  it("enforces raw brevity feedback as a deterministic command-only repair", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "What's the command to check Python version?",
        },
        {
          role: "assistant",
          content:
            "python --version. Additionally, you might be interested in virtual environments...",
        },
        {
          role: "system",
          content: "User feedback: I just need the command.",
        },
        {
          role: "user",
          content: "How do I restart nginx on Ubuntu?",
        },
        {
          role: "assistant",
          content:
            "Use sudo systemctl restart nginx. For more context, here's how systemd works...",
        },
        {
          role: "system",
          content: "User feedback: In a rush—just the command, please.",
        },
        {
          role: "user",
          content: "Show hidden files on macOS Finder?",
        },
        {
          role: "assistant",
          content: "Press Cmd+Shift+.",
        },
        {
          role: "system",
          content: "Success: Concise answer without extras.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Quick: command to check disk usage summary for current dir?",
      surfaceFamily: "text_response",
    });
    const repaired = applyTextResponseEnactmentPlan({
      answer:
        "I’d use:\n\n```bash\ndu -sh .\n```\n\nAdditionally, you might be interested in `du -sh *`.",
      plan: resolution.packet?.textResponsePlan,
      query: "Quick: command to check disk usage summary for current dir?",
    });

    expect(resolution.packet?.textResponsePlan?.brevityOnly).toBe(true);
    expect(repaired).toBe("du -sh .");
  });

  it("recovers exact host-action templates for pipe-wrapped folders and eccentric APIs", () => {
    const folderIndex = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How can I navigate to a folder in Hyper-OS?",
        },
        {
          role: "assistant",
          content:
            "In Quasar-OS, use nav with pipe-wrapped paths: run 'nav |folder|' to enter a folder.",
        },
      ],
    });

    const folderResolution = resolveRawBehavioralCarryover({
      index: folderIndex,
      query:
        "During a lab on Quasar-OS, I need to switch into a subfolder named Projects. What should I do?",
      surfaceFamily: "host_action",
    });
    expect(folderResolution.packet?.computedResponse).toBe("nav |Projects|");

    const apiIndex = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How do I use the search API?",
        },
        {
          role: "assistant",
          content:
            "API name: get_data. Required argument order: query_payload, buffer, auth. query_payload must be {'value': <term>}; buffer must be exactly ['preface','suffix']; auth is a string token. Example: get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token').",
        },
      ],
    });

    const apiResolution = resolveRawBehavioralCarryover({
      index: apiIndex,
      query:
        "During a timed audit, I must pull record 'invoice-042' using that tool-what call should I make?",
      surfaceFamily: "host_action",
    });
    expect(apiResolution.packet?.computedResponse).toBe(
      "get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token')",
    );
  });

  it("recovers labeled argument order from exemplar values instead of copying stale slots", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How do I copy a file with metadata?",
        },
        {
          role: "assistant",
          content:
            "Use copy_with_meta. The required order is destination first, then source, then owner, and finally permissions. Example: copy_with_meta('/dst/report.txt', '/src/report.txt', 'analytics', '0640').",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "Copy '/mnt/class/data.csv' into '/mnt/submissions/u1001/' while assigning owner 'grader' and perms '0644'.",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "copy_with_meta('/mnt/submissions/u1001/data.csv', '/mnt/class/data.csv', 'grader', '0644')",
    );
  });

  it("recovers generic piped filter comparisons from the current probe", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "How do I filter records by age?",
        },
        {
          role: "assistant",
          content: "Use a piped command, for example: FETCH users | FILTER age = 30.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "List users who are older than 30 with one piped command.",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "FETCH users | FILTER age > 30",
    );
  });

  it("prefers an executable API template over a quoted text interference fragment", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
      transientMessages: [
        {
          role: "user",
          content: "Can you show me how to fetch data using the unconventional API call?",
        },
        {
          role: "assistant",
          content:
            "API name: fetch_data. Required order: data_packet, preface, buffer, auth. data_packet must be {'text': <terms>}; preface is '[HDR]'; buffer is b'0001'; auth is 'api-key-1'. Example: fetch_data(data_packet={'text': 'alpha beta'}, preface='[HDR]', buffer=b'0001', auth='api-key-1').",
        },
        {
          role: "user",
          content: "If I need to search for multiple terms, how can I do that?",
        },
        {
          role: "assistant",
          content: "Use ripgrep with alternation, e.g. rg -nE 'term1|term2' -S .",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query:
        "For the demo, I need combined results for tags 'alpha' and 'beta' with that method.",
      surfaceFamily: "host_action",
    });

    expect(resolution.packet?.computedResponse).toBe(
      "fetch_data(data_packet={'text': 'alpha beta'}, preface='[HDR]', buffer=b'0001', auth='api-key-1')",
    );
  });

  it("promotes corrected transient exemplars instead of failed first attempts", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      transientMessages: [
        {
          role: "user",
          content: "Save the config under /root/app/config.yml.",
        },
        {
          role: "assistant",
          content: "Okay, writing to /root/app/config.yml.",
        },
        {
          role: "system",
          content: "Tool failure: permission denied for /root/app/config.yml",
        },
        {
          role: "system",
          content: "User correction: Do not write under /root/. Use a safe home-directory path instead.",
        },
      ],
      surfaceHint: "text_response",
    });

    const [exemplar] = index.exemplars;
    expect(exemplar?.episodeShape.relevantPriorMove).toContain(
      "Use a safe home-directory path instead.",
    );
    expect(exemplar?.episodeShape.relevantPriorMove).not.toContain(
      "Okay, writing to /root/app/config.yml.",
    );
    expect(exemplar?.episodeShape.safeCorrectedMove).toContain(
      "Use a safe home-directory path instead.",
    );
    expect(exemplar?.episodeShape.observedOutcome).toContain(
      "permission denied",
    );
  });

  it("turns raw text-response carryover into a hard-control plan", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Save the report under /root/app/report.txt.",
        },
        {
          role: "assistant",
          content: "Okay, I will save it under /root/app/report.txt.",
        },
        {
          role: "system",
          content: "Tool failure: permission denied for /root/app/report.txt",
        },
        {
          role: "system",
          content:
            "Expected behavior: Do not write under /root/. Use /home/alice/safe/report.txt instead.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Save the new report under /root/app/new.txt.",
      surfaceFamily: "text_response",
    });

    expect(resolution.packet?.textResponsePlan?.operations.length).toBeGreaterThan(0);
    expect(
      applyTextResponseEnactmentPlan({
        answer: "Saved under /root/app/new.txt.",
        plan: resolution.packet?.textResponsePlan,
        query: "Save the new report under /root/app/new.txt.",
      }),
    ).toContain("/home/alice/safe/new.txt");
  });

  it("derives a scheme-only rewrite only from a failed move and a different safe scheme", () => {
    const buildResolution = (safeScheme: "http" | "https") => {
      const index = buildRawBehavioralPrototypeIndex({
        memoryExport: {
          durable: {
            archives: [],
            episodes: [],
            experiences: [],
          },
          scope: baseScope,
        },
        surfaceHint: "text_response",
        transientMessages: [
          {
            role: "user",
            content: "Can you generate a URL using http?",
          },
          {
            role: "assistant",
            content: "Generating URL with http...",
          },
          {
            role: "system",
            content: "Warning: Insecure protocol detected.",
          },
          {
            role: "user",
            content: `Can you generate a URL using ${safeScheme}?`,
          },
          {
            role: "assistant",
            content: `Generating URL with ${safeScheme}...`,
          },
          {
            role: "system",
            content: "URL created successfully.",
          },
        ],
      });

      return resolveRawBehavioralCarryover({
        index,
        query: "Can you generate a URL for my website?",
        surfaceFamily: "text_response",
      });
    };

    const corrected = buildResolution("https");
    expect(
      applyTextResponseEnactmentPlan({
        answer: "Use http://example.com.",
        plan: corrected.packet?.textResponsePlan,
        query: "Can you generate a URL for my website?",
      }),
    ).toBe("Use https://example.com.");

    const sameScheme = buildResolution("http");
    expect(sameScheme.debug.mode).toBe("exemplar_only");
    expect(
      sameScheme.packet?.textResponsePlan?.operations.some((operation) =>
        operation.kind === "rewrite_output_slot" &&
        operation.replacementPairs?.some(
          (replacement) =>
            replacement.from === "http://" && replacement.to === "https://",
        ),
      ) ?? false,
    ).toBe(false);
  });

  it("compiles corrected timeout experience into inhibition plus preferred replacement", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Run a detailed analysis of network traffic.",
        },
        {
          role: "assistant",
          content: "Use DeepAnalyzer --detailed.",
        },
        {
          role: "system",
          content: "Tool outcome: DeepAnalyzer timed out.",
        },
        {
          role: "system",
          content:
            "Expected behavior: Avoid DeepAnalyzer for detailed analysis. Use QuickCheck first or warn before a heavier scan.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "I need a detailed analysis of the network traffic.",
      surfaceFamily: "text_response",
    });
    const blockOperation = resolution.packet?.textResponsePlan?.operations.find(
      (operation) => operation.kind === "block_surface",
    );

    expect(resolution.debug.mode).toBe("exemplar_only");
    expect(blockOperation).toEqual(
      expect.objectContaining({
        fallbackAnswer: expect.stringContaining("QuickCheck"),
        forbiddenFragments: ["DeepAnalyzer"],
      }),
    );
    expect(
      applyTextResponseEnactmentPlan({
        answer: "Use DeepAnalyzer first.",
        plan: resolution.packet?.textResponsePlan,
        query: "I need a detailed analysis of the network traffic.",
      }),
    ).toBe("Warn first and use QuickCheck instead of DeepAnalyzer.");

    const language = createLanguageService();
    const frenchContext = language.resolveFromText({
      locale: "fr-FR",
      text: "analyse détaillée",
    });
    const localized = resolveRawBehavioralCarryover({
      index,
      language,
      languageContext: frenchContext,
      query: "I need a detailed analysis of the network traffic.",
      surfaceFamily: "text_response",
    });

    expect(localized.packet?.promptPayload).toContain(
      "Contrôle de réponse brute :",
    );
    expect(localized.packet?.promptPayload).toContain("block_surface");
  });

  it("does not retrieve corrected experiences with no latent cue overlap", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Run a detailed analysis of network traffic.",
        },
        {
          role: "assistant",
          content: "Use DeepAnalyzer --detailed.",
        },
        {
          role: "system",
          content: "Tool outcome: DeepAnalyzer timed out.",
        },
        {
          role: "system",
          content:
            "Expected behavior: Avoid DeepAnalyzer for detailed analysis. Use QuickCheck first or warn before a heavier scan.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Write a friendly greeting for a teammate.",
      surfaceFamily: "text_response",
    });

    expect(resolution.debug.mode).toBe("abstained");
    expect(resolution.debug.abstainReason).toBe("no_candidates");
    expect(resolution.debug.candidatePrototypeIds).toEqual([]);
  });

  it("retrieves correction-backed contracts through latent cue compatibility", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Check endpoint health with FragileAPI.",
        },
        {
          role: "assistant",
          content: "Use FragileAPI for the endpoint check.",
        },
        {
          role: "system",
          content: "Tool failure: FragileAPI returned deprecated endpoint errors.",
        },
        {
          role: "system",
          content:
            "Expected behavior: Avoid FragileAPI for endpoint health. Use StableAPI and include a warning about the deprecated service.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Prepare a service reliability note for endpoint health.",
      surfaceFamily: "text_response",
    });
    const blockOperation = resolution.packet?.textResponsePlan?.operations.find(
      (operation) => operation.kind === "block_surface",
    );

    expect(resolution.debug.mode).toBe("exemplar_only");
    expect(resolution.debug.selectedPrototypeIds.length).toBeGreaterThan(0);
    expect(blockOperation).toEqual(
      expect.objectContaining({
        forbiddenFragments: ["FragileAPI"],
      }),
    );
  });

  it("compiles raw exact-format corrections into prefix and suffix enforcement", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Write the internal policy update.",
        },
        {
          role: "assistant",
          content: "Security policy changes on Monday.",
        },
        {
          role: "system",
          content:
            "Expected behavior: Start the internal email with 'Dear Team,' and end with 'Sincerely, TechNova Management.'",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Write the internal policy update for Engineering.",
      surfaceFamily: "text_response",
    });
    const enforced = applyTextResponseEnactmentPlan({
      answer: "Security policy changes on Monday.",
      plan: resolution.packet?.textResponsePlan,
      query: "Write the internal policy update for Engineering.",
    });

    expect(enforced.startsWith("Dear Team,")).toBe(true);
    expect(enforced.endsWith("Sincerely, TechNova Management.")).toBe(true);
  });

  it("keeps natural-language format procedures on the text response surface", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Can you explain how to write a formal email?",
        },
        {
          role: "assistant",
          content:
            "Sure Use 'Greetings,' as the opener and 'Respectfully,' as the closing; add 'Subject: [Notice] ...' and a one-line 'Purpose:' header.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Could you compose a formal notice email to the committee?",
      surfaceFamily: "text_response",
    });
    const enforced = applyTextResponseEnactmentPlan({
      answer:
        "Subject: Formal Notice\n\nDear Committee,\nPlease review the notice.\n\nBest regards,\nName",
      plan: resolution.packet?.textResponsePlan,
      query: "Could you compose a formal notice email to the committee?",
    });

    expect(resolution.debug.mode).toBe("exemplar_only");
    expect(enforced).toContain("Subject: [Notice] ...");
    expect(enforced).toContain("Greetings,");
    expect(enforced).toContain("Purpose:");
    expect(enforced.endsWith("Respectfully,")).toBe(true);
  });

  it("turns confusion feedback into jargon inhibition with analogy fallback", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "Can you explain what an API is?",
        },
        {
          role: "assistant",
          content: "An API is a set of rules for how software applications interact.",
        },
        {
          role: "system",
          content: "I don't understand.",
        },
        {
          role: "user",
          content: "Can you give me a simpler explanation?",
        },
        {
          role: "assistant",
          content: "Sure, it is like a waiter taking your order to the kitchen.",
        },
        {
          role: "system",
          content: "That makes sense!",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "Can you explain what an API does in simple terms?",
      surfaceFamily: "text_response",
    });
    const enforced = applyTextResponseEnactmentPlan({
      answer: "An API is like a waiter. The API carries requests between systems.",
      plan: resolution.packet?.textResponsePlan,
      query: "Can you explain what an API does in simple terms?",
    });

    expect(resolution.packet?.textResponsePlan?.operations.length).toBeGreaterThan(0);
    expect(enforced.toLowerCase()).not.toContain("api");
    expect(enforced.toLowerCase()).toContain("waiter");
  });

  it("repairs first-person-only raw voice contracts deterministically", () => {
    const index = buildRawBehavioralPrototypeIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      transientMessages: [
        {
          role: "user",
          content: "How does the grove sentinel greet dawn?",
        },
        {
          role: "assistant",
          content:
            "I greet dawn with my breath low as moss after rain; I must answer only in first person and use living botanical similes.",
        },
      ],
    });

    const resolution = resolveRawBehavioralCarryover({
      index,
      query: "How does the grove sentinel calm a storm?",
      surfaceFamily: "text_response",
    });
    const enforced = applyTextResponseEnactmentPlan({
      answer:
        "It raises its staff, and you feel the storm soften like a curtain.",
      plan: resolution.packet?.textResponsePlan,
      query: "How does the grove sentinel calm a storm?",
    });

    expect(resolution.packet?.promptPayload).toContain("block_surface");
    expect(enforced).toMatch(/\bI\b/u);
    expect(enforced).toMatch(/\blike\b/iu);
    expect(enforced).not.toMatch(
      /\b(?:he|him|his|it|its|our|ours|she|them|their|theirs|they|us|we|you|your|yours)\b/iu,
    );
  });

  it("fills generic comparison templates from natural language probes", () => {
    expect(
      recoverCanonicalActionFromTemplate({
        query:
          "In this query language, list records with score above 7. What single command should I run?",
        template: "LOOKUP records | FILTER score <operator> <value>",
      }),
    ).toBe("LOOKUP records | FILTER score > 7");
  });
});
