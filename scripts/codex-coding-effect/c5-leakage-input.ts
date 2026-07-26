import { readFile, readdir } from "node:fs/promises";
import { join, relative, sep } from "node:path";

import { z } from "zod";

import type {
  C4HiddenArtifact,
  C4HiddenValue,
  C4LeakageSurface,
} from "./c4-leakage";
import {
  c4HiddenValueAppearsInSurfaces,
  c4HiddenValueRelationAppearsInSurfaces,
} from "./c4-leakage";
import type { CodexCodingEffectDatasetV2 } from "./dataset";
import { loadFrozenPrehistory } from "./frozen-prehistory";

type C5Episode = CodexCodingEffectDatasetV2["episodes"][number];
type C5Stage = C5Episode["stages"][number];

const evaluatorCasesSchema = z.object({
  cases: z.array(z.object({
    episodeId: z.string().min(1),
    failToPass: z.array(z.object({
      args: z.array(z.unknown()),
      expected: z.unknown(),
    }).strict()).min(1),
    functionName: z.string().min(1),
    hiddenSentinel: z.string().min(1),
    passToPass: z.array(z.object({
      args: z.array(z.unknown()),
      expected: z.unknown(),
    }).strict()).min(1),
    stageId: z.string().min(1),
  }).strict()).min(1),
  schemaVersion: z.literal(1),
}).strict();

