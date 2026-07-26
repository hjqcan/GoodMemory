import {
  createHash,
  randomUUID,
} from "node:crypto";
import {
  link,
  rm,
  writeFile,
} from "node:fs/promises";
import {
  dirname,
  join,
  resolve,
} from "node:path";

import {
  readC6StableRegularFile,
} from "./codex-coding-effect/c6-asset-lock";
import {
  buildC6SourceV3SimplePromotionReceipt,
  readC6SourceV3SimplePromotionHead,
  serializeC6SourceV3SimplePromotionReceipt,
  verifyC6SourceV3SimplePromotionReceipt,
} from "./codex-coding-effect/c6-source-v3-simple-promotion";

const OPTION_NAMES = new Set([
  "census-implementation-commit-sha",
  "freeze-commit-sha",
  "output",
  "repository-root",
]);

export interface C6SourceV3SimplePromotionCliOptions {
  censusImplementationCommitSha: string;
  freezeCommitSha: string;
  outputPath: string;
  repositoryRoot: string;
}

export function parseC6SourceV3SimplePromotionCliOptions(
  args: readonly string[],
): C6SourceV3SimplePromotionCliOptions {
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = /^--([^=]+)=(.*)$/u.exec(argument);
    if (match === null) {
      throw new Error(
        `unknown C6 source-v3-simple promotion argument ${argument}`,
      );
    }
    const [, name, value] = match;
    if (!OPTION_NAMES.has(name!)) {
      throw new Error(
        `unknown C6 source-v3-simple promotion option --${name}`,
      );
    }
    if (values.has(name!)) {
      throw new Error(
        `--${name} cannot be specified more than once`,
      );
    }
    if (value!.length === 0 || value!.trim() !== value) {
      throw new Error(`--${name} must not be empty or padded`);
    }
    values.set(name!, value!);
  }
  return {
    freezeCommitSha: required(values, "freeze-commit-sha"),
    censusImplementationCommitSha: required(
      values,
      "census-implementation-commit-sha",
    ),
    outputPath: required(values, "output"),
    repositoryRoot: required(values, "repository-root"),
  };
}

export async function materializeC6SourceV3SimplePromotionReceipt(
  input: C6SourceV3SimplePromotionCliOptions,
): Promise<{
  candidateManifestFrozen: false;
  codexRunReady: false;
  formalCensusPermitted: true;
  outputPath: string;
  priorRepositoryNodeIdExclusionComplete: true;
  receiptBytes: number;
  receiptSha256: string;
  sourceV3SimpleFrozen: true;
}> {
  const repositoryRoot = resolve(input.repositoryRoot);
  const promotionBaseCommitSha =
    await readC6SourceV3SimplePromotionHead(
      repositoryRoot,
    );
  const buildInput = {
    censusImplementationCommitSha:
      input.censusImplementationCommitSha,
    freezeCommitSha: input.freezeCommitSha,
    promotionBaseCommitSha,
    repositoryRoot,
  };
  const outputPath = resolve(input.outputPath);
  const receipt =
    await buildC6SourceV3SimplePromotionReceipt(buildInput);
  const serialized =
    serializeC6SourceV3SimplePromotionReceipt(receipt);
  const temporaryOutputPath = join(
    dirname(outputPath),
    `.c6-source-v3-promotion-${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporaryOutputPath, serialized, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    const verifiedBytes = await readC6StableRegularFile(
      temporaryOutputPath,
      "source-v3-simple temporary promotion receipt",
      1 * 1_024 * 1_024,
      true,
    );
    await verifyC6SourceV3SimplePromotionReceipt(
      verifiedBytes,
      buildInput,
    );
    if (
      await readC6SourceV3SimplePromotionHead(repositoryRoot) !==
        promotionBaseCommitSha
    ) {
      throw new Error(
        "C6 source-v3-simple promotion HEAD changed before publication",
      );
    }
    await link(temporaryOutputPath, outputPath);
    await rm(temporaryOutputPath);
    const publishedBytes = await readC6StableRegularFile(
      outputPath,
      "source-v3-simple published promotion receipt",
      1 * 1_024 * 1_024,
      true,
    );
    if (!publishedBytes.equals(verifiedBytes)) {
      throw new Error(
        "C6 source-v3-simple published promotion receipt changed during publication",
      );
    }
    return {
      candidateManifestFrozen: false,
      codexRunReady: false,
      formalCensusPermitted: true,
      outputPath,
      priorRepositoryNodeIdExclusionComplete: true,
      receiptBytes: publishedBytes.byteLength,
      receiptSha256: sha256(publishedBytes),
      sourceV3SimpleFrozen: true,
    };
  } finally {
    await rm(temporaryOutputPath, {
      force: true,
    });
  }
}

function required(
  values: ReadonlyMap<string, string>,
  name: string,
): string {
  const value = values.get(name);
  if (value === undefined) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

if (import.meta.main) {
  const options = parseC6SourceV3SimplePromotionCliOptions(
    process.argv.slice(2),
  );
  const result =
    await materializeC6SourceV3SimplePromotionReceipt(options);
  console.log(JSON.stringify(result, null, 2));
}
