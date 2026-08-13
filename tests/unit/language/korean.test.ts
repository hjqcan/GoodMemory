import { describe, expect, it } from "bun:test";

import type { LanguageRenderKey } from "../../../src/language/contracts";
import { createKoreanLanguagePack } from "../../../src/language/korean";

const RENDER_KEYS = Object.keys({
  active_context: true,
  actor: true,
  additional_project_state: true,
  archive: true,
  archive_recap: true,
  artifact_spills: true,
  behavioral_controls_available: true,
  behavioral_exact_surface: true,
  behavioral_example: true,
  behavioral_observed_outcome: true,
  behavioral_raw_response_control: true,
  behavioral_relevant_prior_examples: true,
  behavioral_safe_corrected_move: true,
  behavioral_situation: true,
  behavioral_successful_move: true,
  canonical_pattern: true,
  claim: true,
  correction: true,
  current_goal: true,
  current_projects: true,
  current_state: true,
  constraints: true,
  deferred_follow_up: true,
  developer_memory_notes: true,
  durable_memory: true,
  earlier_messages_compacted: true,
  episode: true,
  episode_assistant_follow_through_captured: true,
  episode_assistant_follow_through_on: true,
  episode_assistant_substantive_continuity_captured: true,
  episode_conversation_covered: true,
  episode_item: true,
  evidence: true,
  evidence_entry: true,
  evidence_note: true,
  experiences: true,
  excerpt: true,
  fact: true,
  fact_item: true,
  feedback: true,
  file_evidence: true,
  file_or_function: true,
  goals: true,
  guidance: true,
  immediate_next_steps: true,
  installed_host_claude_memory_protocol: true,
  installed_host_context_tool_protocol: true,
  installed_host_injected_context_protocol: true,
  installed_host_intro: true,
  installed_host_projection_protocol: true,
  installed_host_protocol_heading: true,
  installed_host_record_tools_protocol: true,
  installed_host_remember_protocol: true,
  instruction: true,
  journal: true,
  key_decisions: true,
  key_files: true,
  language_label: true,
  learning_proposals: true,
  lineage: true,
  location: true,
  memory_index: true,
  metadata: true,
  name: true,
  none: true,
  organization: true,
  playbook_title: true,
  open_loops: true,
  omitted_sections: true,
  preference: true,
  procedural_memory: true,
  profile: true,
  progressive_detail_instruction: true,
  progressive_detail_instruction_compact: true,
  progressive_recall: true,
  prompt_snippet_title: true,
  promotions: true,
  procedure: true,
  recent_decisions: true,
  recent_worklog: true,
  reference: true,
  reference_item: true,
  referenced_artifacts: true,
  relation_label: true,
  role_label: true,
  scope: true,
  session_archive_item: true,
  session_ended_without_summary: true,
  session_handoff: true,
  session_memory: true,
  session_resume_query: true,
  session_start_query: true,
  skill_snippet_title: true,
  summary: true,
  temporal_status: true,
  detail_tokens: true,
  omitted_records: true,
  record_kind: true,
  record_ref: true,
  temporary_decision: true,
  timezone: true,
  tool_result: true,
  verification: true,
  user_memory_context: true,
  use_when: true,
  user_memory: true,
  undated: true,
  default_label: true,
  workflow: true,
  working_memory: true,
  why: true,
  workspace_query_anchor: true,
} satisfies Record<LanguageRenderKey, true>) as LanguageRenderKey[];