export async function buildC5StageLeakageInput(input: {
  allowEmptyPrehistory?: boolean;
  datasetRoot: string;
  episode: C5Episode;
  repositoryRoot: string;
  stage: C5Stage;
}): Promise<{
  artifacts: C4HiddenArtifact[];
  staticSurfaces: C4LeakageSurface[];
}> {
  if (input.episode.prehistory.source !== "frozen-artifact") {
    throw new Error("C5 leakage input requires frozen audit-reference prehistory");
  }
  const [
    artifact,
    evaluatorCasesBytes,
    evaluatorRunnerBytes,
    goldPatch,
    prompt,
    repositoryFiles,
  ] = await Promise.all([
    loadFrozenPrehistory({
      allowEmpty: input.allowEmptyPrehistory,
      expectedSha256: input.episode.prehistory.sha256,
      path: join(input.datasetRoot, input.episode.prehistory.path),
    }),
    readFile(join(input.datasetRoot, "evaluator", "cases.json"), "utf8"),
    readFile(join(input.datasetRoot, "evaluator", "runner.ts"), "utf8"),
    readFile(join(input.datasetRoot, input.stage.goldPatch.path), "utf8"),
    readFile(join(input.datasetRoot, input.stage.promptPath), "utf8"),
    collectRepositoryFiles(input.repositoryRoot),
  ]);
  const parsedCases = evaluatorCasesSchema.safeParse(
    JSON.parse(evaluatorCasesBytes) as unknown,
  );
  if (!parsedCases.success) {
    throw new Error("invalid C5 evaluator cases for leakage audit");
  }
  const testCase = parsedCases.data.cases.find((candidate) =>
    candidate.episodeId === input.episode.id &&
    candidate.stageId === input.stage.id
  );
  if (testCase === undefined) {
    throw new Error("C5 leakage input has no hidden evaluator case for stage");
  }

  const instructionFiles = repositoryFiles.filter((file) =>
    file.path.split("/").at(-1) === "AGENTS.md"
  );
  const visibleFiles = repositoryFiles.filter((file) =>
    file.path.split("/").at(-1) !== "AGENTS.md"
  );
  const publicSurfaces = repositoryFiles.map((file) => file.content);
  const stageCases = [...testCase.failToPass, ...testCase.passToPass];
  const allowedValues = uniqueHiddenValues(
    input.episode.allowedPublicLeakageValues ?? [],
  );
  const allowedRelations = uniqueHiddenValueRelations(
    input.episode.allowedPublicLeakageRelations ?? [],
  );
  if (
    allowedValues.some((value) =>
      !c4HiddenValueAppearsInSurfaces(publicSurfaces, value)
    ) ||
    allowedRelations.some((relation) =>
      !c4HiddenValueRelationAppearsInSurfaces(publicSurfaces, relation)
    )
  ) {
    throw new Error("C5 public leakage exemption has no frozen source proof");
  }
  const allowedValueKeys = new Set(allowedValues.map(hiddenValueKey));
  const allowedRelationKeys = new Set(
    allowedRelations.map(hiddenValueRelationKey),
  );
  const hiddenValues = uniqueHiddenValues(stageCases.flatMap((hiddenCase) => [
    ...collectHiddenValues(hiddenCase.args),
    ...collectHiddenValues(hiddenCase.expected),
  ])).filter((value) => !allowedValueKeys.has(hiddenValueKey(value)));
  const hiddenValueRelations = uniqueHiddenValueRelations(
    stageCases.flatMap(hiddenCaseRelations),
  ).filter((relation) =>
    !allowedRelationKeys.has(hiddenValueRelationKey(relation))
  );
  const expectedChangedFiles = [...new Set(
    input.stage.expectedChangedFiles,
  )].sort();
  const goldCandidates = meaningfulAddedLines(goldPatch);
  const hiddenSourceCandidates = [...new Set([
    ...meaningfulSourceLines(evaluatorRunnerBytes),
    testCase.hiddenSentinel,
    ...stageCases.flatMap((hiddenCase) => {
      const completeCase = {
        args: hiddenCase.args,
        expected: hiddenCase.expected,
      };
      return [
        JSON.stringify(completeCase),
        JSON.stringify(completeCase, null, 2),
      ];
    }),
  ])];
  const prehistoryMessages = artifact.records.map((record) =>
    record.message
  ).join("\n");
  const artifacts: C4HiddenArtifact[] = [
    splitPublicCandidates({
      content: JSON.stringify(expectedChangedFiles),
      fragments: expectedChangedFiles,
      id: "expected-changed-files",
      publicSurfaces,
    }),
    splitPublicCandidates({
      content: goldPatch,
      fragments: goldCandidates,
      id: "gold-patches",
      publicSurfaces,
    }),
    {
      ...splitPublicCandidates({
        content: [
          evaluatorRunnerBytes,
          JSON.stringify({ cases: [testCase], schemaVersion: 1 }, null, 2),
        ].join("\n"),
        fragments: hiddenSourceCandidates,
        id: "hidden-test-source",
        publicSurfaces,
      }),
      allowedPublicFragments: [
        ...hiddenSourceCandidates.filter((fragment) =>
          containsNormalizedInSurfaces(publicSurfaces, fragment)
        ),
        ...uniqueHiddenValues(
          input.episode.allowedPublicLeakageValues ?? [],
        ).map(String),
      ],
      hiddenValueRelations,
      hiddenValues,
    },
  ];
  const staticSurfaces: C4LeakageSurface[] = [
    {
      content: input.stage.allowedFeedback.join("\n"),
      id: "allowed-feedback",
    },
    {
      content: artifact.sourceBytes,
      hiddenValueContent: prehistoryMessages,
      id: "frozen-prehistory",
    },
    {
      content: instructionFiles.map(serializeRepositoryFile).join("\n"),
      hiddenValueContents: instructionFiles.map((file) => file.content),
      id: "repository-instructions",
    },
    { content: prompt, id: "stage-prompts" },
    {
      content: visibleFiles.map(serializeRepositoryFile).join("\n"),
      hiddenValueContents: visibleFiles.map((file) => file.content),
      id: "visible-repository-files",
    },
  ];
  return { artifacts, staticSurfaces };
}

async function collectRepositoryFiles(
  repositoryRoot: string,
  directory = repositoryRoot,
): Promise<Array<{ content: string; path: string }>> {
  const files: Array<{ content: string; path: string }> = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git") {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error("C5 visible repository surface rejects symlinks");
    }
    if (entry.isDirectory()) {
      files.push(...await collectRepositoryFiles(repositoryRoot, path));
    } else if (entry.isFile()) {
      files.push({
        content: await readFile(path, "utf8"),
        path: relative(repositoryRoot, path).split(sep).join("/"),
      });
    } else {
      throw new Error("C5 visible repository surface rejects non-files");
    }
  }
  return files.sort((first, second) => first.path.localeCompare(second.path));
}

