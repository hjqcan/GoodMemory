import { describe, expect, it } from "bun:test";
import {
  applyTextResponseEnactmentPlan,
  recoverCanonicalActionFromTemplate,
} from "../../src/evolution/behavioralPolicy";
import { buildBehavioralOutcomeExperienceRecord } from "../../src/evolution/behavioralTelemetry";
import { createExperienceRecord } from "../../src/evolution/contracts";
import {
  buildRawBehavioralPrototypeIndex as buildCanonicalRawBehavioralPrototypeIndex,
  renderRawBehavioralCarryoverContext,
  resolveRawBehavioralCarryover,
  selectRawBehavioralExemplars,
  type BuildRawBehavioralPrototypeIndexInput,
  type RawBehavioralExemplar,
  type RawBehavioralPrototypeIndex,
  type RawBehavioralSurfaceFamily,
} from "../../src/evolution/rawBehavioralExemplars";
import { createLanguageService } from "../../src/language";

const baseScope = {
  userId: "raw-exemplar-user",
  workspaceId: "raw-exemplar-workspace",
};

type ScenarioMessage = { content: string; role: string };

function buildScenarioExperience(input: {
  cue: string;
  failedMove?: string;
  failureClass?: string;
  id: string;
  saferMove: string;
  surfaceHint: RawBehavioralSurfaceFamily;
}) {
  return buildBehavioralOutcomeExperienceRecord({
    createdAt: "2026-05-04T00:00:00.000Z",
    createId: () => input.id,
    result: {
      cue: input.cue,
      failureClass: input.failureClass ?? "prior_move_failed",
      firstAction: {
        kind: "warning",
        name: "failed_prior_move",
        raw: input.failedMove ?? "The earlier first move failed.",
      },
      modelInfluence: "rules-only",
      retrievalProfile: input.surfaceHint === "host_action"
        ? "coding_agent"
        : "general_chat",
      saferAlternative: {
        kind: "warning",
        name: "safer_alternative",
        raw: input.saferMove,
      },
    },
    scope: baseScope,
    traceId: `trace-${input.id}`,
  });
}

function scenarioExperiences(
  messages: readonly ScenarioMessage[],
  surfaceHint: RawBehavioralSurfaceFamily,
) {
  const language = createLanguageService();
  const analyze = (content: string) => {
    const context = language.resolveFromText({ text: content });
    return language.analyzeContent(content, context);
  };
  const systemFailure = (content: string | undefined) => {
    if (!content) {
      return undefined;
    }
    const analysis = analyze(content);
    return analysis.factPolarity === "negative" || analysis.unresolved
      ? content.trim()
      : undefined;
  };
  const correctionText = (content: string | undefined) => {
    if (!content || !analyze(content).correctionCue) {
      return undefined;
    }
    return content.match(/^[^:：]+[:：]\s*(.+)$/u)?.[1]?.trim() ?? content.trim();
  };
  const experiences: ReturnType<typeof buildScenarioExperience>[] = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];
    if (current?.role !== "user" || next?.role !== "assistant") {
      continue;
    }

    const third = messages[index + 2];
    const fourth = messages[index + 3];
    const failure = third?.role === "system"
      ? systemFailure(third.content)
      : undefined;
    let saferMove =
      (third?.role === "system" ? correctionText(third.content) : undefined) ??
      (fourth?.role === "system" ? correctionText(fourth.content) : undefined);
    if (failure || saferMove) {
      for (let cursor = index + 3; cursor < Math.min(messages.length - 1, index + 16); cursor += 1) {
        const correction = messages[cursor];
        const corrected = messages[cursor + 1];
        const after = messages[cursor + 2];
        if (
          correction?.role === "user" &&
          corrected?.role === "assistant" &&
          (analyze(correction.content).correctionCue ||
            (after?.role === "system" && !systemFailure(after.content)))
        ) {
          saferMove = corrected.content;
          break;
        }
      }
    }
    if (failure && !saferMove) {
      continue;
    }

    experiences.push(buildScenarioExperience({
      cue: current.content,
      failedMove: next.content,
      failureClass: failure,
      id: `scenario-${index}`,
      saferMove: saferMove ?? next.content,
      surfaceHint,
    }));
  }
  return experiences;
}

function buildScenarioIndex(input: {
  memoryExport: {
    durable: {
      archives?: readonly unknown[];
      episodes?: readonly unknown[];
      experiences: BuildRawBehavioralPrototypeIndexInput["memoryExport"]["durable"]["experiences"];
    };
    scope: BuildRawBehavioralPrototypeIndexInput["memoryExport"]["scope"];
  };
  recallHints?: BuildRawBehavioralPrototypeIndexInput["recallHints"];
  retrievalProfile?: BuildRawBehavioralPrototypeIndexInput["retrievalProfile"];
  scenarioMessages?: readonly ScenarioMessage[];
  surfaceHint?: RawBehavioralSurfaceFamily;
}) {
  const surfaceHint = input.surfaceHint ?? "text_response";
  return buildCanonicalRawBehavioralPrototypeIndex({
    memoryExport: {
      durable: {
        experiences: [
          ...input.memoryExport.durable.experiences,
          ...scenarioExperiences(input.scenarioMessages ?? [], surfaceHint),
        ],
      },
      scope: input.memoryExport.scope,
    },
    recallHints: input.recallHints,
    retrievalProfile: input.retrievalProfile ??
      (input.scenarioMessages
        ? surfaceHint === "host_action" ? "coding_agent" : "general_chat"
        : undefined),
    surfaceHint,
  });
}

