import {
  prepareMemoryEmbeddingWrites,
  type PreparedMemoryEmbeddingRecord,
} from "../embedding/vectorWrites";
import type { EmbeddingAdapter } from "../embedding/contracts";
import type { RememberVectorPort } from "../storage/ports";
import type {
  RememberWriteState,
  RollbackAction,
} from "./contracts";

export async function rollbackRememberWrites(
  actions: RollbackAction[],
): Promise<unknown[]> {
  const errors: unknown[] = [];

  for (const action of [...actions].reverse()) {
    try {
      await action();
    } catch (error) {
      errors.push(error);
    }
  }

  return errors;
}

async function deleteVectorEmbedding(
  vectorIndex: RememberVectorPort,
  memoryType: PreparedMemoryEmbeddingRecord["memoryType"],
  id: string,
): Promise<void> {
  if (memoryType === "fact") {
    await vectorIndex.deleteFactEmbedding(id);
    return;
  }
  if (memoryType === "reference") {
    await vectorIndex.deleteReferenceEmbedding(id);
    return;
  }
  if (memoryType === "note") {
    await vectorIndex.deleteNoteEmbedding(id);
    return;
  }

  await vectorIndex.deleteEpisodeEmbedding(id);
}

async function upsertVectorRecords(input: {
  records: PreparedMemoryEmbeddingRecord[];
  vectorIndex: RememberVectorPort;
  rollbackActions?: RollbackAction[];
}): Promise<void> {
  const { records, vectorIndex, rollbackActions } = input;
  if (records.length === 0) {
    return;
  }

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
    rollbackActions?.push(async () => {
      for (const record of factRecords) {
        await vectorIndex.deleteFactEmbedding(record.id);
      }
    });
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
    rollbackActions?.push(async () => {
      for (const record of referenceRecords) {
        await vectorIndex.deleteReferenceEmbedding(record.id);
      }
    });
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
    rollbackActions?.push(async () => {
      for (const record of episodeRecords) {
        await vectorIndex.deleteEpisodeEmbedding(record.id);
      }
    });
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
    rollbackActions?.push(async () => {
      for (const record of noteRecords) {
        await vectorIndex.deleteNoteEmbedding(record.id);
      }
    });
  }
}

export async function commitRememberVectors(input: {
  embedding?: EmbeddingAdapter;
  rollbackActions: RollbackAction[];
  state: RememberWriteState;
  vectorIndex?: RememberVectorPort | null;
}): Promise<void> {
  if (!input.vectorIndex) {
    return;
  }

  if (input.embedding && input.state.pendingEmbeddingWrites.length > 0) {
    const preparedUpserts = await prepareMemoryEmbeddingWrites(
      input.state.pendingEmbeddingWrites,
      input.embedding,
    );
    await upsertVectorRecords({
      records: preparedUpserts,
      vectorIndex: input.vectorIndex,
      rollbackActions: input.rollbackActions,
    });
  }

  for (const staleVector of input.state.pendingVectorDeletes) {
    await deleteVectorEmbedding(
      input.vectorIndex,
      staleVector.memoryType,
      staleVector.id,
    );
    input.rollbackActions.push(async () => {
      if (staleVector.restoreRecord) {
        await upsertVectorRecords({
          records: [staleVector.restoreRecord],
          vectorIndex: input.vectorIndex!,
        });
      }
    });
  }
}
