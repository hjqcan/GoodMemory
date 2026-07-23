import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  PreferenceMemory,
  ReferenceMemory,
  SessionBuffer,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { EvidenceRecord } from "../evidence/contracts";
import { EVIDENCE_COLLECTION } from "../evidence/contracts";
import type {
  ExperienceRecord,
  LearningProposal,
  PromotionRecord,
  SessionArchive,
} from "../domain/evolutionRecords";
import {
  EXPERIENCES_COLLECTION,
  LEARNING_PROPOSALS_COLLECTION,
  PROMOTION_RECORDS_COLLECTION,
  SESSION_ARCHIVES_COLLECTION,
} from "../domain/evolutionRecords";
import type {
  DocumentStore,
  SessionStore,
  StorageFilter,
  VectorRecord,
  VectorSearchInput,
  VectorStore,
} from "./contracts";

export interface MemoryRepositoriesConfig {
  documentStore: DocumentStore;
  sessionStore: SessionStore;
  vectorStore?: VectorStore;
}

// All `add` methods persist by id with overwrite (upsert) semantics — they are
// backed by DocumentStore.set, not an append. Maintenance depends on this:
// dedupe/ttlExpiry demote a record by re-adding its superseded copy under the
// same id. `upsert` is used where the type is a per-scope singleton or keyed
// value; `add` where callers usually mint a fresh id — but a reused id always
// replaces the stored record either way.
export interface MemoryRepositories {
  profiles: {
    upsert(profile: UserProfile): Promise<void>;
    get(userId: string): Promise<UserProfile | null>;
  };
  preferences: {
    upsert(preference: PreferenceMemory): Promise<void>;
    get(id: string): Promise<PreferenceMemory | null>;
    listByUser(userId: string): Promise<PreferenceMemory[]>;
    listByScope(scope: MemoryScope): Promise<PreferenceMemory[]>;
  };
  references: {
    add(reference: ReferenceMemory): Promise<void>;
    get(id: string): Promise<ReferenceMemory | null>;
    listByUser(userId: string): Promise<ReferenceMemory[]>;
    listByScope(scope: MemoryScope): Promise<ReferenceMemory[]>;
  };
  facts: {
    add(fact: FactMemory): Promise<void>;
    get(id: string): Promise<FactMemory | null>;
    listByUser(userId: string): Promise<FactMemory[]>;
    listByScope(scope: MemoryScope): Promise<FactMemory[]>;
  };
  episodes: {
    add(episode: EpisodeMemory): Promise<void>;
    get(id: string): Promise<EpisodeMemory | null>;
    listByUser(userId: string): Promise<EpisodeMemory[]>;
    listByScope(scope: MemoryScope): Promise<EpisodeMemory[]>;
  };
  feedback: {
    upsert(feedback: FeedbackMemory): Promise<void>;
    get(id: string): Promise<FeedbackMemory | null>;
    listByUser(userId: string): Promise<FeedbackMemory[]>;
    listByScope(scope: MemoryScope): Promise<FeedbackMemory[]>;
  };
  archives: {
    add(archive: SessionArchive): Promise<void>;
    get(id: string): Promise<SessionArchive | null>;
    listByUser(userId: string): Promise<SessionArchive[]>;
    listByScope(scope: MemoryScope): Promise<SessionArchive[]>;
  };
  evidence: {
    add(evidence: EvidenceRecord): Promise<void>;
    get(id: string): Promise<EvidenceRecord | null>;
    listByUser(userId: string): Promise<EvidenceRecord[]>;
    listByScope(scope: MemoryScope): Promise<EvidenceRecord[]>;
  };
  experiences: {
    add(experience: ExperienceRecord): Promise<void>;
    get(id: string): Promise<ExperienceRecord | null>;
    listByUser(userId: string): Promise<ExperienceRecord[]>;
    listByScope(scope: MemoryScope): Promise<ExperienceRecord[]>;
  };
  proposals: {
    add(proposal: LearningProposal): Promise<void>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<LearningProposal | null>;
    listByUser(userId: string): Promise<LearningProposal[]>;
    listByScope(scope: MemoryScope): Promise<LearningProposal[]>;
  };
  promotions: {
    add(promotion: PromotionRecord): Promise<void>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<PromotionRecord | null>;
    listByUser(userId: string): Promise<PromotionRecord[]>;
    listByScope(scope: MemoryScope): Promise<PromotionRecord[]>;
  };
  sessionBuffers: {
    save(scope: MemoryScope, buffer: SessionBuffer): Promise<void>;
    get(scope: MemoryScope): Promise<SessionBuffer | null>;
  };
  workingMemory: {
    save(scope: MemoryScope, snapshot: WorkingMemorySnapshot): Promise<void>;
    get(scope: MemoryScope): Promise<WorkingMemorySnapshot | null>;
  };
  sessionJournals: {
    save(scope: MemoryScope, journal: SessionJournal): Promise<void>;
    get(scope: MemoryScope): Promise<SessionJournal | null>;
  };
  vectorIndex: {
    upsertFactEmbedding(
      records: Array<{
        id: string;
        embedding: number[];
        metadata: Record<string, unknown>;
        content: string;
      }>,
    ): Promise<void>;
    searchFactEmbedding(
      queryEmbedding: number[],
      input: VectorSearchInput,
    ): Promise<
      Array<{
        id: string;
        embedding: number[];
        metadata: Record<string, unknown>;
        content: string;
        score: number;
      }>
    >;
    getFactEmbedding(id: string): Promise<VectorRecord | null>;
    deleteFactEmbedding(id: string): Promise<void>;
    upsertReferenceEmbedding(
      records: Array<{
        id: string;
        embedding: number[];
        metadata: Record<string, unknown>;
        content: string;
      }>,
    ): Promise<void>;
    searchReferenceEmbedding(
      queryEmbedding: number[],
      input: VectorSearchInput,
    ): Promise<
      Array<{
        id: string;
        embedding: number[];
        metadata: Record<string, unknown>;
        content: string;
        score: number;
      }>
    >;
    getReferenceEmbedding(id: string): Promise<VectorRecord | null>;
    deleteReferenceEmbedding(id: string): Promise<void>;
    upsertEpisodeEmbedding(
      records: Array<{
        id: string;
        embedding: number[];
        metadata: Record<string, unknown>;
        content: string;
      }>,
    ): Promise<void>;
    searchEpisodeEmbedding(
      queryEmbedding: number[],
      input: VectorSearchInput,
    ): Promise<
      Array<{
        id: string;
        embedding: number[];
        metadata: Record<string, unknown>;
        content: string;
        score: number;
      }>
    >;
    getEpisodeEmbedding(id: string): Promise<VectorRecord | null>;
    deleteEpisodeEmbedding(id: string): Promise<void>;
  } | null;
}

