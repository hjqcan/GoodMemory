import { describe, expect, it } from "bun:test";

import {
  createChineseLanguagePack,
  createEnglishLanguagePack,
  createFrenchLanguagePack,
  createJapaneseLanguagePack,
  createKoreanLanguagePack,
  createLanguageService,
  createNeutralLanguagePack,
  createSpanishLanguagePack,
  type LanguagePack,
  type LanguageRenderKey,
} from "../../../src/language";

const RENDER_KEYS = Object.keys({
  active_context: true,
  additional_project_state: true,
  actor: true,
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
  open_loops: true,
  omitted_sections: true,
  playbook_title: true,
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
  temporal_status: true,
  summary: true,
  detail_tokens: true,
  omitted_records: true,
  record_kind: true,
  record_ref: true,
  temporary_decision: true,
  timezone: true,
  tool_result: true,
  verification: true,
  user_memory_context: true,
  user_memory: true,
  use_when: true,
  undated: true,
  default_label: true,
  workflow: true,
  working_memory: true,
  why: true,
  workspace_query_anchor: true,
} satisfies Record<LanguageRenderKey, true>) as LanguageRenderKey[];

const CASES: Array<{ pack: LanguagePack; sample: string }> = [
  {
    pack: createEnglishLanguagePack(),
    sample: "Remember that Atlas rollout is blocked until tomorrow.",
  },
  {
    pack: createChineseLanguagePack("Hans"),
    sample: "请记住 Atlas 发布目前受阻，明天继续。",
  },
  {
    pack: createChineseLanguagePack("Hant"),
    sample: "請記住 Atlas 發佈目前受阻，明天繼續。",
  },
  {
    pack: createJapaneseLanguagePack(),
    sample: "Atlas のリリースは現在ブロック中で、明日続けます。",
  },
  {
    pack: createKoreanLanguagePack(),
    sample: "Atlas 릴리스는 현재 차단되었으며 내일 계속합니다.",
  },
  {
    pack: createFrenchLanguagePack(),
    sample: "Le déploiement Atlas est actuellement bloqué et reprend demain.",
  },
  {
    pack: createSpanishLanguagePack(),
    sample: "El despliegue de Atlas está bloqueado y continúa mañana.",
  },
  {
    pack: createNeutralLanguagePack(),
    sample: "Δelta 42 / atlas-path",
  },
];

const ANALYSIS_REUSE_CASES: Array<{ content: string; pack: LanguagePack }> = [
  { content: "Never publish without review.", pack: createEnglishLanguagePack() },
  { content: "以后不要在审核前发布。", pack: createChineseLanguagePack("Hans") },
  { content: "以後不要在審核前發佈。", pack: createChineseLanguagePack("Hant") },
  { content: "今後、レビュー前に公開しないで。", pack: createJapaneseLanguagePack() },
  { content: "앞으로 검토 전에 게시하지 마세요.", pack: createKoreanLanguagePack() },
  { content: "Ne publie jamais sans revue.", pack: createFrenchLanguagePack() },
  { content: "Nunca publiques sin revisión.", pack: createSpanishLanguagePack() },
];

