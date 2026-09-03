import type {
  EpisodeMemory,
  FactMemory,
  FeedbackMemory,
  NoteMemory,
  PreferenceMemory,
  ReferenceMemory,
  SessionJournal,
  UserProfile,
  WorkingMemorySnapshot,
} from "../domain/records";
import type { MemoryScope } from "../domain/scope";
import type { EvidenceRecord, SourceMessageRecord } from "../evidence/contracts";
import type {
  ExperienceRecord,
  LearningProposal,
  PromotionRecord,
  SessionArchive,
} from "../domain/evolutionRecords";
import type { VectorRecord } from "./contracts";

interface ProfileRepositoryPort {
  profiles: {
    get(userId: string): Promise<UserProfile | null>;
    upsert(profile: UserProfile): Promise<void>;
  };
}

interface PreferenceRepositoryPort {
  preferences: {
    get?(id: string): Promise<PreferenceMemory | null>;
    listByScope(scope: MemoryScope): Promise<PreferenceMemory[]>;
    upsert(preference: PreferenceMemory): Promise<void>;
  };
}

interface ReferenceRepositoryPort {
  references: {
    add(reference: ReferenceMemory): Promise<void>;
    get?(id: string): Promise<ReferenceMemory | null>;
    listByScope(scope: MemoryScope): Promise<ReferenceMemory[]>;
  };
}

interface NoteRepositoryPort {
  notes: {
    add(note: NoteMemory): Promise<void>;
    get?(id: string): Promise<NoteMemory | null>;
    listByScope(scope: MemoryScope): Promise<NoteMemory[]>;
  };
}

interface FactRepositoryPort {
  facts: {
    add(fact: FactMemory): Promise<void>;
    get?(id: string): Promise<FactMemory | null>;
    listByScope(scope: MemoryScope): Promise<FactMemory[]>;
  };
}

interface FeedbackRepositoryPort {
  feedback: {
    get?(id: string): Promise<FeedbackMemory | null>;
    listByScope(scope: MemoryScope): Promise<FeedbackMemory[]>;
    upsert(feedback: FeedbackMemory): Promise<void>;
  };
}

interface EpisodeRepositoryPort {
  episodes: {
    add(episode: EpisodeMemory): Promise<void>;
    get?(id: string): Promise<EpisodeMemory | null>;
    listByScope(scope: MemoryScope): Promise<EpisodeMemory[]>;
  };
}

interface ArchiveRepositoryPort {
  archives: {
    add(archive: SessionArchive): Promise<void>;
    get?(id: string): Promise<SessionArchive | null>;
    listByScope(scope: MemoryScope): Promise<SessionArchive[]>;
  };
}

interface EvidenceRepositoryPort {
  evidence: {
    add(evidence: EvidenceRecord): Promise<void>;
    get?(id: string): Promise<EvidenceRecord | null>;
    listByScope(scope: MemoryScope): Promise<EvidenceRecord[]>;
  };
}

type ImmutableRecordWriteResult = "inserted" | "unchanged";

interface BehavioralOutcomeRepositoryPort {
  behavioralOutcomes: {
    add(input: {
      evidence?: EvidenceRecord;
      experience: ExperienceRecord;
    }): Promise<ImmutableRecordWriteResult>;
  };
}

interface ExperienceRepositoryPort {
  experiences: {
    add(experience: ExperienceRecord): Promise<void>;
    get(id: string): Promise<ExperienceRecord | null>;
    listByScope(scope: MemoryScope): Promise<ExperienceRecord[]>;
  };
}

interface ProposalRepositoryPort {
  proposals: {
    add(proposal: LearningProposal): Promise<void>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<LearningProposal | null>;
    listByScope(scope: MemoryScope): Promise<LearningProposal[]>;
  };
}

interface PromotionRepositoryPort {
  promotions: {
    add(promotion: PromotionRecord): Promise<void>;
    delete(id: string): Promise<void>;
    get(id: string): Promise<PromotionRecord | null>;
    listByScope(scope: MemoryScope): Promise<PromotionRecord[]>;
  };
}

interface SourceMessageRepositoryPort {
  // Optional: episode dialogue-span hydration resolves EpisodeMemory
  // sourceMessageIds to their stored source messages at packet-build time.
  // Adapters without raw-message retention omit it and episodes render
  // summary-only (historical behavior).
  sourceMessages?: {
    getByIds(input: {
      ids: readonly string[];
      scope: MemoryScope;
    }): Promise<SourceMessageRecord[]>;
  };
}

export interface RecallRepositoryPort extends
  ProfileRepositoryPort,
  PreferenceRepositoryPort,
  ReferenceRepositoryPort,
  NoteRepositoryPort,
  FactRepositoryPort,
  FeedbackRepositoryPort,
  ArchiveRepositoryPort,
  EvidenceRepositoryPort,
  SourceMessageRepositoryPort,
  EpisodeRepositoryPort {}