describe("raw behavioral exemplars", () => {
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
      source: "tool_outcome",
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [
            buildScenarioExperience({
              cue: "심층 분석 전에 빠른 검증을 실행합니다.",
              id: "ko-policy-1",
              saferMove: "심층 분석에서는 QuickCheck를 먼저 실행하세요.",
              surfaceHint: "host_action",
            }),
            buildScenarioExperience({
              cue: "심층 분석 전에 빠른 검증을 실행합니다.",
              id: "ko-policy-2",
              saferMove: "심층 분석에서는 QuickCheck를 먼저 실행하세요.",
              surfaceHint: "host_action",
            }),
          ],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [
            buildScenarioExperience({
              cue: "Write the backup to /home/alice/backups/report.tar.",
              id: "safe-home-1",
              saferMove: "Use /home/alice/backups/report.tar.",
              surfaceHint: "text_response",
            }),
            buildScenarioExperience({
              cue: "Write the backup to /home/alice/backups/report.tar.",
              id: "safe-home-2",
              saferMove: "Use /home/alice/backups/report.tar.",
              surfaceHint: "text_response",
            }),
            buildScenarioExperience({
              cue: "Write the backup to /srv/shared/report.tar.",
              id: "safe-srv",
              saferMove: "Use /srv/shared/report.tar.",
              surfaceHint: "text_response",
            }),
          ],
        },
        scope: baseScope,
      },
      retrievalProfile: "general_chat",
      surfaceHint: "text_response",
    });

    expect(index.prototypes).toHaveLength(2);
    expect(index.hardNegativePairs.length).toBeGreaterThanOrEqual(1);
  });

  it("extracts tool-outcome exemplars with safe corrected moves and renders exact surfaces", () => {
    const experience = buildBehavioralOutcomeExperienceRecord({
      createdAt: "2026-05-04T00:00:00.000Z",
      createId: () => "experience-1",
      result: {
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
        retrievalProfile: "coding_agent",
      },
      scope: baseScope,
      traceId: "trace-1",
    });
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [experience],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
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

  it("requires an explicit matching retrieval profile for tool-outcome exemplars", () => {
    const buildExperience = (
      id: string,
      retrievalProfile?: "coding_agent" | "general_chat",
    ) => buildBehavioralOutcomeExperienceRecord({
      createdAt: "2026-05-04T00:00:00.000Z",
      createId: () => id,
      result: {
        cue: "Copy the daily report into the backup folder.",
        failureClass: "arg_order",
        firstAction: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(old)",
        },
        modelInfluence: "rules-only",
        retrievalProfile,
        saferAlternative: {
          kind: "tool_call",
          name: "copy_file",
          raw: "copy_file(safe)",
        },
      },
      scope: baseScope,
      traceId: `trace-${id}`,
    });

    const noProfile = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [buildExperience("no-profile")],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
      surfaceHint: "host_action",
    });
    const wrongProfile = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [buildExperience("general-chat", "general_chat")],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
      surfaceHint: "host_action",
    });
    const wrongReverseProfile = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [buildExperience("coding-for-general", "coding_agent")],
        },
        scope: baseScope,
      },
      retrievalProfile: "general_chat",
      surfaceHint: "text_response",
    });
    const matchingProfile = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [buildExperience("coding-agent", "coding_agent")],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
      surfaceHint: "host_action",
    });
    const missingCurrentProfile = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [buildExperience("missing-current", "coding_agent")],
        },
        scope: baseScope,
      },
      surfaceHint: "host_action",
    });
    const missingSaferAlternative = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [buildBehavioralOutcomeExperienceRecord({
            createdAt: "2026-05-04T00:00:00.000Z",
            createId: () => "missing-safer",
            result: {
              cue: "Copy the daily report into the backup folder.",
              failureClass: "arg_order",
              firstAction: { kind: "tool_call", name: "copy_file" },
              modelInfluence: "rules-only",
              retrievalProfile: "coding_agent",
            },
            scope: baseScope,
            traceId: "trace-missing-safer",
          })],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
      surfaceHint: "host_action",
    });
    const legacyTagged = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [createExperienceRecord({
            id: "legacy-tagged",
            kind: "tool_outcome",
            policyApplied: [
              "tool_outcome",
              "tool_outcome.cue=Copy%20the%20daily%20report",
              "tool_outcome.failure_class=arg_order",
              "tool_outcome.first_action.kind=tool_call",
              "tool_outcome.first_action.name=copy_file",
              "tool_outcome.retrieval_profile=coding_agent",
              "tool_outcome.safer_alternative.kind=tool_call",
              "tool_outcome.safer_alternative.name=copy_file_safely",
            ],
            summary: "Legacy policy-tagged tool outcome",
            traceId: "trace-legacy-tagged",
            userId: baseScope.userId,
            workspaceId: baseScope.workspaceId,
          })],
        },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
      surfaceHint: "host_action",
    });

    expect(noProfile.exemplars).toEqual([]);
    expect(wrongProfile.exemplars).toEqual([]);
    expect(wrongReverseProfile.exemplars).toEqual([]);
    expect(missingCurrentProfile.exemplars).toEqual([]);
    expect(missingSaferAlternative.exemplars).toEqual([]);
    expect(legacyTagged.exemplars).toEqual([]);
    expect(matchingProfile.exemplars).toHaveLength(1);
    expect(matchingProfile.exemplars[0]?.sourceIds).toEqual(["coding-agent"]);
  });

  it("does not derive raw exemplars from ordinary operation experiences", () => {
    const experiences = Array.from({ length: 30 }, (_, index) => {
      const kind = index % 2 === 0 ? "remember" : "recall";
      return createExperienceRecord({
        id: `ordinary-${kind}-${index}`,
        kind,
        policyApplied: [],
        summary: `${kind} operation record`,
        traceId: `trace-${kind}-${index}`,
        userId: baseScope.userId,
        workspaceId: baseScope.workspaceId,
      });
    });
    const index = buildScenarioIndex({
      memoryExport: {
        durable: { archives: [], episodes: [], experiences },
        scope: baseScope,
      },
      retrievalProfile: "coding_agent",
      surfaceHint: "host_action",
    });

    expect(index.exemplars).toEqual([]);
  });

  it("does not admit archive or episode content into the typed outcome index", () => {
    const index = buildScenarioIndex({
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
              id: "episode-legacy",
              summary: "Prefer a one-line answer with the requested prefix.",
              keyDecisions: undefined,
              unresolvedItems: undefined,
            } as any,
          ],
          experiences: [],
        },
        scope: baseScope,
      },
      retrievalProfile: "general_chat",
      surfaceHint: "text_response",
    });

    expect(index.exemplars).toEqual([]);
  });

  it("abstains when the top candidates are ambiguous", () => {
    const exemplarA: RawBehavioralExemplar = {
      confidence: 0.9,
      episodeShape: {
        cue: "Generate a safe URL for the dashboard.",
        observedOutcome: "The http URL failed.",
        relevantPriorMove: "Use https://example.com/dashboard instead.",
        safeCorrectedMove: "Use https://example.com/dashboard instead.",
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
      source: "tool_outcome",
      sourceIds: ["experience-a"],
      surfaceFamily: "text_response",
      transferMode: "prototype_bounded",
    };
    const exemplarB: RawBehavioralExemplar = {
      ...exemplarA,
      episodeShape: {
        cue: "Generate a safe URL for the dashboard.",
        observedOutcome: "The prior URL failed.",
        relevantPriorMove: "Use the dashboard homepage.",
        safeCorrectedMove: "Use the dashboard homepage.",
      },
      exactSurface: {
        kind: "url",
        value: "https://example.com/home",
      },
      id: "exemplar-b",
      sourceIds: ["experience-b"],
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
    expect(resolution.packet?.sourceExperienceIds).toEqual(["experience-a"]);
  });

  it("renders exemplar carryover blocks instead of prose steering", () => {
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [
            buildScenarioExperience({
              cue: "Answer only with first-person pronouns.",
              id: "voice-1",
              saferMove: "I describe the result in first person.",
              surfaceHint: "text_response",
            }),
            buildScenarioExperience({
              cue: "Answer only with first-person pronouns.",
              id: "voice-2",
              saferMove: "I describe the result in first person.",
              surfaceHint: "text_response",
            }),
          ],
        },
        scope: baseScope,
      },
      retrievalProfile: "general_chat",
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [
            buildScenarioExperience({
              cue: "For the modified sequence, F(n) = F(n-1) + F(n-2) + 1, with F(1) = 1 and F(2) = 3.",
              id: "formula-1",
              saferMove: "Use the current probe base cases and compute F(n).",
              surfaceHint: "text_response",
            }),
            buildScenarioExperience({
              cue: "For the modified sequence, F(n) = F(n-1) + F(n-2) + 1, with F(1) = 1 and F(2) = 3.",
              id: "formula-2",
              saferMove: "Use the current probe base cases and compute F(n).",
              surfaceHint: "text_response",
            }),
          ],
        },
        scope: baseScope,
      },
      retrievalProfile: "general_chat",
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

  it("turns repeated system failures into a precondition contract once a later safe move succeeds", () => {
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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

  it("turns raw text-response carryover into a hard-control plan", () => {
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
      const index = buildScenarioIndex({
        memoryExport: {
          durable: {
            archives: [],
            episodes: [],
            experiences: [],
          },
          scope: baseScope,
        },
        surfaceHint: "text_response",
        scenarioMessages: [
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
    const index = buildScenarioIndex({
      memoryExport: {
        durable: {
          archives: [],
          episodes: [],
          experiences: [],
        },
        scope: baseScope,
      },
      surfaceHint: "text_response",
      scenarioMessages: [
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