const REFERENCE_DIRECTIVE_CASES: Array<{
  content: string;
  currentPointer: string;
  pack: LanguagePack;
}> = [
  {
    content:
      "Use https://example.com/文档/runbook.md as the source of truth.",
    currentPointer: "https://example.com/文档/runbook.md",
    pack: createEnglishLanguagePack(),
  },
  {
    content: "现在以文档/运行手册.md为准。",
    currentPointer: "文档/运行手册.md",
    pack: createChineseLanguagePack("Hans"),
  },
  {
    content: "現在以文件/運行手冊.md為準。",
    currentPointer: "文件/運行手冊.md",
    pack: createChineseLanguagePack("Hant"),
  },
  {
    content: "以https://example.com/docs/runbook为准。",
    currentPointer: "https://example.com/docs/runbook",
    pack: createChineseLanguagePack("Hans"),
  },
  {
    content: "現在以https://example.com/文件/運行手冊為準。",
    currentPointer: "https://example.com/文件/運行手冊",
    pack: createChineseLanguagePack("Hant"),
  },
  {
    content: "資料/現在の手順書.mdを正とする。",
    currentPointer: "資料/現在の手順書.md",
    pack: createJapaneseLanguagePack(),
  },
  {
    content: "https://example.com/資料/現在の手順書を正とする。",
    currentPointer: "https://example.com/資料/現在の手順書",
    pack: createJapaneseLanguagePack(),
  },
  {
    content: "문서/현재절차서.md를 현재 기준 문서로 사용합니다.",
    currentPointer: "문서/현재절차서.md",
    pack: createKoreanLanguagePack(),
  },
  {
    content: "Utilise documents/guide-opérationnel.md comme source de vérité.",
    currentPointer: "documents/guide-opérationnel.md",
    pack: createFrenchLanguagePack(),
  },
  {
    content: "Usa documentos/guía-operativa.md como la fuente de verdad.",
    currentPointer: "documentos/guía-operativa.md",
    pack: createSpanishLanguagePack(),
  },
];

describe("LanguagePack candidate analysis reuse", () => {
  for (const { content, pack } of ANALYSIS_REUSE_CASES) {
    it(`${pack.id} reuses the supplied single-message analysis`, () => {
      let id = 0;
      const candidates = pack.extractCandidates({
        locale: pack.defaultLocale,
        messages: [{
          analysis: {
            ...pack.analyzeContent(content),
            feedbackKind: "do",
          },
          content,
          role: "user",
        }],
        nextId: () => `${pack.id}-${++id}`,
      });

      expect(candidates.find(({ kindHint }) => kindHint === "feedback")?.metadata)
        .toMatchObject({ feedbackKind: "do" });
    });
  }
});

describe("LanguagePack canonical reference directives", () => {
  for (const { content, currentPointer, pack } of REFERENCE_DIRECTIVE_CASES) {
    it(`${pack.id} emits the canonical parser result as its reference candidate`, () => {
      const analysis = pack.analyzeContent(content);
      expect(analysis.sourceOfTruthDirective).toEqual({ currentPointer });

      let id = 0;
      const references = pack.extractCandidates({
        locale: pack.defaultLocale,
        messages: [{ analysis, content, role: "user" }],
        nextId: () => `${pack.id}-reference-${++id}`,
      }).filter(({ kindHint }) => kindHint === "reference");

      expect(references).toHaveLength(1);
      expect(references[0]).toMatchObject({
        content: currentPointer,
        metadata: {
          referenceKind: "source_of_truth",
          referencePointer: currentPointer,
        },
      });
    });

    it(`${pack.id} preserves only typed directive supersession`, () => {
      const supersededPointer = "archive/旧版-runbook.md";
      const analysis = {
        ...pack.analyzeContent(content),
        sourceOfTruthDirective: { currentPointer, supersededPointer },
      };
      let id = 0;
      const references = pack.extractCandidates({
        locale: pack.defaultLocale,
        messages: [{ analysis, content, role: "user" }],
        nextId: () => `${pack.id}-supersession-${++id}`,
      }).filter(({ kindHint }) => kindHint === "reference");

      expect(references).toHaveLength(1);
      expect(references[0]?.metadata).toMatchObject({
        referencePointer: currentPointer,
        supersedesPointer: supersededPointer,
      });
    });
  }
});

