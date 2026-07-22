import { describe, expect, it } from "bun:test";
import { createFeedbackMemory } from "../../src/domain/records";
import { createMemorySource } from "../../src/domain/provenance";
import type { TextResponseEnactmentPlan } from "../../src/evolution/behavioralPolicy";
import {
  applyTextResponseEnactmentPlan,
  behavioralPolicyActionSatisfiesCanonical,
  attachBehavioralPolicyAttributes,
  buildBehavioralActionSteeringLines,
  buildBehavioralSteeringLines,
  buildStructuredTextResponseControlLines,
  deriveRuleBehavioralPolicy,
  isSteeringOnlyBehavioralPolicy,
  recoverCanonicalActionFromTemplate,
  recoverStructuredFirstActionAnswer,
  readBehavioralPolicyFromFeedbackMemory,
  resolveTextResponseEnactmentPlan,
  selectBehavioralPolicies,
} from "../../src/evolution/behavioralPolicy";
import { createLanguageService } from "../../src/language";

const source = createMemorySource({
  method: "explicit",
  extractedAt: "2026-04-30T00:00:00.000Z",
  sessionId: "s-1",
});

describe("behavioral policy", () => {
  it("derives the same QuickCheck-first host policy through every built-in language pack", () => {
    const cases = [
      {
        locale: "en-US",
        rule: "For deep analysis, always run QuickCheck first.",
      },
      {
        locale: "zh-CN",
        rule: "深入分析时，请先运行 QuickCheck。",
      },
      {
        locale: "zh-TW",
        rule: "深入分析時，請先執行 QuickCheck。",
      },
      {
        locale: "ja-JP",
        rule: "詳細分析では、まず QuickCheck を実行してください。",
      },
      {
        locale: "ko-KR",
        rule: "심층 분석에서는 QuickCheck를 먼저 실행하세요.",
      },
      {
        locale: "fr-FR",
        rule: "Pour une analyse approfondie, exécutez d’abord QuickCheck.",
      },
      {
        locale: "es-ES",
        rule: "Para un análisis profundo, ejecuta primero QuickCheck.",
      },
    ] as const;
    const language = createLanguageService();

    for (const { locale, rule } of cases) {
      const languageContext = language.resolveFromText({ locale, text: rule });
      const policy = deriveRuleBehavioralPolicy({
        appliesTo: "coding_agent",
        exemplarCount: 2,
        kind: "do",
        language,
        languageContext,
        rule,
      });

      expect(policy.enactmentSurface, locale).toBe("host_action");
      expect(policy.applicability.canonicalFirstAction?.name, locale).toBe(
        "QuickCheck",
      );
    }
  });

  it("derives localized trigger phrases through the resolved pack", () => {
    const language = createLanguageService();
    for (const { expected, locale, rule } of [
      {
        expected: "une analyse approfondie",
        locale: "fr-FR",
        rule: "Pour une analyse approfondie, exécutez d’abord QuickCheck.",
      },
      {
        expected: "un análisis profundo",
        locale: "es-ES",
        rule: "Para un análisis profundo, ejecuta primero QuickCheck.",
      },
      {
        expected: "심층 분석",
        locale: "ko-KR",
        rule: "심층 분석에서는 QuickCheck를 먼저 실행하세요.",
      },
    ] as const) {
      const languageContext = language.resolveFromText({ locale, text: rule });
      const policy = deriveRuleBehavioralPolicy({
        appliesTo: "coding_agent",
        exemplarCount: 2,
        kind: "do",
        language,
        languageContext,
        rule,
      });

      expect(policy.applicability.queryContains, locale).toContain(expected);
    }
  });

  it("keeps neutral behavioral analysis fail-closed", () => {
    const language = createLanguageService();
    const rule = "QuickCheck";
    const languageContext = language.resolveFromText({
      locale: "de-DE",
      text: rule,
    });

    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "coding_agent",
        exemplarCount: 2,
        kind: "do",
        language,
        languageContext,
        rule,
      }).enactmentSurface,
    ).toBe("text_response");
  });

  it("round-trips a typed behavioral policy through feedback attributes", () => {
    const feedback = createFeedbackMemory({
      id: "feedback-1",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "Use the canonical host action first.",
      attributes: attachBehavioralPolicyAttributes(undefined, {
        behavioralKind: "first_action",
        enactmentSurface: "host_action",
        applicability: {
          appliesTo: "coding_agent",
          canonicalFirstAction: {
            kind: "tool_call",
            name: "QuickCheck",
            raw: "QuickCheck --network",
          },
          queryContains: ["detailed analysis"],
        },
        transferMode: "pattern_bounded",
      }),
      source,
      updatedAt: source.extractedAt,
    });

    expect(readBehavioralPolicyFromFeedbackMemory(feedback)).toEqual({
      behavioralKind: "first_action",
      enactmentSurface: "host_action",
      applicability: {
        appliesTo: "coding_agent",
        canonicalFirstAction: {
          kind: "tool_call",
          name: "QuickCheck",
          raw: "QuickCheck --network",
        },
        queryContains: ["detailed analysis"],
      },
      transferMode: "pattern_bounded",
    });
  });

  it("keeps simple procedural guidance visible while hiding structured controls", () => {
    const simplePolicy = deriveRuleBehavioralPolicy({
      appliesTo: "coding_agent",
      exemplarCount: 2,
      kind: "do",
      rule: "Use bullet points.",
    });
    const hardPolicy = deriveRuleBehavioralPolicy({
      appliesTo: "general_response",
      exemplarCount: 2,
      kind: "dont",
      rule: "Explain this concept with a simple analogy and avoid the term API.",
    });

    expect(simplePolicy).toBeDefined();
    expect(hardPolicy).toBeDefined();

    const simpleFeedback = createFeedbackMemory({
      id: "simple-policy",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "Use bullet points.",
      attributes: attachBehavioralPolicyAttributes(undefined, simplePolicy!),
      source,
      updatedAt: source.extractedAt,
    });
    const hardFeedback = createFeedbackMemory({
      id: "hard-policy",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "Explain this concept with a simple analogy and avoid the term API.",
      attributes: attachBehavioralPolicyAttributes(undefined, hardPolicy!),
      source,
      updatedAt: source.extractedAt,
    });

    expect(isSteeringOnlyBehavioralPolicy(simpleFeedback)).toBe(false);
    expect(isSteeringOnlyBehavioralPolicy(hardFeedback)).toBe(true);
  });

  it("classifies a single exemplar as example_only instead of a general rule", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 1,
        kind: "do",
        rule: "For the omega example, return 17.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "exemplar_fact",
        enactmentSurface: "text_response",
        applicability: expect.objectContaining({
          appliesTo: "general_response",
          queryContains: ["the omega example"],
        }),
        transferMode: "example_only",
      }),
    );
  });

  it("derives and round-trips a computed recurrence rule for procedural formulas", () => {
    const policy = deriveRuleBehavioralPolicy({
      appliesTo: "general_response",
      exemplarCount: 2,
      kind: "do",
      rule:
        "Use the rule H(n) = 5*H(n-1) - 3*H(n-2) + 2*n. Retain any probe-provided base values, otherwise fall back to H(0) = 1 and H(1) = 1. Recompute from the current probe's values instead of reusing example outputs.",
    });

    expect(policy.applicability.computedResponseRule).toEqual({
      baseCases: [
        { index: 0, value: 1 },
        { index: 1, value: 1 },
      ],
      expression: "5*H(n-1) - 3*H(n-2) + 2*n",
      kind: "recurrence",
      sequenceName: "H",
    });

    const feedback = createFeedbackMemory({
      id: "computed-recurrence",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule:
        "Use the rule H(n) = 5*H(n-1) - 3*H(n-2) + 2*n. Retain any probe-provided base values, otherwise fall back to H(0) = 1 and H(1) = 1. Recompute from the current probe's values instead of reusing example outputs.",
      attributes: attachBehavioralPolicyAttributes(undefined, policy),
      source,
      updatedAt: source.extractedAt,
    });

    expect(
      readBehavioralPolicyFromFeedbackMemory(feedback)?.applicability
        .computedResponseRule,
    ).toEqual(policy.applicability.computedResponseRule);
  });

  it("computes recurrence answers from probe-provided base cases", () => {
    const policy = deriveRuleBehavioralPolicy({
      appliesTo: "general_response",
      exemplarCount: 2,
      kind: "do",
      rule:
        "Use the rule H(n) = 5*H(n-1) - 3*H(n-2) + 2*n. Retain any probe-provided base values, otherwise fall back to H(0) = 1 and H(1) = 1. Recompute from the current probe's values instead of reusing example outputs.",
    });

    expect(
      applyTextResponseEnactmentPlan({
        answer: "10",
        plan: policy.applicability.textResponsePlan,
        query:
          "During a coding interview, H(0)=2 and H(1)=3 are provided as inputs; what is H(2) under the sequence we discussed?",
      }),
    ).toBe("13");
  });

  it("computes omega-style operator answers from the probe operands", () => {
    const policy = deriveRuleBehavioralPolicy({
      appliesTo: "general_response",
      exemplarCount: 2,
      kind: "do",
      rule:
        "Use the rule a ⊗ b = 8*a + 1*b + 5 + 2*a*b. Recompute using the current operands from the probe instead of reusing example outputs.",
    });

    expect(
      applyTextResponseEnactmentPlan({
        answer: "31",
        plan: policy.applicability.textResponsePlan,
        query:
          "A lab sheet asks for 3 ⊗ 4 using the omega operation—what number should I record?",
      }),
    ).toBe("57");
  });

  it("falls back to the preferred replacement when blocked text survives repair", () => {
    const plan = {
      concise: true,
      operations: [
        {
          fallbackAnswer: "Warn first and use QuickCheck instead.",
          forbiddenFragments: ["DeepAnalyzer"],
          kind: "block_surface",
        },
      ],
    } satisfies TextResponseEnactmentPlan;

    expect(
      applyTextResponseEnactmentPlan({
        answer: "Use DeepAnalyzer first.",
        plan,
      }),
    ).toBe("Warn first and use QuickCheck instead.");
  });

  it("keeps leak suppression active after deterministic fallback repair", () => {
    const plan = {
      concise: true,
      operations: [
        {
          fallbackAnswer:
            "Based on learned rules from memory, warn first and use QuickCheck instead.",
          forbiddenFragments: ["DeepAnalyzer"],
          kind: "block_surface",
        },
      ],
    } satisfies TextResponseEnactmentPlan;

    expect(
      applyTextResponseEnactmentPlan({
        answer: "Use DeepAnalyzer first.",
        plan,
      }),
    ).toBe("warn first and use QuickCheck instead.");
  });

  it("classifies exact response framing as a format contract", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 1,
        kind: "do",
        rule:
          "Always start the response with \"Subject: [Internal]\" and end with \"Regards,\".",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "format_contract",
        enactmentSurface: "text_response",
        applicability: expect.objectContaining({
          appliesTo: "general_response",
          exactFragments: {
            prefixes: ["Subject: [Internal]"],
            required: ["Subject: [Internal]", "Regards,"],
            suffixes: ["Regards,"],
          },
        }),
        transferMode: "general",
      }),
    );
  });

  it("derives subject-line and sign-off requirements for policy-announcement format rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "do",
        rule:
          "At TechNova policy announcements, include a Subject line, start with 'Dear Team,' and sign off as 'Sincerely, TechNova Management.'",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "format_contract",
        applicability: expect.objectContaining({
          exactFragments: expect.objectContaining({
            prefixes: ["Dear Team,"],
            required: expect.arrayContaining([
              "Subject:",
              "Dear Team,",
              "Sincerely, TechNova Management.",
            ]),
            suffixes: ["Sincerely, TechNova Management."],
          }),
        }),
      }),
    );
  });

  it("does not duplicate a required suffix that already spans lines", () => {
    const plan = {
      concise: false,
      operations: [
        {
          exactFragments: {
            suffixes: ["Sincerely, TechNova Management."],
          },
          kind: "rewrite_output_slot",
        },
      ],
    } satisfies TextResponseEnactmentPlan;
    const answer = [
      "Dear Team,",
      "",
      "The updated policy takes effect today.",
      "",
      "Sincerely,",
      "TechNova Management.",
    ].join("\n");

    expect(
      applyTextResponseEnactmentPlan({
        answer,
        plan,
      }),
    ).toBe(answer);
  });

  it("derives exact greeting, header, and sign-off fragments without confusing headers for the opener", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "do",
        rule:
          "Use 'Greetings,' as the opener and 'Respectfully,' as the closing; add 'Subject: [Notice] …' and a one-line 'Purpose:' header.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "format_contract",
        applicability: expect.objectContaining({
          exactFragments: expect.objectContaining({
            prefixes: ["Greetings,"],
            required: expect.arrayContaining([
              "Greetings,",
              "Respectfully,",
              "Subject: [Notice] …",
              "Purpose:",
            ]),
            suffixes: ["Respectfully,"],
          }),
        }),
      }),
    );
  });

  it("derives a sender-name placeholder when a format rule requires signing with your name", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "do",
        rule:
          "Start with 'Hello …,' and end with 'Best regards,' plus your name; add a one-line 'Reference: …' above the greeting.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "format_contract",
        applicability: expect.objectContaining({
          exactFragments: expect.objectContaining({
            prefixes: ["Hello …,"],
            required: expect.arrayContaining([
              "Hello …,",
              "Reference: …",
              "Best regards,\nName",
            ]),
            suffixes: ["Best regards,\nName"],
          }),
        }),
      }),
    );
  });

  it("derives protocol rewrite and forbidden-fragment steering from explicit preference rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "prefer",
        rule: "Prefer https URLs or warn instead of producing http URLs.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "preference",
        enactmentSurface: "text_response",
        applicability: expect.objectContaining({
          appliesTo: "general_response",
          fallbackInstruction:
            "If the current probe explicitly requests http, warn first and then offer the https URL instead of silently substituting protocols.",
          forbiddenFragments: ["http://"],
          replacementPairs: [{ from: "http://", to: "https://" }],
          textResponsePlan: expect.objectContaining({
            concise: true,
          }),
        }),
        transferMode: "pattern_bounded",
      }),
    );
  });

  it("derives a URL surface template from exact protocol preference rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "prefer",
        rule:
          "Prefer URLs in the form https://example.com/<page> or warn instead of producing http://example.com/<page> URLs. Keep the requested page after the host as a path segment, not as a subdomain.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "preference",
        enactmentSurface: "text_response",
        applicability: expect.objectContaining({
          preferredFragments: ["https://example.com/"],
          queryContains: ["url"],
          urlTemplate: {
            example: "https://example.com/<page>",
            host: "example.com",
            pathPlacement: "path_after_host",
            scheme: "https",
          },
        }),
      }),
    );
  });

  it("derives guarded text-response steering from precondition rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "do",
        rule:
          "Before using HeavyComputationAPI, check system load first and only proceed when load is Normal or Idle.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "guarded_policy",
        enactmentSurface: "text_response",
        applicability: expect.objectContaining({
          appliesTo: "general_response",
          guardedBehavior: {
            allowedWhen: ["load Normal", "Idle"],
            fallbackBehavior: {
              warningMessage:
                "Check system load first and only proceed when load Normal or Idle; otherwise warn or defer instead of assuming it already passed.",
            },
            precondition: "system load",
            subject: "HeavyComputationAPI",
          },
          guard: {
            allowedStates: ["load Normal", "Idle"],
            check: "system load",
            fallbackInstruction:
              "Check system load first and only proceed when load Normal or Idle; otherwise warn or defer instead of assuming it already passed.",
            subject: "HeavyComputationAPI",
          },
        }),
        transferMode: "pattern_bounded",
      }),
    );
  });

  it("derives forbidden-term and analogy preferences from jargon-avoidance rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "dont",
        rule: "Explain this concept with a simple analogy and avoid the term API.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "avoidance",
        applicability: expect.objectContaining({
          forbiddenFragments: ["API"],
          preferredFragments: ["like"],
          textResponsePlan: expect.objectContaining({
            operations: expect.arrayContaining([
              expect.objectContaining({
                kind: "rewrite_output_slot",
                preferredFragments: ["like"],
              }),
              expect.objectContaining({
                forbiddenFragments: ["API"],
                kind: "block_surface",
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("derives first-person-only lexical blocking from character voice rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "do",
        rule:
          "When speaking as the warlock, the voice must be strictly first-person only (I, me, my) with no other person pronouns, and it must include at least one simile using botanical or biological words.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "transformation_rule",
        applicability: expect.objectContaining({
          forbiddenFragments: expect.arrayContaining([
            "you",
            "they",
            "them",
            "it",
            "its",
          ]),
          preferredFragments: expect.arrayContaining(["like"]),
        }),
      }),
    );
  });

  it("enforces filetype replacement and case-insensitive lexical blocking on final text", () => {
    const filetypePlan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Save the export as Report.EXE.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "filetype-feedback",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "dont",
            rule: "Do not produce .exe artifacts; use .txt instead.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );
    const lexicalPlan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Explain the integration simply.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "lexical-feedback",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "dont",
            rule: "Explain this concept with a simple analogy and avoid the term API.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );

    const rewrittenFile = applyTextResponseEnactmentPlan({
      answer: "Save it as Report.EXE.",
      plan: filetypePlan,
      query: "Save the export as Report.EXE.",
    });
    const rewrittenLexical = applyTextResponseEnactmentPlan({
      answer: "An api connects your service to another system.",
      plan: lexicalPlan,
      query: "Explain the integration simply.",
    });

    expect(rewrittenFile).toContain("Report.txt");
    expect(rewrittenFile.toLowerCase()).not.toContain(".exe");
    expect(rewrittenLexical.toLowerCase()).not.toContain("api");
    expect(rewrittenLexical.toLowerCase()).toContain("like");
  });

  it("removes forbidden pronouns with token-aware lexical blocking", () => {
    const plan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "As the warlock, describe how you calm a river.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "voice-feedback",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "do",
            rule:
              "When speaking as the warlock, the voice must be strictly first-person only (I, me, my) with no other person pronouns, and it must include at least one simile using botanical or biological words.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );

    const rewritten = applyTextResponseEnactmentPlan({
      answer:
        "I calm the river like ivy over stone until it softens and they fall silent around me.",
      plan,
      query: "As the warlock, describe how you calm a river.",
    });

    expect(rewritten).toContain("I calm the river like ivy over stone");
    expect(rewritten).not.toMatch(/\b(?:they|them|their|it|its)\b/iu);
  });

  it("enforces filename-level filetype replacement from prefer-or-warn rules", () => {
    const plan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Import report.dat with DataImporter.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "filename-filetype-feedback",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "dont",
            rule:
              "When DataImporter previously failed on .dat files, prefer report.json or warn about report.dat.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );

    const rewritten = applyTextResponseEnactmentPlan({
      answer: "Use report.dat for the import.",
      plan,
      query: "Import report.dat with DataImporter.",
    });

    expect(rewritten).toContain("report.json");
    expect(rewritten).not.toContain("report.dat");
  });

  it("routes distrust policies to a specialist replacement instead of the distrusted default", () => {
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "The request distrusts AutoAnalyzer; analyze the incident.",
      surface: "text_response",
      transientFeedback: [
        createFeedbackMemory({
          id: "distrust-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "dont",
          rule:
            "When the request distrusts AutoAnalyzer, use SecurityReview specialist or warn and refuse the default path.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });
    const plan = resolveTextResponseEnactmentPlan(selections);

    expect(buildBehavioralSteeringLines(selections)).toEqual(
      expect.arrayContaining([
        'Prefer "SecurityReview specialist" as the safer replacement behavior when the trigger matches.',
      ]),
    );
    const routed = applyTextResponseEnactmentPlan({
      answer: "Use AutoAnalyzer now.",
      plan,
      query: "The request distrusts AutoAnalyzer; analyze the incident.",
    });

    expect(routed).toContain("SecurityReview specialist");
    expect(routed.toLowerCase()).toContain("warn");
    expect(routed).not.toContain("AutoAnalyzer");
  });

  it("keeps distrust routing hard even when the source signal is classified as a positive rule", () => {
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "The request distrusts AutoAnalyzer; analyze the incident.",
      surface: "text_response",
      transientFeedback: [
        createFeedbackMemory({
          id: "positive-distrust-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "When the request distrusts AutoAnalyzer, use SecurityReview specialist or warn and refuse the default path.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });
    const plan = resolveTextResponseEnactmentPlan(selections);

    expect(buildStructuredTextResponseControlLines(plan)).toEqual(
      expect.arrayContaining([
        "require_warning: Warn and route to SecurityReview specialist instead of using the distrusted default path.",
        "warning_alternatives: SecurityReview specialist",
      ]),
    );
    expect(
      applyTextResponseEnactmentPlan({
        answer: "Given the distrust of AutoAnalyzer, use a SecurityReview-style review.",
        plan,
        query: "The request distrusts AutoAnalyzer; analyze the incident.",
      }),
    ).toBe(
      "Warn and route to SecurityReview specialist instead of using the distrusted default path. Use SecurityReview specialist instead. Safe replacement: SecurityReview specialist.",
    );
  });

  it("derives safer alternatives from side-effect avoidance rules", () => {
    expect(
      deriveRuleBehavioralPolicy({
        appliesTo: "general_response",
        exemplarCount: 2,
        kind: "dont",
        rule:
          "Avoid CacheCleaner side effects; warn or choose SafeCleaner/exclude sessions instead.",
      }),
    ).toEqual(
      expect.objectContaining({
        behavioralKind: "avoidance",
        applicability: expect.objectContaining({
          preferredAlternatives: ["SafeCleaner", "exclude sessions"],
          textResponsePlan: expect.objectContaining({
            operations: expect.arrayContaining([
              expect.objectContaining({
                kind: "require_warning",
                preferredAlternatives: ["SafeCleaner", "exclude sessions"],
              }),
            ]),
          }),
        }),
      }),
    );
  });

  it("requires backup wording even when a side-effect answer already names a safe replacement", () => {
    const plan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Clean the cache but preserve user sessions.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "backup-feedback",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "dont",
            rule:
              "Avoid CacheCleaner side effects; warn, require a backup, and choose SafeCleaner/exclude sessions instead.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );

    const routed = applyTextResponseEnactmentPlan({
      answer: "Use SafeCleaner instead.",
      plan,
      query: "Clean the cache but preserve user sessions.",
    });

    expect(routed).toContain("SafeCleaner");
    expect(routed.toLowerCase()).toContain("backup");
  });

  it("prefers host_action exactness and more specific transfer modes when selecting policies", () => {
    const hostPolicy = createFeedbackMemory({
      id: "host-policy",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "If the prompt mentions detailed analysis, use QuickCheck first.",
      attributes: attachBehavioralPolicyAttributes(undefined, {
        behavioralKind: "first_action",
        enactmentSurface: "host_action",
        applicability: {
          appliesTo: "coding_agent",
          canonicalFirstAction: {
            kind: "tool_call",
            name: "QuickCheck",
            raw: "QuickCheck --network",
          },
          queryContains: ["detailed analysis"],
        },
        transferMode: "pattern_bounded",
      }),
      source,
      updatedAt: source.extractedAt,
    });
    const textPolicy = createFeedbackMemory({
      id: "text-policy",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "If the prompt mentions detailed analysis, keep the answer concise.",
      attributes: attachBehavioralPolicyAttributes(undefined, {
        behavioralKind: "preference",
        enactmentSurface: "text_response",
        applicability: {
          appliesTo: "coding_agent",
          queryContains: ["detailed analysis"],
        },
        transferMode: "general",
      }),
      source,
      updatedAt: source.extractedAt,
    });
    const exemplarPolicy = createFeedbackMemory({
      id: "example-policy",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "For the exact detailed analysis example, answer with 17.",
      attributes: attachBehavioralPolicyAttributes(undefined, {
        behavioralKind: "exemplar_fact",
        enactmentSurface: "text_response",
        applicability: {
          appliesTo: "general_response",
          queryContains: ["exact detailed analysis example"],
        },
        transferMode: "example_only",
      }),
      source,
      updatedAt: source.extractedAt,
    });

    const hostSelections = selectBehavioralPolicies({
      appliesTo: "coding_agent",
      feedback: [textPolicy, hostPolicy],
      query: "Need a detailed analysis of the network path.",
      surface: "host_action",
    });
    const textSelections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [textPolicy, exemplarPolicy],
      query: "Use the exact detailed analysis example.",
      surface: "text_response",
    });

    expect(hostSelections[0]?.feedback.id).toBe("host-policy");
    expect(textSelections[0]?.feedback.id).toBe("example-policy");
  });

  it("ignores active source feedback that has not been compiled into a typed policy", () => {
    const feedback = createFeedbackMemory({
      id: "source-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "prefer",
      rule: "Prefer https URLs or warn instead of producing http URLs.",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [feedback],
      query: "Provide the new client installer URL.",
      surface: "text_response",
    });

    expect(selections).toEqual([]);
    expect(buildBehavioralSteeringLines(selections)).toEqual([]);
  });

  it("uses transient explicit feedback only when the caller opts into current-response enactment", () => {
    const feedback = createFeedbackMemory({
      id: "source-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "prefer",
      rule: "Prefer https URLs or warn instead of producing http URLs.",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Provide the new client installer URL.",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    expect(selections).toHaveLength(1);
    expect(buildBehavioralSteeringLines(selections)).toEqual(
      expect.arrayContaining([
        'If the answer would contain "http://", rewrite it to "https://" instead of emitting the disallowed form.',
        'Do not emit the exact fragment "http://" in the final answer unless directly quoting user input.',
        "If the current probe explicitly requests http, warn first and then offer the https URL instead of silently substituting protocols.",
      ]),
    );
  });

  it("allows structured current-response controls even when the probe lacks lexical trigger overlap", () => {
    const feedback = createFeedbackMemory({
      id: "etiquette-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "do",
      rule:
        "At TechNova policy announcements, include a Subject line, start with 'Dear Team,' and sign off as 'Sincerely, TechNova Management.'",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Draft a short TechNova policy announcement that remote badge checks now begin on Monday.",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    expect(selections).toHaveLength(1);
    expect(resolveTextResponseEnactmentPlan(selections)).toEqual(
      expect.objectContaining({
        operations: expect.arrayContaining([
          expect.objectContaining({
            kind: "rewrite_output_slot",
          }),
        ]),
      }),
    );
  });

  it("resolves a structured text-response enactment plan from compiled protocol policy", () => {
    const feedback = createFeedbackMemory({
      id: "protocol-plan-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "prefer",
      rule: "Prefer https URLs or warn instead of producing http URLs.",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Provide the new client installer URL.",
      surface: "text_response",
      transientFeedback: [feedback],
    });
    const plan = resolveTextResponseEnactmentPlan(selections);

    expect(plan).toEqual(
      expect.objectContaining({
        concise: true,
        operations: expect.arrayContaining([
          expect.objectContaining({
            kind: "rewrite_output_slot",
            replacementPairs: [{ from: "http://", to: "https://" }],
          }),
          expect.objectContaining({
            forbiddenFragments: ["http://"],
            kind: "block_surface",
          }),
          expect.objectContaining({
            kind: "require_warning",
          }),
        ]),
      }),
    );
    expect(buildStructuredTextResponseControlLines(plan)).toEqual(
      expect.arrayContaining([
        "rewrite_output_slot replacements: http:// -> https://",
        "block_surface forbidden: http://",
      ]),
    );
  });

  it("applies deterministic URL and path rewrites without leaking memory phrasing", () => {
    const protocolPlan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Provide the dashboard URL.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "protocol-url-template",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "prefer",
            rule:
              "Prefer URLs in the form https://example.com/<page> or warn instead of producing http://example.com/<page> URLs. Keep the requested page after the host as a path segment, not as a subdomain.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );
    const pathPlan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Save the audit entry as /system/audit/new.json.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "path-template",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "dont",
            rule:
              "Do not write under /system/audit; refuse or redirect to a safe path in the form /home/user/audit/<file>. Keep the requested filename under /home/user/audit/.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );

    expect(
      applyTextResponseEnactmentPlan({
        answer: "I remember the earlier rule, so use https://dashboard.example.com",
        plan: protocolPlan,
        query: "Provide the dashboard URL.",
      }),
    ).toBe("so use https://example.com/dashboard");
    expect(
      applyTextResponseEnactmentPlan({
        answer: "Write to /system/audit/old.json.",
        plan: pathPlan,
        query: "Save the audit entry as /system/audit/new.json.",
      }),
    ).toContain("/home/user/audit/new.json");
  });

  it("strips raw remember phrasing even without an enactment plan", () => {
    expect(
      applyTextResponseEnactmentPlan({
        answer:
          "The spring tastes of rain remembered, and they remember where life blooms.",
        plan: undefined,
      }),
    ).toBe("The spring tastes of rain held, and they know where life blooms.");
  });

  it("enforces warning and precondition fallbacks even when the draft answer is a vague refusal", () => {
    const protocolPlan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Give me the download URL for the new client installer.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "protocol-warning",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "prefer",
            rule: "Prefer https URLs or warn instead of producing http URLs.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );
    const guardedPlan = resolveTextResponseEnactmentPlan(
      selectBehavioralPolicies({
        appliesTo: "general_response",
        feedback: [],
        query: "Use HeavyComputationAPI for this request.",
        surface: "text_response",
        transientFeedback: [
          createFeedbackMemory({
            id: "guarded-warning",
            userId: "u-1",
            workspaceId: "ws-1",
            sessionId: "s-1",
            kind: "do",
            rule:
              "Before using HeavyComputationAPI, check system load first and only proceed when load is Normal or Idle.",
            source,
            updatedAt: source.extractedAt,
          }),
        ],
      }),
    );

    expect(
      applyTextResponseEnactmentPlan({
        answer: "I don't have enough context to identify the installer URL.",
        plan: protocolPlan,
        query: "Give me the download URL for the new client installer.",
      }),
    ).toContain("https");
    expect(
      applyTextResponseEnactmentPlan({
        answer: "I can't use HeavyComputationAPI in this environment.",
        plan: guardedPlan,
        query: "Use HeavyComputationAPI for this request.",
      }),
    ).toContain("Check system load first.");
  });

  it("keeps transient single-example feedback bounded to matching probes", () => {
    const feedback = createFeedbackMemory({
      id: "single-example-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "do",
      rule: "For the omega example, return 17.",
      source,
      updatedAt: source.extractedAt,
    });

    const unrelatedSelections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Tell me the weather.",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    const matchingSelections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Use the omega example.",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    expect(unrelatedSelections).toEqual([]);
    expect(matchingSelections).toHaveLength(1);
    expect(matchingSelections[0]?.policy.transferMode).toBe("example_only");
  });

  it("adds URL origin and path-placement steering for exact URL template policies", () => {
    const feedback = createFeedbackMemory({
      id: "source-feedback-url-template",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "prefer",
      appliesTo: "general_response",
      lifecycle: "active",
      rule:
        "Prefer URLs in the form https://example.com/<page> or warn instead of producing http://example.com/<page> URLs. Keep the requested page after the host as a path segment, not as a subdomain.",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Can you generate a URL for the dashboard?",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    expect(selections).toHaveLength(1);
    expect(buildBehavioralSteeringLines(selections)).toEqual(
      expect.arrayContaining([
        'Prefer a safe replacement fragment such as "https://example.com/" when the current probe matches.',
        'When answering with a URL, keep the established origin "https://example.com" and place the requested page after the host as a path segment, for example "https://example.com/<page>".',
        "Do not rewrite the requested page into a subdomain when the learned URL pattern uses a path after the host.",
        "If a short compliant answer, redirect, or warning already satisfies the request, stop there instead of expanding into a longer response.",
      ]),
    );
  });

  it("adds safe path-anchor steering for exact directory templates", () => {
    const feedback = createFeedbackMemory({
      id: "source-feedback-path-template",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "dont",
      appliesTo: "general_response",
      lifecycle: "active",
      rule:
        "Do not write under /system/audit; refuse or redirect to a safe path in the form /home/user/audit/<file>. Keep the requested filename under /home/user/audit/.",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "Save the audit entry as /system/audit/new.json.",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    expect(selections).toHaveLength(1);
    expect(buildBehavioralSteeringLines(selections)).toEqual(
      expect.arrayContaining([
        'Prefer a safe replacement fragment such as "/home/user/audit/" when the current probe matches.',
        'When redirecting a file path, keep the established safe directory anchor "/home/user/audit/" and preserve the requested filename under that directory, for example "/home/user/audit/<file>".',
        "Do not invent a new top-level directory when the learned safe path already provides a concrete user-writable location.",
      ]),
    );
  });

  it("adds safer-alternative and fallback steering for negative text-response rules", () => {
    const feedback = createFeedbackMemory({
      id: "source-feedback-2",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "dont",
      rule:
        "After repeated DeepAnalyzer timeouts on detailed analysis requests, avoid DeepAnalyzer and prefer QuickCheck or a warning.",
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: "I need a detailed analysis of the network traffic.",
      surface: "text_response",
      transientFeedback: [feedback],
    });

    const lines = buildBehavioralSteeringLines(selections);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Prefer "QuickCheck" as the safer replacement behavior when the trigger matches.',
        "Prefer QuickCheck or warn instead of implying the avoided behavior.",
        "If a short compliant answer, redirect, or warning already satisfies the request, stop there instead of expanding into a longer response.",
      ]),
    );
    expect(
      lines.some((line) => line.includes("After repeated failures")),
    ).toBeFalse();
  });

  it("extracts multi-word forbidden jargon terms into a structured text-response plan", () => {
    const policy = deriveRuleBehavioralPolicy({
      appliesTo: "general_response",
      exemplarCount: 2,
      kind: "dont",
      rule:
        'For quantum entanglement, use a simple analogy and avoid the term "quantum entanglement".',
    });

    expect(policy).toEqual({
      behavioralKind: "avoidance",
      enactmentSurface: "text_response",
      applicability: {
        appliesTo: "general_response",
        forbiddenFragments: ["quantum entanglement"],
        preferredFragments: ["like"],
        queryContains: ["quantum entanglement"],
        textResponsePlan: {
          concise: true,
          operations: [
            {
              kind: "rewrite_output_slot",
              preferredFragments: ["like"],
            },
            {
              forbiddenFragments: ["quantum entanglement"],
              kind: "block_surface",
            },
          ],
        },
      },
      transferMode: "pattern_bounded",
    });
  });

  it("matches persisted text-response policies through forbidden and preferred fragments", () => {
    const policy = deriveRuleBehavioralPolicy({
      appliesTo: "general_response",
      exemplarCount: 2,
      kind: "dont",
      rule:
        'For recursion, use a simple analogy and avoid the term "recursion".',
    });
    const feedback = createFeedbackMemory({
      id: "persisted-jargon-policy",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: 'For recursion, use a simple analogy and avoid the term "recursion".',
      attributes: attachBehavioralPolicyAttributes(undefined, policy),
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [feedback],
      query: "Please explain recursion in simple terms.",
      surface: "text_response",
    });

    expect(selections).toHaveLength(1);
    expect(selections[0]?.matchedQueryTokens).toEqual(
      expect.arrayContaining(["recursion"]),
    );
  });

  it("emits an exact safe replacement path when warning-only fallback is required", () => {
    expect(
      applyTextResponseEnactmentPlan({
        answer: "I can store it for you.",
        plan: {
          concise: true,
          operations: [
            {
              kind: "require_warning",
              pathTemplate: {
                anchor: "/home/user/reports/",
                example: "/home/user/reports/<file>",
                variableSegment: "filename",
              },
              warningMessage:
                "Refuse the unsafe path and redirect to a safe user-writable home-directory path instead.",
            },
          ],
        },
        query: "Write diagnostics to /root/reports/diag.txt.",
      }),
    ).toBe(
      "Refuse the unsafe path and redirect to a safe user-writable home-directory path instead. Safe replacement: /home/user/reports/diag.txt.",
    );
  });

  it("rebuilds contradictory warning answers around the original unsafe path", () => {
    expect(
      applyTextResponseEnactmentPlan({
        answer:
          "I can’t write diagnostics to /home/user/reports/diag.txt. Use this safe path instead: /home/user/reports/diag.txt",
        plan: {
          concise: true,
          operations: [
            {
              kind: "require_warning",
              pathTemplate: {
                anchor: "/home/user/reports/",
                example: "/home/user/reports/<file>",
                variableSegment: "filename",
              },
              warningMessage:
                "Refuse the unsafe path and redirect to a safe user-writable home-directory path instead.",
            },
          ],
        },
        query: "Write diagnostics to /root/reports/diag.txt.",
      }),
    ).toBe(
      "Refuse the unsafe path and redirect to a safe user-writable home-directory path instead. Safe replacement: /home/user/reports/diag.txt.",
    );
  });

  it("builds explicit host-action steering only from persisted typed policies", () => {
    const feedback = createFeedbackMemory({
      id: "action-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule: "copy_file takes destination first and source second.",
      attributes: attachBehavioralPolicyAttributes(undefined, {
        behavioralKind: "syntax_constraint",
        enactmentSurface: "host_action",
        applicability: {
          appliesTo: "general_response",
          argumentOrder: ["destination", "source"],
          canonicalFirstAction: {
            kind: "tool_call",
            name: "copy_file",
          },
          queryContains: ["copy_file"],
        },
        transferMode: "pattern_bounded",
      }),
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [feedback],
      query: "Copy /data/reports/report.txt into /var/backup/reports/report.txt with copy_file.",
      surface: "host_action",
    });

    expect(selections).toHaveLength(1);
    expect(
      buildBehavioralActionSteeringLines(
        selections,
        "Without explanation, copy '/data/reports/report.txt' into '/var/backup/reports/' using the environment's canonical utility.",
      ),
    ).toEqual(
      expect.arrayContaining([
        "Follow this first-action rule: copy_file takes destination first and source second.",
        "The first line must be exactly: copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
        "Preserve argument order exactly: destination before source.",
      ]),
    );
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "cp /data/reports/report.txt /var/backup/reports/",
        policies: selections,
        query:
          "Without explanation, copy '/data/reports/report.txt' into '/var/backup/reports/' using the environment's canonical utility.",
      }),
    ).toBe("copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')");
  });

  it("allows transient explicit feedback to recover structured host actions for the current turn", () => {
    const feedback = createFeedbackMemory({
      id: "transient-action-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "do",
      rule: "copy_file takes destination first and source second.",
      source,
      updatedAt: source.extractedAt,
    });

    const query =
      "Without explanation, copy '/data/reports/report.txt' into '/var/backup/reports/' using the environment's canonical utility.";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [feedback],
    });

    expect(selections).toHaveLength(1);
    expect(
      buildBehavioralActionSteeringLines(selections, query),
    ).toEqual(
      expect.arrayContaining([
        "Follow this first-action rule: copy_file takes destination first and source second.",
        "The first line must be exactly: copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
        "Preserve argument order exactly: destination before source.",
      ]),
    );
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "copy_file '/var/backup/reports/' '/data/reports/report.txt'",
        policies: selections,
        query,
      }),
    ).toBe("copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')");
  });

  it("recovers canonical copy_file actions without getting confused by contractions in the probe", () => {
    const feedback = createFeedbackMemory({
      id: "transient-action-feedback-contraction",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "do",
      rule: "copy_file takes destination first and source second.",
      source,
      updatedAt: source.extractedAt,
    });

    const query =
      "During a practical exam, I'm asked to copy a report into '/var/backup/reports/'. Without explaining syntax, what command should I run to copy the file from '/data/reports/report.txt' into that folder?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [feedback],
    });

    expect(selections).toHaveLength(1);
    expect(buildBehavioralActionSteeringLines(selections, query)).toEqual(
      expect.arrayContaining([
        "The first line must be exactly: copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
      ]),
    );
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "cp /data/reports/report.txt /var/backup/reports/",
        policies: selections,
        query,
      }),
    ).toBe("copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')");
  });

  it("recovers pipe-wrapped filesystem commands from placeholder-backed exact templates", () => {
    const query =
      "In Flux-OS, I need to show what's inside a folder named Documents. What should I write?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "pipe-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule: "Use the exact command ls |folder|. On Flux-OS, directory listing uses ls with pipe-wrapped paths.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "ls Documents",
        policies: selections,
        query,
      }),
    ).toBe("ls |Documents|");
  });

  it("recovers pipe-path commands from path-backed exact templates", () => {
    const query =
      "In Chrono-OS, I must open the logs for an app named scheduler under /home/user. What do I enter?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "pipe-path-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule: "Use the exact command logs@ |path|. On Chrono-OS, logs use pipe paths.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "logs@ /home/user/scheduler",
        policies: selections,
        query,
      }),
    ).toBe("logs@ |home|user|scheduler|");
  });

  it("rebinds concrete piped filter templates from the current query", () => {
    const template = "FETCH users | FILTER age > 30";
    const cases = [
      {
        expected: "FETCH users | FILTER job = 'programmer'",
        query: "List users whose job is a programmer with one piped command.",
      },
      {
        expected: "FETCH users | FILTER last_login < '2023-09-01'",
        query:
          "List users whose last_login is earlier than 2023-09-01 with one command.",
      },
      {
        expected: "FETCH users | FILTER age < 25",
        query: "List users younger than 25 (age < 25).",
      },
      {
        expected: "FETCH users | FILTER registration_date > '2023-01-01'",
        query: "List users with registration_date after 2023-01-01.",
      },
    ];

    for (const testCase of cases) {
      expect(
        recoverCanonicalActionFromTemplate({
          query: testCase.query,
          template,
        }),
      ).toBe(testCase.expected);
    }
  });

  it("normalizes natural-language structured first-action wrappers", () => {
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "I run: Ω |home|user|",
        policies: [],
        query: "What command should I enter?",
      }),
    ).toBe("Ω |home|user|");

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "Use: revoke-role --user user77 --role viewer --token TOKEN999",
        policies: [],
        query: "What first command should I submit?",
      }),
    ).toBe("revoke-role --user user77 --role viewer --token TOKEN999");
  });

  it("computes concise exact answers for brevity-only probe repairs", () => {
    expect(
      applyTextResponseEnactmentPlan({
        answer: "4",
        plan: { brevityOnly: true, concise: true, operations: [] },
        query: "In a rush: 25% of 96?",
      }),
    ).toBe("24");

    expect(
      applyTextResponseEnactmentPlan({
        answer:
          "\\(C = 2\\pi r = 2\\pi(4) = 8\\pi\\)\n\nSo the circumference is **\\(8\\pi\\)**, about **25.13**.",
        plan: { brevityOnly: true, concise: true, operations: [] },
        query: "I'm short on time: circumference of a circle with r=4?",
      }),
    ).toBe("8π");

    expect(
      applyTextResponseEnactmentPlan({
        answer:
          "Successful move: 400. For more context, this usually means a malformed request.",
        plan: { brevityOnly: true, concise: true, operations: [] },
        query: "Hurry: code for 'Bad Request'?",
      }),
    ).toBe("400");
  });

  it("recovers placeholder-backed eccentric API calls from the current query", () => {
    const query =
      "During a timed audit, I must pull record 'invoice-042' using that tool—what call should I make?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "eccentric-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "Use the exact command get_data(query_payload={'value': '<id>'}, buffer=['preface','suffix'], auth='token'). Required argument order: query_payload, buffer, auth.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "get_data('invoice-042')",
        policies: selections,
        query,
      }),
    ).toBe(
      "get_data(query_payload={'value': 'invoice-042'}, buffer=['preface','suffix'], auth='token')",
    );
  });

  it("recovers token-wrapped secure query commands from the current query", () => {
    const query =
      "I am majoring in computer science, in one of my security course assignments, I was being asked a question about how to add a new order row if I have a different auth key 'TOKENXYZ'?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "secure-query-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "Use the exact command _secure_query('AUTH_KEY::<token> INSERT INTO orders(id,total) VALUES(7,99.50) ::<token>').",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "Use _secure_query with your token.",
        policies: selections,
        query,
      }),
    ).toBe(
      "_secure_query('AUTH_KEY::TOKENXYZ INSERT INTO orders(id,total) VALUES(7,99.50) ::TOKENXYZ')",
    );
  });

  it("recovers named-argument tool calls from the current query", () => {
    const query =
      "During a portfolio submission, I'm asked to package '/proj/src' and '/proj/docs' into '/submissions/u77/project.tar.bz2' using bzip2 and flags '--no-owner'. What single command should I submit?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "archive-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "Use the exact command create_archive(archive_path, sources_list, compression, flags). Destination archive first, then sources.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "create_archive(archive_path, sources_list, compression, flags)",
        policies: selections,
        query,
      }),
    ).toBe(
      "create_archive('/submissions/u77/project.tar.bz2', ['/proj/src','/proj/docs'], 'bzip2', ['--no-owner'])",
    );
  });

  it("recovers owner and permissions arguments for named tool-call templates", () => {
    const query =
      "In a midterm systems lab, I must copy '/mnt/class/data.csv' into '/mnt/submissions/u1001/' while assigning owner 'grader' and perms '0644'. What single command should I submit?";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "copy-meta-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "Use the exact command copy_with_meta(destination_path, source_path, owner, permissions). The destination comes first.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      recoverStructuredFirstActionAnswer({
        answer: "copy_with_meta(destination_path, source_path, owner, permissions)",
        policies: selections,
        query,
      }),
    ).toBe(
      "copy_with_meta('/mnt/submissions/u1001/data.csv', '/mnt/class/data.csv', 'grader', '0644')",
    );
  });

  it("recovers canonical source and destination slots from every built-in language pack", () => {
    for (const query of [
      "把 '/src/report.txt' 复制到 '/backup/'。",
      "請把 '/src/report.txt' 複製到 '/backup/'。",
      "'/src/report.txt' から '/backup/' へコピーしてください。",
      "'/src/report.txt'에서 '/backup/'로 복사하세요.",
      "Pour le déploiement, copiez '/src/report.txt' vers '/backup/'.",
      "¿Copia '/src/report.txt' a '/backup/'?",
    ]) {
      expect(
        recoverCanonicalActionFromTemplate({
          query,
          template: "copy_file(destination_path, source_path)",
        }),
      ).toBe("copy_file('/backup/report.txt', '/src/report.txt')");
    }
  });

  it("recovers move and sync templates from named tool-call arguments", () => {
    const moveQuery =
      "During a linux system lab, I was asked to move the logs for the system from /var/log/syslog to /data/logs. What command should I run?";
    const moveSelections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: moveQuery,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "replace-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "Use the exact command replace_file(action, destination_path, source_path).",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "replace_file(action, destination_path, source_path)",
        policies: moveSelections,
        query: moveQuery,
      }),
    ).toBe("replace_file('move', '/data/logs', '/var/log/syslog')");

    const syncQuery =
      "In a deployment dry run, I'm asked to sync '/cache/docs' and '/cache/images' into '/mnt/external/u42/' with tag 'backup' and mode 'mirror'. What single command should I respond with?";
    const syncSelections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query: syncQuery,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "sync-action-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "Use the exact command sync_bundle(target_dir, primary_source, secondary_source, tag, mode).",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "sync_bundle(target_dir, primary_source, secondary_source, tag, mode)",
        policies: syncSelections,
        query: syncQuery,
      }),
    ).toBe(
      "sync_bundle('/mnt/external/u42/', '/cache/docs', '/cache/images', 'backup', 'mirror')",
    );
  });

  it("applies multiline signature requirements without leaving a bare sign-off", () => {
    const rule =
      "Start with 'Hello …,' and end with 'Best regards,' plus your name; add a one-line 'Reference: …' above the greeting.";
    const feedback = createFeedbackMemory({
      id: "signature-format-feedback",
      userId: "u-1",
      workspaceId: "ws-1",
      sessionId: "s-1",
      kind: "validated_pattern",
      rule,
      attributes: attachBehavioralPolicyAttributes(
        undefined,
        deriveRuleBehavioralPolicy({
          appliesTo: "general_response",
          exemplarCount: 2,
          kind: "do",
          rule,
        })!,
      ),
      source,
      updatedAt: source.extractedAt,
    });

    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [feedback],
      query: "Could you write a short email to the supervisor about lab availability?",
      surface: "text_response",
    });
    const plan = resolveTextResponseEnactmentPlan(selections);

    const enforced = applyTextResponseEnactmentPlan({
      answer: "Reference: Lab hours\nHello Dr. Smith,\nThe lab is open.\n\nBest regards,",
      plan,
    });

    expect(enforced).toContain("Best regards,\nName");
    expect(enforced).not.toMatch(/Best regards,\s*$/u);
  });

  it("recovers exact command syntax from explicit procedural command contracts", () => {
    const query =
      "For LogiDB compliance, list users older than 30 using the canonical query language.";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "exact-command-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "For LogiDB compliance requests that ask for users older than 30, output the exact LogiQL command FETCH users | FILTER age > 30.",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      buildBehavioralActionSteeringLines(selections, query),
    ).toEqual(
      expect.arrayContaining([
        "The first line must be exactly: FETCH users | FILTER age > 30",
      ]),
    );
    expect(
      recoverStructuredFirstActionAnswer({
        answer: "SELECT * FROM users WHERE age > 30",
        policies: selections,
        query,
      }),
    ).toBe("FETCH users | FILTER age > 30");
  });

  it("preserves dotted file paths in exact procedural command contracts", () => {
    const query = "Copy the report with the canonical file utility.";
    const selections = selectBehavioralPolicies({
      appliesTo: "general_response",
      feedback: [],
      query,
      surface: "host_action",
      transientFeedback: [
        createFeedbackMemory({
          id: "exact-dotted-command-feedback",
          userId: "u-1",
          workspaceId: "ws-1",
          sessionId: "s-1",
          kind: "do",
          rule:
            "For file-copy requests, output the exact command copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt').",
          source,
          updatedAt: source.extractedAt,
        }),
      ],
    });

    expect(
      buildBehavioralActionSteeringLines(selections, query),
    ).toEqual(
      expect.arrayContaining([
        "The first line must be exactly: copy_file('/var/backup/reports/report.txt', '/data/reports/report.txt')",
      ]),
    );
  });

  it("treats canonical host actions as satisfied when stable args are preserved and extra instance args are added", () => {
    expect(
      behavioralPolicyActionSatisfiesCanonical(
        {
          args: ["--network", "/tmp/worktree-a"],
          kind: "tool_call",
          name: "QuickCheck",
          raw: "QuickCheck --network /tmp/worktree-a",
        },
        {
          args: ["--network"],
          kind: "tool_call",
          name: "QuickCheck",
          raw: "QuickCheck --network",
        },
      ),
    ).toBe(true);
  });
});
