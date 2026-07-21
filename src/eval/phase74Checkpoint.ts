import { createHash, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import type {
  Phase74E4CaseResult,
  Phase74GeneralizationCheckpoint,
  Phase74RetrievalSnapshot,
} from "./phase74Generalization";
import type { OracleMatrixCaseResult } from "./oracleMatrix";

type Phase74CheckpointKind = "e4" | "oracle" | "retrieval";

interface Phase74CheckpointEnvelope {
  key: string;
  kind: Phase74CheckpointKind;
  payload: unknown;
  payloadSha256: string;
  schemaVersion: 1;
}

interface Phase74CheckpointFileHandle {
  close(): Promise<void>;
  sync(): Promise<void>;
  writeFile(value: string): Promise<void>;
}

interface Phase74CheckpointFileOperations {
  link(source: string, destination: string): Promise<void>;
  open(path: string, flags: "r" | "wx"): Promise<Phase74CheckpointFileHandle>;
  randomId(): string;
  unlink(path: string): Promise<void>;
}

const DEFAULT_FILE_OPERATIONS: Phase74CheckpointFileOperations = {
  link,
  open,
  randomId: randomUUID,
  unlink,
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function phase74CheckpointPath(
  root: string,
  kind: Phase74CheckpointKind,
  key: string,
): string {
  return join(root, kind, `${sha256(key)}.json`);
}

function parseEnvelope(input: {
  key: string;
  kind: Phase74CheckpointKind;
  path: string;
  raw: string;
}): Phase74CheckpointEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(input.raw);
  } catch {
    throw new Error(`Invalid Phase 74 checkpoint JSON at ${input.path}.`);
  }
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`Invalid Phase 74 checkpoint at ${input.path}.`);
  }
  const envelope = value as Partial<Phase74CheckpointEnvelope>;
  if (
    envelope.schemaVersion !== 1 ||
    envelope.key !== input.key ||
    envelope.kind !== input.kind ||
    typeof envelope.payloadSha256 !== "string"
  ) {
    throw new Error(`Phase 74 checkpoint identity mismatch at ${input.path}.`);
  }
  const payloadRaw = JSON.stringify(envelope.payload);
  if (sha256(payloadRaw) !== envelope.payloadSha256) {
    throw new Error(`Phase 74 checkpoint payload hash mismatch at ${input.path}.`);
  }
  return envelope as Phase74CheckpointEnvelope;
}

async function readCheckpoint(input: {
  key: string;
  kind: Phase74CheckpointKind;
  root: string;
}): Promise<Phase74CheckpointEnvelope | null> {
  const path = phase74CheckpointPath(input.root, input.kind, input.key);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return parseEnvelope({ ...input, path, raw });
}

async function saveCheckpoint(input: {
  fileOperations: Phase74CheckpointFileOperations;
  key: string;
  kind: Phase74CheckpointKind;
  payload: unknown;
  root: string;
}): Promise<void> {
  const directory = join(input.root, input.kind);
  const path = phase74CheckpointPath(input.root, input.kind, input.key);
  const temporaryPath = `${path}.${input.fileOperations.randomId()}.tmp`;
  const payloadRaw = JSON.stringify(input.payload);
  const envelope: Phase74CheckpointEnvelope = {
    key: input.key,
    kind: input.kind,
    payload: input.payload,
    payloadSha256: sha256(payloadRaw),
    schemaVersion: 1,
  };
  await mkdir(directory, { recursive: true });
  await syncDirectory(input.root, input.fileOperations);
  let temporaryCreated = false;
  try {
    const temporary = await input.fileOperations.open(temporaryPath, "wx");
    temporaryCreated = true;
    try {
      await temporary.writeFile(`${JSON.stringify(envelope)}\n`);
      await temporary.sync();
    } finally {
      await temporary.close();
    }
    try {
      await input.fileOperations.link(temporaryPath, path);
      await syncDirectory(directory, input.fileOperations);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      const existing = await readCheckpoint(input);
      if (
        existing === null ||
        existing.payloadSha256 !== envelope.payloadSha256
      ) {
        throw new Error(
          `Phase 74 ${input.kind} has a conflicting checkpoint commit for ${input.key}.`,
        );
      }
    }
  } finally {
    if (temporaryCreated) {
      await input.fileOperations.unlink(temporaryPath);
      await syncDirectory(directory, input.fileOperations);
    }
  }
}

async function syncDirectory(
  path: string,
  fileOperations: Phase74CheckpointFileOperations,
): Promise<void> {
  const directory = await fileOperations.open(path, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

export function createPhase74FileCheckpoint(
  root: string,
  fileOperations: Phase74CheckpointFileOperations = DEFAULT_FILE_OPERATIONS,
): Phase74GeneralizationCheckpoint {
  return {
    async loadE4(key): Promise<Phase74E4CaseResult | null> {
      return (await readCheckpoint({ key, kind: "e4", root }))
        ?.payload as Phase74E4CaseResult | undefined ?? null;
    },
    async loadOracle(key): Promise<readonly OracleMatrixCaseResult[] | null> {
      return (await readCheckpoint({ key, kind: "oracle", root }))
        ?.payload as OracleMatrixCaseResult[] | undefined ?? null;
    },
    async loadRetrieval(key): Promise<Phase74RetrievalSnapshot | null> {
      return (await readCheckpoint({ key, kind: "retrieval", root }))
        ?.payload as Phase74RetrievalSnapshot | undefined ?? null;
    },
    async saveE4(key, payload): Promise<void> {
      await saveCheckpoint({ fileOperations, key, kind: "e4", payload, root });
    },
    async saveOracle(key, payload): Promise<void> {
      await saveCheckpoint({ fileOperations, key, kind: "oracle", payload, root });
    },
    async saveRetrieval(key, payload): Promise<void> {
      await saveCheckpoint({ fileOperations, key, kind: "retrieval", payload, root });
    },
  };
}
