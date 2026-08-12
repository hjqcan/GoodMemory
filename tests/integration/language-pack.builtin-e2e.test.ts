import { describe, expect, it } from "bun:test";

import { createGoodMemory } from "../../src";
import {
  CLAIM_PROJECTIONS_COLLECTION,
  ENTITIES_COLLECTION,
  RECALL_DOCUMENTS_COLLECTION,
  type ClaimProjection,
  type EntityAdjacencyProjection,
  type RecallIndexDocument,
} from "../../src/recall/projections/contracts";
import {
  createInMemoryDocumentStore,
  createInMemorySessionStore,
} from "../../src/storage/memory";

const CASES = [
  {
    analyzerVersion: "4-explicit-fact-list-boundary",
    blocker: "법무 승인",
    contextHeading: "## 사실",
    countQuery: "미완료 항목은 총 몇 건입니까?",
    currentQuery: "현재 서울대학교 Atlas 프로젝트의 장애 요인은 무엇입니까?",
    fact:
      "기억해 주세요, 현재 서울대학교 Atlas 프로젝트의 장애 요인은 법무 승인입니다.",
    locale: "ko-KR",
    packId: "ko",
    referencePointer: "docs/ko-runbook.md",
    referenceQuery: "docs/ko-runbook.md 기준 문서를 참조해야 합니까?",
    referenceStatement:
      "docs/ko-runbook.md를 현재 기준 문서로 사용하세요.",
    continuationQuery: "지난 작업을 계속 진행해 주세요.",
    subject: "서울대학교 Atlas 프로젝트",
  },
  {
    analyzerVersion: "6-explicit-fact-list-boundary",
    blocker: "l’approbation juridique",
    contextHeading: "## Faits",
    countQuery: "Combien de tâches ouvertes restent au total ?",
    currentQuery: "Quel est le blocage actuel du Projet Atlas ?",
    fact:
      "Souviens-toi que le blocage actuel du Projet Atlas est l’approbation juridique.",
    locale: "fr-FR",
    packId: "fr",
    referencePointer: "docs/fr-guide.md",
    referenceQuery: "Faut-il consulter le document de référence docs/fr-guide.md ?",
    referenceStatement:
      "Utilise docs/fr-guide.md comme source de vérité.",
    continuationQuery: "Reprends le travail de la dernière fois.",
    subject: "Projet Atlas",
  },
  {
    analyzerVersion: "5-explicit-fact-list-boundary",
    blocker: "la aprobación jurídica",
    contextHeading: "## Hechos",
    countQuery: "¿Cuántas tareas pendientes hay en total?",
    currentQuery: "¿Cuál es el bloqueo actual del Proyecto Atlas?",
    fact:
      "Recuerda que el bloqueo actual del Proyecto Atlas es la aprobación jurídica.",
    locale: "es-ES",
    packId: "es",
    referencePointer: "docs/es-guia.md",
    referenceQuery: "¿Debemos consultar el documento de referencia docs/es-guia.md?",
    referenceStatement:
      "Usa docs/es-guia.md como la fuente de verdad.",
    continuationQuery: "Continúa con el trabajo de la última vez.",
    subject: "Proyecto Atlas",
  },
] as const;

