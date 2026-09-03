import type {
  EpisodeMemory,
  FactMemory,
  NoteMemory,
  ReferenceMemory,
} from "../domain/records";
import type { EmbeddingAdapter } from "./contracts";
import type { MaintenanceVectorPort, RememberVectorPort } from "../storage/ports";

type EmbeddingScopedRecord = {
  id: string;
  userId: string;
  tenantId?: string;
  workspaceId?: string;
  agentId?: string;
  sessionId?: string;
};

export interface MemoryEmbeddingWrite {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  memoryType: "fact" | "reference" | "episode" | "note";
}

export interface PreparedMemoryEmbeddingRecord extends MemoryEmbeddingWrite {
  embedding: number[];
}

function buildEmbeddingMetadata(
  scope: EmbeddingScopedRecord,
  memoryType: MemoryEmbeddingWrite["memoryType"],
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      userId: scope.userId,
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agentId: scope.agentId,
      sessionId: scope.sessionId,
      memoryType,
    }).filter(([, value]) => value !== undefined),
  );
}

export function buildFactEmbeddingWrite(fact: FactMemory): MemoryEmbeddingWrite {
  return {
    id: fact.id,
    content: fact.content,
    metadata: buildEmbeddingMetadata(fact, "fact"),
    memoryType: "fact",
  };
}

export function buildReferenceEmbeddingWrite(
  reference: ReferenceMemory,
): MemoryEmbeddingWrite {
  return {
    id: reference.id,
    content: [
      reference.title,
      reference.pointer,
      reference.description ?? "",
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: buildEmbeddingMetadata(reference, "reference"),
    memoryType: "reference",
  };
}

// A note embeds whole: title plus verbatim body. The NOTE_MAX_BYTES cap keeps
// the input inside common provider limits without any truncation here.
export function buildNoteEmbeddingWrite(note: NoteMemory): MemoryEmbeddingWrite {
  return {
    id: note.id,
    content: `${note.title}\n\n${note.body}`,
    metadata: buildEmbeddingMetadata(note, "note"),
    memoryType: "note",
  };
}

export function buildEpisodeEmbeddingWrite(
  episode: EpisodeMemory,
): MemoryEmbeddingWrite {
  return {
    id: episode.id,
    content: [
      episode.summary,
      episode.keyDecisions.join("\n"),
      episode.unresolvedItems.join("\n"),
      episode.topics.join("\n"),
    ]
      .filter(Boolean)
      .join("\n"),
    metadata: buildEmbeddingMetadata(episode, "episode"),
    memoryType: "episode",
  };
}

export async function prepareMemoryEmbeddingWrites(
  writes: MemoryEmbeddingWrite[],
  embedding: EmbeddingAdapter,
): Promise<PreparedMemoryEmbeddingRecord[]> {
  const prepared: PreparedMemoryEmbeddingRecord[] = [];
  const factWrites = writes.filter((write) => write.memoryType === "fact");
  if (factWrites.length > 0) {
    const embeddings = await embedding.embed(factWrites.map((write) => write.content));
    prepared.push(
      ...factWrites.map((write, index) => ({
        ...write,
        embedding: embeddings[index]!,
      })),
    );
  }

  const referenceWrites = writes.filter((write) => write.memoryType === "reference");
  if (referenceWrites.length > 0) {
    const embeddings = await embedding.embed(referenceWrites.map((write) => write.content));
    prepared.push(
      ...referenceWrites.map((write, index) => ({
        ...write,
        embedding: embeddings[index]!,
      })),
    );
  }

  const episodeWrites = writes.filter((write) => write.memoryType === "episode");
  if (episodeWrites.length > 0) {
    const embeddings = await embedding.embed(episodeWrites.map((write) => write.content));
    prepared.push(
      ...episodeWrites.map((write, index) => ({
        ...write,
        embedding: embeddings[index]!,
      })),
    );
  }

  const noteWrites = writes.filter((write) => write.memoryType === "note");
  if (noteWrites.length > 0) {
    const embeddings = await embedding.embed(noteWrites.map((write) => write.content));
    prepared.push(
      ...noteWrites.map((write, index) => ({
        ...write,
        embedding: embeddings[index]!,
      })),
    );
  }

  return prepared;
}

export async function upsertPreparedMemoryEmbeddings(
  records: PreparedMemoryEmbeddingRecord[],
  vectorIndex: MaintenanceVectorPort | RememberVectorPort,
): Promise<number> {
  const factRecords = records.filter((record) => record.memoryType === "fact");
  if (factRecords.length > 0) {
    await vectorIndex.upsertFactEmbedding(
      factRecords.map((record) => ({
        id: record.id,
        embedding: record.embedding,
        metadata: record.metadata,
        content: record.content,
      })),
    );
  }

  const referenceRecords = records.filter((record) => record.memoryType === "reference");
  if (referenceRecords.length > 0) {
    await vectorIndex.upsertReferenceEmbedding(
      referenceRecords.map((record) => ({
        id: record.id,
        embedding: record.embedding,
        metadata: record.metadata,
        content: record.content,
      })),
    );
  }

  const episodeRecords = records.filter((record) => record.memoryType === "episode");
  if (episodeRecords.length > 0) {
    await vectorIndex.upsertEpisodeEmbedding(
      episodeRecords.map((record) => ({
        id: record.id,
        embedding: record.embedding,
        metadata: record.metadata,
        content: record.content,
      })),
    );
  }

  const noteRecords = records.filter((record) => record.memoryType === "note");
  if (noteRecords.length > 0) {
    await vectorIndex.upsertNoteEmbedding(
      noteRecords.map((record) => ({
        id: record.id,
        embedding: record.embedding,
        metadata: record.metadata,
        content: record.content,
      })),
    );
  }

  return records.length;
}

export async function upsertMemoryEmbeddings(
  writes: MemoryEmbeddingWrite[],
  embedding: EmbeddingAdapter,
  vectorIndex: MaintenanceVectorPort | RememberVectorPort,
): Promise<number> {
  return upsertPreparedMemoryEmbeddings(
    await prepareMemoryEmbeddingWrites(writes, embedding),
    vectorIndex,
  );
}
