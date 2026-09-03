import { describe, expect, it } from "bun:test";

import type { LanguagePack, LanguageRenderKey } from "../../../src/language/contracts";
import { createFrenchLanguagePack } from "../../../src/language/french";
import { createSpanishLanguagePack } from "../../../src/language/spanish";

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
  omitted_records: true,
  note: true,
  note_item: true,
  memory_context_frame: true,
  files: true,
  topic_active: true,
  topic_superseded: true,
  topic_archived: true,
  expertise: true,
  current_projects_and_goals: true,
  collaboration_preferences: true,
  stable_procedural_guidance: true,
  provenance_summary: true,
  omitted_sections: true,
  open_loops: true,
  organization: true,
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
  record_kind: true,
  record_ref: true,
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
  detail_tokens: true,
  temporal_status: true,
  temporary_decision: true,
  timezone: true,
  tool_result: true,
  undated: true,
  user_memory: true,
  user_memory_context: true,
  use_when: true,
  default_label: true,
  verification: true,
  workflow: true,
  working_memory: true,
  why: true,
  workspace_query_anchor: true,
} satisfies Record<LanguageRenderKey, true>) as LanguageRenderKey[];

function nextIdFactory(prefix: string): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

function expectPackContract(pack: LanguagePack, expected: {
  analyzerVersion?: string;
  defaultLocale: string;
  id: string;
  distinctive: string;
}): void {
  expect(pack).toMatchObject({
    analyzerVersion: expected.analyzerVersion ?? "1",
    apiVersion: 1,
    compatibilityGroup: expected.id,
    defaultLocale: expected.defaultLocale,
    id: expected.id,
  });
  expect(pack.locales).toContain(expected.id);
  expect(pack.detect({ texts: [expected.distinctive] })).toBe("distinctive");
  expect(pack.detect({ texts: ["Atlas API v2"] })).toBe("compatible");
  expect(pack.detect({ texts: ["現在の状態"] })).toBe("none");

  for (const key of RENDER_KEYS) {
    expect(pack.render({
      key,
      values: {
        count: 2,
        evidenceId: "e-1",
        highlight: "Atlas",
        memoryId: "m-1",
        sections: "profile",
        segments: "Atlas",
        sessionId: "s-1",
        workspace: "GoodMemory",
      },
    }).trim()).not.toBe("");
  }
}