describe("LanguagePack structured host-action analysis", () => {
  for (const { content, pack } of [
    { content: "Copy '/src/report.txt' into '/backup/'.", pack: createEnglishLanguagePack() },
    { content: "把 '/src/report.txt' 复制到 '/backup/'。", pack: createChineseLanguagePack("Hans") },
    { content: "把 '/src/report.txt' 複製到 '/backup/'。", pack: createChineseLanguagePack("Hant") },
    { content: "'/src/report.txt' から '/backup/' へコピーしてください。", pack: createJapaneseLanguagePack() },
    { content: "'/src/report.txt'에서 '/backup/'로 복사하세요.", pack: createKoreanLanguagePack() },
    { content: "Copiez '/src/report.txt' vers '/backup/'.", pack: createFrenchLanguagePack() },
    { content: "Copia '/src/report.txt' a '/backup/'.", pack: createSpanishLanguagePack() },
  ]) {
    it(`${pack.id} emits canonical source, destination, and verb fields`, () => {
      expect(pack.analyzeBehavioralRule(content).hostAction).toMatchObject({
        destination: "/backup/",
        sources: ["/src/report.txt"],
        verb: "copy",
      });
    });
  }

  it("keeps concise computation parsing inside the English pack", () => {
    expect(
      createEnglishLanguagePack().analyzeBehavioralRule("In a rush: 25% of 96?")
        .conciseComputation,
    ).toEqual({ base: 96, kind: "percentage", percentage: 25 });
  });

  it("treats only an explicit quick request modifier as a brevity cue", () => {
    const pack = createEnglishLanguagePack();
    expect(pack.analyzeBehavioralRule("Quick: show the command.")).toMatchObject({
      responseStyle: "brief",
      semanticCues: expect.arrayContaining(["brevity"]),
    });

    for (const statement of [
      "The quick brown fox jumps over the lazy dog.",
      "Use the quick release valve for this operation.",
    ]) {
      const analysis = pack.analyzeBehavioralRule(statement);
      expect(analysis.responseStyle).toBeUndefined();
      expect(analysis.semanticCues ?? []).not.toContain("brevity");
    }
  });
});

describe("LanguagePack conformance", () => {
  for (const { pack, sample } of CASES) {
    describe(pack.id, () => {
      it("has stable identity and deterministic analyzers", () => {
        expect(pack.apiVersion).toBe(1);
        expect(pack.analyzerVersion.trim().length).toBeGreaterThan(0);
        expect(pack.defaultLocale.trim().length).toBeGreaterThan(0);
        expect(createLanguageService({
          defaultLocale: pack.defaultLocale,
          packs: [pack],
        }).resolveFromText({ locale: pack.defaultLocale, text: sample })
          .languagePackId).toBe(pack.id);
        expect(pack.normalizeForEquality(sample)).toBe(
          pack.normalizeForEquality(sample),
        );
        expect(pack.tokenizeForScoring(sample, "bm25")).toEqual(
          pack.tokenizeForScoring(sample, "bm25"),
        );
        expect(pack.analyzeQuery(sample)).toEqual(pack.analyzeQuery(sample));
        expect(pack.analyzeContent(sample)).toEqual(pack.analyzeContent(sample));
        expect(pack.analyzeBehavioralRule(sample)).toEqual(
          pack.analyzeBehavioralRule(sample),
        );
        if (pack.id === "neutral") {
          expect(pack.analyzeBehavioralRule("QuickCheck")).toEqual({
            firstActionName: undefined,
            formatRule: false,
            generalRule: false,
            negativeRule: false,
          });
        }
      });

      it("produces a stable, unique, bounded search sequence", () => {
        const service = createLanguageService({
          defaultLocale: pack.defaultLocale,
          packs: [pack],
        });
        const context = service.resolveFromText({
          locale: pack.defaultLocale,
          text: sample,
        });
        const first = service.buildSearchTerms(sample, context);
        const second = service.buildSearchTerms(sample, context);

        expect(first).toEqual(second);
        expect(first).toEqual([...new Set(first)]);
        expect(first.length).toBeLessThanOrEqual(128);
      });

      it("renders every public human-readable key", () => {
        for (const key of RENDER_KEYS) {
          expect(pack.render({
            key,
            values: {
              actor: "Alice",
              content: "Atlas",
              label: "status",
              relation: "supports",
              status: "current",
              value: "Atlas",
              workspace: "GoodMemory",
            },
          }).trim().length).toBeGreaterThan(0);
        }
      });
    });
  }
});