describe("built-in LanguagePack end-to-end integration", () => {
  for (const testCase of CASES) {
    it(`runs ${testCase.locale} through remember, projections, recall, and context`, async () => {
      const documentStore = createInMemoryDocumentStore();
      const memory = createGoodMemory({
        adapters: {
          documentStore,
          sessionStore: createInMemorySessionStore(),
        },
        language: { defaultLocale: testCase.locale },
        retrieval: { preset: "recommended", recallPlanExecution: true },
        testing: {
          now: () => new Date("2026-07-21T12:00:00.000Z"),
        },
      });
      const scope = {
        sessionId: `session-${testCase.packId}`,
        userId: `user-${testCase.packId}`,
        workspaceId: `workspace-${testCase.packId}`,
      };

      const remembered = await memory.remember({
        annotations: [{
          kindHint: "fact",
          messageIndex: 0,
          metadataPatch: {
            category: "project",
            claim: {
              modality: "asserted",
              objectEntity: testCase.blocker,
              objectText: testCase.blocker,
              polarity: "positive",
              predicateKey: "project.blocker",
            },
            factKind: "blocker",
            scopeKind: "project",
            subject: testCase.subject,
          },
          remember: "always",
        }],
        locale: testCase.locale,
        messages: [
          { role: "user", content: testCase.fact },
          { role: "user", content: testCase.referenceStatement },
        ],
        scope,
      });
      const exported = await memory.exportMemory({ scope });
      const fact = exported.durable.facts.find(({ content }) =>
        content.includes(testCase.blocker)
      );
      const reference = exported.durable.references.find(
        ({ pointer }) => pointer === testCase.referencePointer,
      );

      expect(remembered.metadata).toMatchObject({
        languagePackId: testCase.packId,
        locale: testCase.locale,
      });
      expect(fact?.source).toMatchObject({
        languagePackId: testCase.packId,
        locale: testCase.locale,
      });
      expect(reference?.source).toMatchObject({
        languagePackId: testCase.packId,
        locale: testCase.locale,
      });

      const current = await memory.recall({
        locale: testCase.locale,
        query: testCase.currentQuery,
        scope,
      });
      const context = await memory.buildContext({
        output: "markdown",
        recall: current,
      });
      const referenceRecall = await memory.recall({
        locale: testCase.locale,
        query: testCase.referenceQuery,
        scope,
      });
      const countRecall = await memory.recall({
        locale: testCase.locale,
        query: testCase.countQuery,
        scope,
      });
      const continuationRecall = await memory.recall({
        locale: testCase.locale,
        query: testCase.continuationQuery,
        scope,
      });

      expect(current.metadata).toMatchObject({
        languagePackId: testCase.packId,
        locale: testCase.locale,
      });
      expect(current.facts.some(({ content }) =>
        content.includes(testCase.blocker)
      )).toBe(true);
      expect(current.metadata.routingDecision).toMatchObject({
        requestedSlots: expect.arrayContaining(["blocker"]),
      });
      expect(current.metadata.retrievalTrace).toMatchObject({
        schemaVersion: 2,
        plan: {
          aggregation: "current",
          temporalConstraints: [{
            kind: "current",
            referenceTime: "2026-07-21T12:00:00.000Z",
          }],
        },
      });
      expect(context.content).toContain(testCase.contextHeading);
      expect(context.content).toContain(testCase.blocker);
      expect(referenceRecall.references.some(
        ({ pointer }) => pointer === testCase.referencePointer,
      )).toBe(true);
      expect(referenceRecall.metadata.routingDecision.referenceSeeking).toBe(
        true,
      );
      expect(countRecall.metadata.retrievalTrace).toMatchObject({
        schemaVersion: 2,
        plan: { aggregation: "count" },
      });
      expect(continuationRecall.metadata.routingDecision.continuation).toBe(
        true,
      );
      expect(continuationRecall.metadata.retrievalTrace).toMatchObject({
        schemaVersion: 2,
        plan: { planes: expect.arrayContaining(["runtime"]) },
      });

      const [documents, entities, claims] = await Promise.all([
        documentStore.query<RecallIndexDocument>(RECALL_DOCUMENTS_COLLECTION),
        documentStore.query<EntityAdjacencyProjection>(ENTITIES_COLLECTION),
        documentStore.query<ClaimProjection>(CLAIM_PROJECTIONS_COLLECTION),
      ]);
      const languageDocuments = documents.filter(
        ({ languagePackId }) => languagePackId === testCase.packId,
      );
      const languageEntities = entities.filter(
        ({ languagePackId }) => languagePackId === testCase.packId,
      );
      const languageClaims = claims.filter(
        ({ languagePackId }) => languagePackId === testCase.packId,
      );

      expect(languageDocuments.length).toBeGreaterThan(0);
      expect(languageEntities.length).toBeGreaterThan(0);
      expect(languageClaims.length).toBeGreaterThan(0);
      for (const projection of [
        ...languageDocuments,
        ...languageEntities,
        ...languageClaims,
      ]) {
        expect(projection).toMatchObject({
          languagePackId: testCase.packId,
          searchAnalyzerVersion: testCase.analyzerVersion,
          searchLocale: testCase.locale,
        });
        expect(projection.searchText.trim().length).toBeGreaterThan(0);
      }
      expect(languageDocuments.some(({ provenance }) =>
        provenance.languagePackId === testCase.packId &&
        provenance.locale === testCase.locale
      )).toBe(true);
    });
  }
});