describe("French LanguagePack", () => {
  const pack = createFrenchLanguagePack();

  it("has stable identity, disambiguated detection, and complete rendering", () => {
    expectPackContract(pack, {
      analyzerVersion: "13-explicit-compound-facts",
      defaultLocale: "fr-FR",
      distinctive: "Je préfère répondre en français.",
      id: "fr",
    });
    expect(pack.detect({ texts: ["¿Cuál es el bloqueo actual?"] })).toBe(
      "none",
    );
    expect(pack.render({ key: "durable_memory" })).toBe("Mémoire durable");
    expect(pack.detect({ texts: ["mot de passe : secret"] })).toBe(
      "distinctive",
    );
    expect(pack.analyzeContent("mot de passe : secret").sensitiveCredential).toBe(
      true,
    );
  });

  it("analyzes French queries and content without English fallbacks", () => {
    const query = pack.analyzeQuery(
      "Quels sont tous les blocages actuels et quelle procédure dois-je suivre ensuite ?",
    );
    expect(query).toMatchObject({
      actionDriving: true,
      blocker: true,
      current: true,
      exhaustiveList: true,
      guidanceSeeking: true,
      procedural: true,
      projectState: true,
    });

    const content = pack.analyzeContent(
      "Souviens-toi : mon rôle actuel est responsable du projet, mais le déploiement reste bloqué et je préfère des réponses concises.",
    );
    expect(content).toMatchObject({
      blockerFact: true,
      durableCue: true,
      factPolarity: "negative",
      personalEvidence: true,
      preferenceEvidence: true,
      roleFact: true,
      unresolved: true,
    });
  });

  it("covers every French query-analysis and durable-content signal", () => {
    const queryCases = [
      ["Déployer la prochaine étape.", "actionDriving"],
      ["Que s'est-il passé après la validation ?", "after"],
      ["Combien de tâches restent au total ?", "aggregateCount"],
      ["Rédiger une réponse concise.", "answerComposition"],
      ["Rappelle-moi ce que tu m'as dit.", "assistantEvidenceRecall"],
      ["Quel était l'état avant la validation ?", "before"],
      ["Quel est le blocage ?", "blocker"],
      ["Qu'est-ce qui a changé ?", "change"],
      ["Reprendre le travail de la dernière fois.", "continuation"],
      ["Quel est le rôle actuel ?", "current"],
      ["Qui dirige le projet Atlas ?", "directFactualLookup"],
      ["Liste toutes les tâches restantes.", "exhaustiveList"],
      ["Confirmer le rôle actuel.", "factConfirmation"],
      ["Quelle est ma priorité ?", "focus"],
      ["Quel format dois-je utiliser ?", "guidanceSeeking"],
      ["Quel est l'historique du projet ?", "history"],
      ["Quelle tâche ouverte reste à faire ?", "openLoop"],
      ["Quelle procédure dois-je suivre ?", "procedural"],
      ["Quel est l'état du projet ?", "projectState"],
      ["Quelle recommandation proposes-tu ?", "recommendationStyle"],
      ["Quel document de référence faut-il consulter ?", "referenceSeeking"],
      ["Comment Atlas est-il lié à Lisbonne ?", "relation"],
      ["Quel est mon rôle ?", "role"],
      ["Donne dans l'ordre ce que j'ai mentionné.", "userGroundedEventOrder"],
    ] as const;
    for (const [query, signal] of queryCases) {
      expect(pack.analyzeQuery(query)[signal], `${signal}: ${query}`).toBe(true);
    }

    const contentCases = [
      ["Compris.", "assistantAcknowledgement"],
      ["Nous allons continuer avec la prochaine étape.", "assistantContinuity"],
      ["Le déploiement est bloqué.", "blockerFact"],
      ["Correction : remplacer l'ancien guide.", "correctionCue"],
      ["Souviens-toi de mon rôle actuel.", "durableCue"],
      ["Ma priorité actuelle est la qualité.", "focusFact"],
      ["Cette tâche ouverte reste à faire.", "openLoopFact"],
      ["Je préfère les réponses concises.", "personalEvidence"],
      ["Je préfère les réponses concises.", "preferenceEvidence"],
      ["Le prochain jalon est en attente.", "projectStateFact"],
      ["Mon rôle actuel est ingénieure plateforme.", "roleFact"],
      ["mot de passe : valeur-ordinaire", "sensitiveCredential"],
      ["Le suivi reste en attente.", "unresolved"],
    ] as const;
    for (const [content, signal] of contentCases) {
      expect(pack.analyzeContent(content)[signal], `${signal}: ${content}`).toBe(
        true,
      );
    }
    expect(pack.analyzeContent("Le déploiement est bloqué.").factPolarity).toBe(
      "negative",
    );
    expect(pack.analyzeContent("Le déploiement est stable et terminé.").factPolarity)
      .toBe("positive");
    expect(pack.analyzeContent("Ne publie jamais sans revue.").feedbackKind).toBe(
      "dont",
    );
    expect(pack.analyzeContent("Je préfère ce format.").feedbackKind).toBe(
      "prefer",
    );
    expect(pack.analyzeContent("Cette méthode a bien fonctionné.").feedbackKind)
      .toBe("validated_pattern");
  });

  it("tokenizes, decomposes, parses time, and extracts entities", () => {
    expect(
      pack.tokenizeForScoring(
        "Le déploiement de l'équipe est bloqué.",
        "overlap",
        { excludeStopwords: true },
      ),
    ).toEqual(expect.arrayContaining(["déploiement", "équipe", "bloqué"]));
    expect(pack.buildSearchTerms("Le déploiement, le déploiement.")).toEqual([
      "déploiement",
    ]);
    expect(
      pack.decomposeQuery(
        "Quel est le blocage et quelle est la prochaine étape ?",
      ),
    ).toEqual(["Quel est le blocage", "quelle est la prochaine étape"]);
    expect(pack.parseTemporalExpressions("hier et le 14 juillet 2026")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "relative", offset: -1, unit: "day" }),
        expect.objectContaining({
          calendar: { day: 14, month: 7, year: 2026 },
          kind: "absolute",
        }),
      ]),
    );
    expect(
      pack.extractEntityMentions(
        "Camille Martin travaille chez Société Générale sur PROJ-42.",
      ),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "Camille Martin" }),
      expect.objectContaining({ surface: "Société Générale" }),
      expect.objectContaining({ kind: "identifier", surface: "PROJ-42" }),
    ]));
  });

  it("extracts only strongly signaled durable French candidates", () => {
    const candidates = pack.extractCandidates({
      locale: "fr-FR",
      messages: [
        { role: "user", content: "Je m'appelle Camille Martin." },
        { role: "user", content: "Je préfère des réponses concises." },
        {
          role: "user",
          content: "Utilise docs/guide.md comme source de vérité.",
        },
        {
          role: "user",
          content: "Souviens-toi que le déploiement est bloqué par la validation.",
        },
        { role: "user", content: "Ne publie jamais sans revue." },
        { role: "user", content: "Le temps est agréable aujourd'hui." },
      ],
      nextId: nextIdFactory("fr"),
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "Camille Martin",
        kindHint: "profile",
        metadata: expect.objectContaining({ profileField: "name" }),
      }),
      expect.objectContaining({ kindHint: "preference" }),
      expect.objectContaining({
        content: "docs/guide.md",
        kindHint: "reference",
      }),
      expect.objectContaining({
        kindHint: "fact",
        metadata: expect.objectContaining({ factKind: "blocker" }),
      }),
      expect.objectContaining({
        kindHint: "feedback",
        metadata: expect.objectContaining({ feedbackKind: "dont" }),
      }),
    ]));
    expect(candidates.some(({ content }) => content.includes("agréable"))).toBe(
      false,
    );
  });
});