export interface RememberRepositoryPort extends
  ProfileRepositoryPort,
  PreferenceRepositoryPort,
  ReferenceRepositoryPort,
  NoteRepositoryPort,
  FactRepositoryPort,
  FeedbackRepositoryPort,
  EpisodeRepositoryPort {}

export interface EvolutionRepositoryPort extends
  FactRepositoryPort,
  FeedbackRepositoryPort,
  ArchiveRepositoryPort,
  ExperienceRepositoryPort,
  ProposalRepositoryPort,
  PromotionRepositoryPort {}

export interface MaintenanceRepositoryPort extends
  FactRepositoryPort,
  ReferenceRepositoryPort,
  NoteRepositoryPort,
  ArchiveRepositoryPort,
  EpisodeRepositoryPort,
  ExperienceRepositoryPort {}

export interface GovernanceRepositoryPort extends
  BehavioralOutcomeRepositoryPort,
  ProfileRepositoryPort,
  PreferenceRepositoryPort,
  ReferenceRepositoryPort,
  NoteRepositoryPort,
  FactRepositoryPort,
  FeedbackRepositoryPort,
  ArchiveRepositoryPort,
  EvidenceRepositoryPort,
  EpisodeRepositoryPort,
  ExperienceRepositoryPort,
  ProposalRepositoryPort,
  PromotionRepositoryPort {}

export interface FactVectorSearchPort {
  searchFactEmbedding(
    queryEmbedding: number[],
    input: { topK: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchRecord[]>;
}

export interface ReferenceVectorSearchPort {
  searchReferenceEmbedding(
    queryEmbedding: number[],
    input: { topK: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchRecord[]>;
}

export interface EpisodeVectorSearchPort {
  searchEpisodeEmbedding(
    queryEmbedding: number[],
    input: { topK: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchRecord[]>;
}

export interface NoteVectorSearchPort {
  searchNoteEmbedding(
    queryEmbedding: number[],
    input: { topK: number; filter?: Record<string, unknown> },
  ): Promise<VectorSearchRecord[]>;
}

interface FactVectorDeletionPort {
  deleteFactEmbedding(id: string): Promise<void>;
}

interface NoteVectorDeletionPort {
  deleteNoteEmbedding(id: string): Promise<void>;
}

interface NoteVectorMutationPort extends NoteVectorDeletionPort {
  getNoteEmbedding(id: string): Promise<VectorRecord | null>;
  upsertNoteEmbedding(records: VectorMutationRecord[]): Promise<void>;
}

interface ReferenceVectorDeletionPort {
  deleteReferenceEmbedding(id: string): Promise<void>;
}

interface EpisodeVectorDeletionPort {
  deleteEpisodeEmbedding(id: string): Promise<void>;
}

interface FactVectorMutationPort extends FactVectorDeletionPort {
  getFactEmbedding(id: string): Promise<VectorRecord | null>;
  upsertFactEmbedding(records: VectorMutationRecord[]): Promise<void>;
}

interface ReferenceVectorMutationPort extends ReferenceVectorDeletionPort {
  getReferenceEmbedding(id: string): Promise<VectorRecord | null>;
  upsertReferenceEmbedding(records: VectorMutationRecord[]): Promise<void>;
}

interface EpisodeVectorMutationPort extends EpisodeVectorDeletionPort {
  getEpisodeEmbedding(id: string): Promise<VectorRecord | null>;
  upsertEpisodeEmbedding(records: VectorMutationRecord[]): Promise<void>;
}

export interface RecallVectorSearchPort extends
  FactVectorSearchPort,
  ReferenceVectorSearchPort,
  NoteVectorSearchPort,
  EpisodeVectorSearchPort {}

export interface RememberVectorPort extends
  FactVectorMutationPort,
  ReferenceVectorMutationPort,
  NoteVectorMutationPort,
  EpisodeVectorMutationPort {}

export interface MaintenanceVectorPort extends
  FactVectorMutationPort,
  ReferenceVectorMutationPort,
  NoteVectorMutationPort,
  EpisodeVectorMutationPort {}

export interface GovernanceVectorPort extends
  FactVectorDeletionPort,
  ReferenceVectorDeletionPort,
  NoteVectorDeletionPort,
  EpisodeVectorDeletionPort {}

export interface VectorMutationRecord {
  content: string;
  embedding: number[];
  id: string;
  metadata: Record<string, unknown>;
}

export interface VectorSearchRecord {
  content: string;
  embedding: number[];
  id: string;
  metadata: Record<string, unknown>;
  score: number;
}

export interface RecallRuntimePort {
  getJournal(scope: MemoryScope): Promise<SessionJournal | null>;
  getWorkingMemory(scope: MemoryScope): Promise<WorkingMemorySnapshot | null>;
}