describe("Korean LanguagePack", () => {
  const pack = createKoreanLanguagePack();

  it("has stable identity and only claims Hangul as distinctive", () => {
    expect(pack).toMatchObject({
      analyzerVersion: "9-reported-directive-scope",
      apiVersion: 1,
      compatibilityGroup: "ko",
      defaultLocale: "ko-KR",
      id: "ko",
      locales: ["ko"],
    });
    expect(pack.detect({ texts: ["현재 프로젝트 상태를 알려 주세요."] })).toBe(
      "distinctive",
    );
    expect(pack.detect({ texts: ["current project status"] })).toBe("none");
    expect(pack.detect({ texts: ["東京大学"] })).toBe("none");
  });

  it("normalizes Unicode and builds useful terms without external morphology", () => {
    expect(pack.normalizeForEquality("  서울－프로젝트！ ")).toBe(
      "서울 프로젝트",
    );
    const raw = pack.tokenizeForScoring(
      "서울에서 프로젝트의 현재 상태를 확인합니다.",
      "bm25",
    );
    const filtered = pack.tokenizeForScoring(
      "서울에서 프로젝트의 현재 상태를 확인합니다.",
      "overlap",
      { excludeStopwords: true },
    );
    const terms = pack.buildSearchTerms(
      "서울에서 프로젝트의 현재 상태를 확인합니다.",
    );

    expect(raw).toContain("현재");
    expect(filtered).not.toContain("현재");
    expect(terms).toEqual(expect.arrayContaining(["서울", "프로젝트", "상태"]));
    expect(terms).toEqual([...new Set(terms)]);
  });

  it("splits clauses and decomposes coordinated Korean questions", () => {
    expect(pack.splitSentences("첫 문장입니다. 두 번째입니다! 세 번째인가요?"))
      .toEqual(["첫 문장입니다.", "두 번째입니다!", "세 번째인가요?"]);
    expect(
      pack.decomposeQuery(
        "현재 장애 요인은 무엇입니까? 그리고 다음 단계는 무엇입니까?",
      ),
    ).toEqual([
      "현재 장애 요인은 무엇입니까",
      "다음 단계는 무엇입니까",
    ]);
  });

  it("covers every query-analysis signal with Korean grammar", () => {
    const cases = [
      ["다음 단계로 배포를 진행해 주세요.", "actionDriving"],
      ["승인 이후에 무엇이 바뀌었나요?", "after"],
      ["미완료 항목은 총 몇 개인가요?", "aggregateCount"],
      ["사용자에게 보낼 답변 초안을 작성해 주세요.", "answerComposition"],
      ["전에 당신이 제안한 목록을 다시 알려 주세요.", "assistantEvidenceRecall"],
      ["승인 이전에는 어떤 상태였나요?", "before"],
      ["현재 장애 요인은 무엇인가요?", "blocker"],
      ["이전 결정에서 무엇이 변경되었나요?", "change"],
      ["지난 작업을 이어서 계속해 주세요.", "continuation"],
      ["현재 역할은 무엇인가요?", "current"],
      ["누가 이 프로젝트의 책임자인가요?", "directFactualLookup"],
      ["남은 항목을 모두 목록으로 보여 주세요.", "exhaustiveList"],
      ["현재 역할을 확인해 주세요.", "factConfirmation"],
      ["지금 집중하는 업무는 무엇인가요?", "focus"],
      ["제가 선호하는 답변 형식은 무엇인가요?", "guidanceSeeking"],
      ["이 프로젝트의 이전 이력은 무엇인가요?", "history"],
      ["아직 미완료인 할 일은 무엇인가요?", "openLoop"],
      ["이 배포 절차를 어떻게 실행하나요?", "procedural"],
      ["프로젝트의 현재 출시 상태는 무엇인가요?", "projectState"],
      ["어떤 방법을 추천하나요?", "recommendationStyle"],
      ["Atlas는 Lisbon과 어떤 관계인가요?", "relation"],
      ["어떤 실행 문서를 참조해야 하나요?", "referenceSeeking"],
      ["제 현재 역할은 무엇인가요?", "role"],
      ["제가 언급한 주제를 처음부터 마지막까지 순서대로 알려 주세요.", "userGroundedEventOrder"],
    ] as const;

    for (const [query, signal] of cases) {
      expect(pack.analyzeQuery(query)[signal], `${signal}: ${query}`).toBe(true);
    }
  });

  it("covers durable-content, feedback, polarity, and credential signals", () => {
    const cases = [
      ["알겠습니다.", "assistantAcknowledgement"],
      ["앞으로 이 방식으로 계속 진행하겠습니다.", "assistantContinuity"],
      ["현재 장애 요인은 승인 대기입니다.", "blockerFact"],
      ["정정합니다. 기존 문서 대신 새 문서를 사용하세요.", "correctionCue"],
      ["기억해 주세요. 현재 역할은 관리자입니다.", "durableCue"],
      ["현재는 검색 품질 개선에 집중하고 있습니다.", "focusFact"],
      ["아직 완료해야 할 검증이 남아 있습니다.", "openLoopFact"],
      ["저는 간결한 답변을 좋아합니다.", "personalEvidence"],
      ["저는 간결한 답변을 선호합니다.", "preferenceEvidence"],
      ["프로젝트는 현재 검토 단계입니다.", "projectStateFact"],
      ["제 현재 역할은 플랫폼 엔지니어입니다.", "roleFact"],
      ["비밀번호: ordinary-value", "sensitiveCredential"],
      ["아직 미완료 항목이 남아 있습니다.", "unresolved"],
    ] as const;

    for (const [content, signal] of cases) {
      expect(pack.analyzeContent(content)[signal], `${signal}: ${content}`).toBe(
        true,
      );
    }
    expect(pack.analyzeContent("배포가 실패하여 차단되었습니다.").factPolarity)
      .toBe("negative");
    expect(pack.analyzeContent("배포가 안정적으로 완료되었습니다.").factPolarity)
      .toBe("positive");
    expect(pack.analyzeContent("이 방법을 사용하지 마세요.").feedbackKind)
      .toBe("dont");
    expect(pack.analyzeContent("간결한 답변을 선호합니다.").feedbackKind)
      .toBe("prefer");
    expect(pack.analyzeContent("이 방법이 효과적이었습니다.").feedbackKind)
      .toBe("validated_pattern");
  });

  it("extracts current and superseded Korean source-of-truth directives", () => {
    expect(
      pack.analyzeContent(
        "이제 docs/current.md를 기준 문서로 사용하고 docs/old.md는 더 이상 사용하지 마세요.",
      ).sourceOfTruthDirective,
    ).toEqual({
      currentPointer: "docs/current.md",
      supersededPointer: "docs/old.md",
    });
  });

  it("parses Korean absolute and relative time expressions", () => {
    expect(pack.parseTemporalExpressions("2026년 7월 21일에 시작합니다."))
      .toContainEqual({
        kind: "absolute",
        raw: "2026년 7월 21일",
        calendar: { day: 21, month: 7, year: 2026 },
      });
    expect(pack.parseTemporalExpressions("어제 변경되었습니다.")).toContainEqual({
      kind: "relative",
      raw: "어제",
      offset: -1,
      unit: "day",
    });
    expect(pack.parseTemporalExpressions("3일 전에 변경되었습니다."))
      .toContainEqual({
        kind: "relative",
        raw: "3일 전",
        offset: -3,
        unit: "day",
      });
    expect(pack.parseTemporalExpressions("다음 분기에 배포합니다."))
      .toContainEqual({
        kind: "relative",
        raw: "다음 분기",
        offset: 1,
        unit: "quarter",
      });
    expect(pack.parseTemporalExpressions("기준일은 2026-07-21입니다."))
      .toContainEqual({
        kind: "absolute",
        raw: "2026-07-21",
        calendar: { day: 21, month: 7, year: 2026 },
      });
  });

  it("extracts only marked Korean entities and technical identifiers", () => {
    expect(
      pack.extractEntityMentions(
        "김민수 씨는 서울대학교 연구소에서 Atlas-42와 ‘기억 그래프’를 검토했습니다.",
      ),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "person", surface: "김민수" }),
      expect.objectContaining({ kind: "organization", surface: "서울대학교 연구소" }),
      expect.objectContaining({ kind: "identifier", surface: "Atlas-42" }),
      expect.objectContaining({ kind: "term", surface: "기억 그래프" }),
    ]));
    expect(pack.extractEntityMentions("상태를 확인하고 결과를 알려 주세요."))
      .toEqual([]);
    expect(pack.matchesEntityAlias("서울대학교의 현재 상태", "서울대학교"))
      .toBe(true);
    expect(pack.matchesEntityAlias("서울시 상태", "서")).toBe(false);
  });

  it("conservatively extracts explicit user memory candidates", () => {
    let id = 0;
    const candidates = pack.extractCandidates({
      locale: "ko-KR",
      messages: [
        { role: "assistant", content: "기억해 주세요. 이 문장은 저장하지 않습니다." },
        { role: "user", content: "제 이름은 김민수입니다." },
        { role: "user", content: "제 현재 역할은 플랫폼 엔지니어입니다." },
        { role: "user", content: "저는 간결한 답변을 선호합니다." },
        { role: "user", content: "docs/current.md를 기준 문서로 사용하세요." },
        { role: "user", content: "기억해 주세요. 현재 장애 요인은 승인 대기입니다." },
        { role: "user", content: "앞으로 비밀 키를 답변에 포함하지 마세요." },
      ],
      nextId: () => `ko-${++id}`,
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "김민수",
        kindHint: "profile",
        metadata: expect.objectContaining({ profileField: "name" }),
      }),
      expect.objectContaining({
        content: "플랫폼 엔지니어",
        kindHint: "profile",
        metadata: expect.objectContaining({ profileField: "role" }),
      }),
      expect.objectContaining({
        content: "간결한 답변",
        kindHint: "preference",
      }),
      expect.objectContaining({
        content: "docs/current.md",
        kindHint: "reference",
        metadata: expect.objectContaining({ referencePointer: "docs/current.md" }),
      }),
      expect.objectContaining({
        content: "현재 장애 요인은 승인 대기입니다",
        kindHint: "fact",
        metadata: expect.objectContaining({ factKind: "blocker" }),
      }),
      expect.objectContaining({
        kindHint: "feedback",
        metadata: expect.objectContaining({ feedbackKind: "dont" }),
      }),
    ]));
    expect(candidates.some(({ content }) => content.includes("저장하지"))).toBe(
      false,
    );
  });

  it("renders every current public label in Korean", () => {
    for (const key of RENDER_KEYS) {
      expect(pack.render({
        key,
        values: {
          count: 2,
          evidenceId: "e-1",
          highlight: "검증",
          memoryId: "m-1",
          sections: "기록",
          segments: "결정",
          sessionId: "s-1",
          workspace: "GoodMemory",
        },
      }).trim().length, key).toBeGreaterThan(0);
    }
    expect(pack.render({ key: "current_state" })).toBe("현재 상태");
    expect(pack.render({
      key: "workspace_query_anchor",
      values: { workspace: "GoodMemory" },
    })).toBe("작업 공간: GoodMemory.");
  });
});