describe("Spanish LanguagePack", () => {
  const pack = createSpanishLanguagePack();

  it("has stable identity, disambiguated detection, and complete rendering", () => {
    expectPackContract(pack, {
      analyzerVersion: "12-explicit-compound-facts",
      defaultLocale: "es-ES",
      distinctive: "¿Cuál es el bloqueo actual?",
      id: "es",
    });
    expect(pack.detect({ texts: ["Je préfère répondre en français."] })).toBe(
      "none",
    );
    expect(pack.render({ key: "durable_memory" })).toBe("Memoria duradera");
  });

  it("analyzes Spanish queries and content without English fallbacks", () => {
    const query = pack.analyzeQuery(
      "¿Cuáles son todos los bloqueos actuales y qué procedimiento debo seguir después?",
    );
    expect(query).toMatchObject({
      actionDriving: true,
      after: true,
      blocker: true,
      current: true,
      exhaustiveList: true,
      guidanceSeeking: true,
      procedural: true,
      projectState: true,
    });

    const content = pack.analyzeContent(
      "Recuerda: mi función actual es responsable del proyecto, pero el despliegue sigue bloqueado y prefiero respuestas concisas.",
    );
    expect(content).toMatchObject({
      blockerFact: true,
      durableCue: true,
      factPolarity: "negative",
      personalEvidence: true,
      preferenceEvidence: true,
      roleFact: true,
      unresolved: true,
    });
  });

  it("covers every Spanish query-analysis and durable-content signal", () => {
    const queryCases = [
      ["Desplegar el próximo paso.", "actionDriving"],
      ["¿Qué pasó después de la validación?", "after"],
      ["¿Cuántas tareas quedan en total?", "aggregateCount"],
      ["Redactar una respuesta concisa.", "answerComposition"],
      ["Recuérdame lo que me dijiste.", "assistantEvidenceRecall"],
      ["¿Cuál era el estado antes de la validación?", "before"],
      ["¿Cuál es el bloqueo?", "blocker"],
      ["¿Qué cambió?", "change"],
      ["Retomar el trabajo de la última vez.", "continuation"],
      ["¿Cuál es el rol actual?", "current"],
      ["¿Quién dirige el proyecto Atlas?", "directFactualLookup"],
      ["Lista todas las tareas restantes.", "exhaustiveList"],
      ["Confirma el rol actual.", "factConfirmation"],
      ["¿Cuál es mi prioridad?", "focus"],
      ["¿Qué formato debo utilizar?", "guidanceSeeking"],
      ["¿Cuál es el historial del proyecto?", "history"],
      ["¿Qué tarea pendiente queda por hacer?", "openLoop"],
      ["¿Qué procedimiento debo seguir?", "procedural"],
      ["¿Cuál es el estado del proyecto?", "projectState"],
      ["¿Qué recomendación propones?", "recommendationStyle"],
      ["¿Qué documento de referencia debemos consultar?", "referenceSeeking"],
      ["¿Cómo está Atlas relacionado con Lisboa?", "relation"],
      ["¿Cuál es mi rol?", "role"],
      ["Dame en orden lo que yo mencioné.", "userGroundedEventOrder"],
    ] as const;
    for (const [query, signal] of queryCases) {
      expect(pack.analyzeQuery(query)[signal], `${signal}: ${query}`).toBe(true);
    }

    const contentCases = [
      ["Entendido.", "assistantAcknowledgement"],
      ["Vamos a continuar con el próximo paso.", "assistantContinuity"],
      ["El despliegue está bloqueado.", "blockerFact"],
      ["Corrección: reemplazar la guía anterior.", "correctionCue"],
      ["Recuerda mi rol actual.", "durableCue"],
      ["Mi prioridad actual es la calidad.", "focusFact"],
      ["Esta tarea pendiente queda por hacer.", "openLoopFact"],
      ["Yo prefiero respuestas concisas.", "personalEvidence"],
      ["Yo prefiero respuestas concisas.", "preferenceEvidence"],
      ["El próximo hito está pendiente.", "projectStateFact"],
      ["Mi rol actual es ingeniera de plataforma.", "roleFact"],
      ["contraseña: valor-ordinario", "sensitiveCredential"],
      ["El seguimiento sigue pendiente.", "unresolved"],
    ] as const;
    for (const [content, signal] of contentCases) {
      expect(pack.analyzeContent(content)[signal], `${signal}: ${content}`).toBe(
        true,
      );
    }
    expect(pack.analyzeContent("El despliegue está bloqueado.").factPolarity).toBe(
      "negative",
    );
    expect(pack.analyzeContent("El despliegue está estable y terminado.").factPolarity)
      .toBe("positive");
    expect(pack.analyzeContent("Nunca publiques sin revisión.").feedbackKind).toBe(
      "dont",
    );
    expect(pack.analyzeContent("Yo prefiero este formato.").feedbackKind).toBe(
      "prefer",
    );
    expect(pack.analyzeContent("Este método funcionó bien.").feedbackKind).toBe(
      "validated_pattern",
    );
  });

  it("tokenizes, decomposes, parses time, and extracts entities", () => {
    expect(
      pack.tokenizeForScoring(
        "El despliegue del equipo está bloqueado.",
        "overlap",
        { excludeStopwords: true },
      ),
    ).toEqual(expect.arrayContaining(["despliegue", "equipo", "bloqueado"]));
    expect(pack.buildSearchTerms("El despliegue, el despliegue.")).toEqual([
      "despliegue",
    ]);
    expect(
      pack.decomposeQuery(
        "¿Cuál es el bloqueo y cuál es el próximo paso?",
      ),
    ).toEqual(["¿Cuál es el bloqueo", "cuál es el próximo paso"]);
    expect(pack.parseTemporalExpressions("ayer y el 14 de julio de 2026")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "relative", offset: -1, unit: "day" }),
        expect.objectContaining({
          calendar: { day: 14, month: 7, year: 2026 },
          kind: "absolute",
        }),
      ]),
    );
    expect(
      pack.extractEntityMentions(
        "Lucía Torres trabaja en Banco Santander sobre PROY-42.",
      ),
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "Lucía Torres" }),
      expect.objectContaining({ surface: "Banco Santander" }),
      expect.objectContaining({ kind: "identifier", surface: "PROY-42" }),
    ]));
  });

  it("extracts only strongly signaled durable Spanish candidates", () => {
    const candidates = pack.extractCandidates({
      locale: "es-ES",
      messages: [
        { role: "user", content: "Me llamo Lucía Torres." },
        { role: "user", content: "Prefiero respuestas concisas." },
        {
          role: "user",
          content: "Usa docs/guia.md como fuente de verdad.",
        },
        {
          role: "user",
          content: "Recuerda que el despliegue está bloqueado por la validación.",
        },
        { role: "user", content: "Nunca publiques sin revisión." },
        { role: "user", content: "Hace buen tiempo hoy." },
      ],
      nextId: nextIdFactory("es"),
    });

    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "Lucía Torres",
        kindHint: "profile",
        metadata: expect.objectContaining({ profileField: "name" }),
      }),
      expect.objectContaining({ kindHint: "preference" }),
      expect.objectContaining({
        content: "docs/guia.md",
        kindHint: "reference",
      }),
      expect.objectContaining({
        kindHint: "fact",
        metadata: expect.objectContaining({ factKind: "blocker" }),
      }),
      expect.objectContaining({
        kindHint: "feedback",
        metadata: expect.objectContaining({ feedbackKind: "dont" }),
      }),
    ]));
    expect(candidates.some(({ content }) => content.includes("buen tiempo"))).toBe(
      false,
    );
  });
});
