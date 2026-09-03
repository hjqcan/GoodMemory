import type { GovernanceVectorPort } from "../storage/ports";

export async function deleteVectorForCollection(
  vectorPort: GovernanceVectorPort | null,
  collection: string,
  id: string,
): Promise<void> {
  if (!vectorPort) {
    return;
  }

  if (collection === "facts") {
    await vectorPort.deleteFactEmbedding(id);
    return;
  }

  if (collection === "references") {
    await vectorPort.deleteReferenceEmbedding(id);
    return;
  }

  if (collection === "episodes") {
    await vectorPort.deleteEpisodeEmbedding(id);
    return;
  }

  if (collection === "notes") {
    await vectorPort.deleteNoteEmbedding(id);
  }
}