export function createMemoryRepositories(
  config: MemoryRepositoriesConfig,
): MemoryRepositories {
  function buildScopeFilter(scope: MemoryScope): StorageFilter {
    return Object.fromEntries(
      Object.entries({
        userId: scope.userId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agentId: scope.agentId,
      }).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  }

  return {
    profiles: {
      async upsert(profile: UserProfile): Promise<void> {
        await config.documentStore.set("profiles", profile.userId, profile);
      },

      async get(userId: string): Promise<UserProfile | null> {
        return config.documentStore.get<UserProfile>("profiles", userId);
      },
    },

    preferences: {
      async upsert(preference: PreferenceMemory): Promise<void> {
        await config.documentStore.set("preferences", preference.id, preference);
      },

      async get(id: string): Promise<PreferenceMemory | null> {
        return config.documentStore.get<PreferenceMemory>("preferences", id);
      },

      async listByUser(userId: string): Promise<PreferenceMemory[]> {
        return config.documentStore.query<PreferenceMemory>("preferences", {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<PreferenceMemory[]> {
        return config.documentStore.query<PreferenceMemory>(
          "preferences",
          buildScopeFilter(scope),
        );
      },
    },

    references: {
      async add(reference: ReferenceMemory): Promise<void> {
        await config.documentStore.set("references", reference.id, reference);
      },

      async get(id: string): Promise<ReferenceMemory | null> {
        return config.documentStore.get<ReferenceMemory>("references", id);
      },

      async listByUser(userId: string): Promise<ReferenceMemory[]> {
        return config.documentStore.query<ReferenceMemory>("references", {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<ReferenceMemory[]> {
        return config.documentStore.query<ReferenceMemory>(
          "references",
          buildScopeFilter(scope),
        );
      },
    },

    facts: {
      async add(fact: FactMemory): Promise<void> {
        await config.documentStore.set("facts", fact.id, fact);
      },

      async get(id: string): Promise<FactMemory | null> {
        return config.documentStore.get<FactMemory>("facts", id);
      },

      async listByUser(userId: string): Promise<FactMemory[]> {
        return config.documentStore.query<FactMemory>("facts", {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<FactMemory[]> {
        return config.documentStore.query<FactMemory>("facts", buildScopeFilter(scope));
      },
    },

    episodes: {
      async add(episode: EpisodeMemory): Promise<void> {
        await config.documentStore.set("episodes", episode.id, episode);
      },

      async get(id: string): Promise<EpisodeMemory | null> {
        return config.documentStore.get<EpisodeMemory>("episodes", id);
      },

      async listByUser(userId: string): Promise<EpisodeMemory[]> {
        return config.documentStore.query<EpisodeMemory>("episodes", {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<EpisodeMemory[]> {
        return config.documentStore.query<EpisodeMemory>(
          "episodes",
          buildScopeFilter(scope),
        );
      },
    },

    feedback: {
      async upsert(feedback: FeedbackMemory): Promise<void> {
        await config.documentStore.set("feedback", feedback.id, feedback);
      },

      async get(id: string): Promise<FeedbackMemory | null> {
        return config.documentStore.get<FeedbackMemory>("feedback", id);
      },

      async listByUser(userId: string): Promise<FeedbackMemory[]> {
        return config.documentStore.query<FeedbackMemory>("feedback", {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<FeedbackMemory[]> {
        return config.documentStore.query<FeedbackMemory>(
          "feedback",
          buildScopeFilter(scope),
        );
      },
    },

    archives: {
      async add(archive: SessionArchive): Promise<void> {
        await config.documentStore.set(SESSION_ARCHIVES_COLLECTION, archive.id, archive);
      },

      async get(id: string): Promise<SessionArchive | null> {
        return config.documentStore.get<SessionArchive>(SESSION_ARCHIVES_COLLECTION, id);
      },

      async listByUser(userId: string): Promise<SessionArchive[]> {
        return config.documentStore.query<SessionArchive>(SESSION_ARCHIVES_COLLECTION, {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<SessionArchive[]> {
        return config.documentStore.query<SessionArchive>(
          SESSION_ARCHIVES_COLLECTION,
          buildScopeFilter(scope),
        );
      },
    },

    evidence: {
      async add(evidence: EvidenceRecord): Promise<void> {
        await config.documentStore.set(EVIDENCE_COLLECTION, evidence.id, evidence);
      },

      async get(id: string): Promise<EvidenceRecord | null> {
        return config.documentStore.get<EvidenceRecord>(EVIDENCE_COLLECTION, id);
      },

      async listByUser(userId: string): Promise<EvidenceRecord[]> {
        return config.documentStore.query<EvidenceRecord>(EVIDENCE_COLLECTION, {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<EvidenceRecord[]> {
        return config.documentStore.query<EvidenceRecord>(
          EVIDENCE_COLLECTION,
          buildScopeFilter(scope),
        );
      },
    },

    experiences: {
      async add(experience: ExperienceRecord): Promise<void> {
        await config.documentStore.set(EXPERIENCES_COLLECTION, experience.id, experience);
      },

      async get(id: string): Promise<ExperienceRecord | null> {
        return config.documentStore.get<ExperienceRecord>(EXPERIENCES_COLLECTION, id);
      },

      async listByUser(userId: string): Promise<ExperienceRecord[]> {
        return config.documentStore.query<ExperienceRecord>(EXPERIENCES_COLLECTION, {
          userId,
        });
      },

      async listByScope(scope: MemoryScope): Promise<ExperienceRecord[]> {
        return config.documentStore.query<ExperienceRecord>(
          EXPERIENCES_COLLECTION,
          buildScopeFilter(scope),
        );
      },
    },

    proposals: {
      async add(proposal: LearningProposal): Promise<void> {
        await config.documentStore.set(
          LEARNING_PROPOSALS_COLLECTION,
          proposal.id,
          proposal,
        );
      },

      async delete(id: string): Promise<void> {
        await config.documentStore.delete(LEARNING_PROPOSALS_COLLECTION, id);
      },

      async get(id: string): Promise<LearningProposal | null> {
        return config.documentStore.get<LearningProposal>(
          LEARNING_PROPOSALS_COLLECTION,
          id,
        );
      },

      async listByUser(userId: string): Promise<LearningProposal[]> {
        return config.documentStore.query<LearningProposal>(
          LEARNING_PROPOSALS_COLLECTION,
          {
            userId,
          },
        );
      },

      async listByScope(scope: MemoryScope): Promise<LearningProposal[]> {
        return config.documentStore.query<LearningProposal>(
          LEARNING_PROPOSALS_COLLECTION,
          buildScopeFilter(scope),
        );
      },
    },

    promotions: {
      async add(promotion: PromotionRecord): Promise<void> {
        await config.documentStore.set(
          PROMOTION_RECORDS_COLLECTION,
          promotion.id,
          promotion,
        );
      },

      async delete(id: string): Promise<void> {
        await config.documentStore.delete(PROMOTION_RECORDS_COLLECTION, id);
      },

      async get(id: string): Promise<PromotionRecord | null> {
        return config.documentStore.get<PromotionRecord>(
          PROMOTION_RECORDS_COLLECTION,
          id,
        );
      },

      async listByUser(userId: string): Promise<PromotionRecord[]> {
        return config.documentStore.query<PromotionRecord>(
          PROMOTION_RECORDS_COLLECTION,
          {
            userId,
          },
        );
      },

      async listByScope(scope: MemoryScope): Promise<PromotionRecord[]> {
        return config.documentStore.query<PromotionRecord>(
          PROMOTION_RECORDS_COLLECTION,
          buildScopeFilter(scope),
        );
      },
    },

    sessionBuffers: {
      save(scope: MemoryScope, buffer: SessionBuffer): Promise<void> {
        return config.sessionStore.saveBuffer(scope, buffer);
      },

      get(scope: MemoryScope): Promise<SessionBuffer | null> {
        return config.sessionStore.getBuffer(scope);
      },
    },

    workingMemory: {
      save(scope: MemoryScope, snapshot: WorkingMemorySnapshot): Promise<void> {
        return config.sessionStore.saveWorkingMemory(scope, snapshot);
      },

      get(scope: MemoryScope): Promise<WorkingMemorySnapshot | null> {
        return config.sessionStore.getWorkingMemory(scope);
      },
    },

    sessionJournals: {
      save(scope: MemoryScope, journal: SessionJournal): Promise<void> {
        return config.sessionStore.saveJournal(scope, journal);
      },

      get(scope: MemoryScope): Promise<SessionJournal | null> {
        return config.sessionStore.getJournal(scope);
      },
    },

    vectorIndex: config.vectorStore
      ? {
          upsertFactEmbedding: config.vectorStore.upsert.bind(
            config.vectorStore,
            "facts",
          ),
          searchFactEmbedding: (
            queryEmbedding: number[],
            input: VectorSearchInput,
          ) => config.vectorStore!.search("facts", queryEmbedding, input),
          getFactEmbedding: (id: string) => config.vectorStore!.get("facts", id),
          deleteFactEmbedding: (id: string) => config.vectorStore!.delete("facts", id),
          upsertReferenceEmbedding: config.vectorStore.upsert.bind(
            config.vectorStore,
            "references",
          ),
          searchReferenceEmbedding: (
            queryEmbedding: number[],
            input: VectorSearchInput,
          ) => config.vectorStore!.search("references", queryEmbedding, input),
          getReferenceEmbedding: (id: string) => config.vectorStore!.get("references", id),
          deleteReferenceEmbedding: (id: string) =>
            config.vectorStore!.delete("references", id),
          upsertEpisodeEmbedding: config.vectorStore.upsert.bind(
            config.vectorStore,
            "episodes",
          ),
          searchEpisodeEmbedding: (
            queryEmbedding: number[],
            input: VectorSearchInput,
          ) => config.vectorStore!.search("episodes", queryEmbedding, input),
          getEpisodeEmbedding: (id: string) => config.vectorStore!.get("episodes", id),
          deleteEpisodeEmbedding: (id: string) => config.vectorStore!.delete("episodes", id),
        }
      : null,
  };
}