function splitPublicCandidates(input: {
  content: string;
  fragments: readonly string[];
  id: C4HiddenArtifact["id"];
  publicSurfaces: readonly string[];
}): C4HiddenArtifact {
  return {
    allowedPublicFragments: input.fragments.filter((fragment) =>
      containsNormalizedInSurfaces(input.publicSurfaces, fragment)
    ),
    content: input.content,
    fragments: input.fragments.filter((fragment) =>
      !containsNormalizedInSurfaces(input.publicSurfaces, fragment)
    ),
    id: input.id,
  };
}

function meaningfulAddedLines(patch: string): string[] {
  return semanticArtifactCandidates(patch.split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1)));
}

function meaningfulSourceLines(source: string): string[] {
  return semanticArtifactCandidates(source.split(/\r?\n/u));
}

function semanticArtifactCandidates(lines: readonly string[]): string[] {
  const semanticLines = lines
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0 &&
      !line.startsWith("import ") &&
      /[\p{L}\p{N}_]/u.test(line)
    );
  const candidates: string[] = [];
  for (const [index, line] of semanticLines.entries()) {
    if (normalize(line).length >= 8) {
      candidates.push(line);
      continue;
    }
    candidates.push(...shortCodeTokens(line));
    const previous = semanticLines[index - 1];
    const next = semanticLines[index + 1];
    if (previous !== undefined) candidates.push(`${previous}\n${line}`);
    if (next !== undefined) candidates.push(`${line}\n${next}`);
  }
  return [...new Set(candidates)];
}

function shortCodeTokens(line: string): string[] {
  return (line.match(
    /[?.:]?\s*[\p{L}_][\p{L}\p{N}_]*(?:\(\))?/gu,
  ) ?? [])
    .map((token) => token.trim())
    .filter((token) =>
      normalize(token).length >= 4 && /[?.:()]/u.test(token)
    );
}

function collectHiddenValues(value: unknown): C4HiddenValue[] {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [value];
  }
  if (Array.isArray(value)) return value.flatMap(collectHiddenValues);
  if (typeof value === "object") {
    return Object.values(value).flatMap(collectHiddenValues);
  }
  return [];
}

function uniqueHiddenValues(
  values: readonly C4HiddenValue[],
): C4HiddenValue[] {
  return [...new Map(values.map((value) => [
    hiddenValueKey(value),
    value,
  ])).values()];
}

function hiddenCaseRelations(hiddenCase: {
  args: unknown;
  expected: unknown;
}): C4HiddenValue[][] {
  const arguments_ = uniqueHiddenValues(collectHiddenValues(hiddenCase.args));
  const expected = uniqueHiddenValues(collectHiddenValues(hiddenCase.expected));
  return arguments_.flatMap((argument) =>
    expected
      .filter((value) => hiddenValueKey(value) !== hiddenValueKey(argument))
      .map((value) => [argument, value])
  );
}

function uniqueHiddenValueRelations(
  relations: readonly (readonly C4HiddenValue[])[],
): C4HiddenValue[][] {
  return [...new Map(relations.map((relation) => [
    hiddenValueRelationKey(relation),
    [...relation],
  ])).entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([, relation]) => relation);
}

function hiddenValueKey(value: C4HiddenValue): string {
  return JSON.stringify({
    type: value === null ? "null" : typeof value,
    value,
  });
}

function hiddenValueRelationKey(
  relation: readonly C4HiddenValue[],
): string {
  return JSON.stringify(relation.map(hiddenValueKey));
}

function containsNormalizedInSurfaces(
  surfaces: readonly string[],
  fragment: string,
): boolean {
  const candidate = normalize(fragment);
  return candidate.length > 0 && surfaces.some((surface) =>
    normalize(surface).includes(candidate)
  );
}

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

function serializeRepositoryFile(file: {
  content: string;
  path: string;
}): string {
  return `FILE ${file.path}\n${file.content}`;
}
